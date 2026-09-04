import { Contract, JsonRpcProvider, Network, Wallet, formatUnits } from "ethers";
import {
  ASC_ABI,
  CHAIN_INFO_ABI,
  CHAIN_INFO_ADDRESS,
  VAULT_ABI,
  cfg,
  creditcoinDeployment,
  sepoliaDeployment,
} from "./config.js";
import { ProofPipeline, gasLimitFor, toQueryTuple } from "./proofs.js";

/**
 * The MintBound off-chain worker.
 *
 * IT IS UNTRUSTED, AND THAT IS THE POINT. It holds no authority. It can refuse to
 * submit a proof (a liveness failure, which degrades to "mint frozen, redeem open")
 * but it cannot cause a mint that the on-chain invariant would not allow. Anyone can
 * run one; running several is strictly better for liveness and changes nothing about
 * safety. Nothing below is a trust assumption.
 *
 * Two loops:
 *   1. SNAPSHOT HEARTBEAT — periodically calls the permissionless snapshotReserves()
 *      on the source chain, then proves that transaction to Creditcoin. This is what
 *      keeps the reserve proof fresh, and it is what makes a custodian drain visible.
 *   2. MINT RELAY — watches for Locked events and proves them, so deposits become
 *      wrapped supply if and only if the aggregate invariant still holds.
 */

let shuttingDown = false;
process.on("SIGINT", () => {
  console.log("\nshutting down...");
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtRatio(bps: bigint): string {
  if (bps >= 0xffffffffn) return "∞";
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

async function main() {
  const src = sepoliaDeployment();
  const cc = creditcoinDeployment();

  const assetAddr = src.contracts.TestUSD;
  const vaultAddr = src.contracts.ReserveVault;
  const ascAddr = cc.contracts.MintBoundASC;

  // Both chain ids are pinned, so ethers never issues a detection round-trip. A
  // single timed-out eth_chainId at startup previously killed the process outright:
  // JsonRpcProvider auto-detects on first use and throws "failed to detect network"
  // if that one request does not land. This worker is meant to run for days, and the
  // deployment freezes when it stops, so a transient RPC hiccup must not be fatal.
  const sourceRpc = new JsonRpcProvider(cfg.sepoliaRpc, Network.from(11155111), {
    staticNetwork: true,
  });
  const ccRpc = new JsonRpcProvider(cfg.creditcoinRpc, Network.from(102031), {
    staticNetwork: true,
  });
  const wallet = new Wallet(cfg.workerKey, ccRpc);
  const sourceWallet = new Wallet(cfg.workerKey, sourceRpc);

  const vault = new Contract(vaultAddr, VAULT_ABI, sourceWallet);
  const vaultRead = new Contract(vaultAddr, VAULT_ABI, sourceRpc);
  const asc = new Contract(ascAddr, ASC_ABI, wallet);
  const chainInfo = new Contract(CHAIN_INFO_ADDRESS, CHAIN_INFO_ABI, ccRpc);
  const pipeline = new ProofPipeline(ccRpc, sourceRpc, cfg.sourceChainKey);

  console.log("─".repeat(70));
  console.log("MintBound worker — untrusted relay");
  console.log("─".repeat(70));
  console.log(`source vault : ${vaultAddr}`);
  console.log(`source asset : ${assetAddr}`);
  console.log(`ASC          : ${ascAddr}`);
  console.log(`worker       : ${wallet.address}`);
  console.log(`chainKey     : ${cfg.sourceChainKey}`);

  // Preflight: refuse to start against a chainKey this network cannot attest.
  const chains = await chainInfo.get_supported_chains();
  const supported = chains.some((c: any) => Number(c.chainKey) === cfg.sourceChainKey);
  if (!supported) {
    throw new Error(
      `chainKey ${cfg.sourceChainKey} is not attested on this Creditcoin network. ` +
        `Supported: ${chains.map((c: any) => c.chainKey).join(", ")}`,
    );
  }

  const lag = await pipeline.attestationLag();
  console.log(
    `attestation  : head ${lag.head}, attested ${lag.attested}, lag ${lag.lag} blocks ` +
      `(~${Math.max(0, Math.round((lag.lag * 12) / 60))} min)`,
  );
  console.log("─".repeat(70));

  const seenLocks = new Set<string>();
  let sourceFromBlock = await sourceRpc.getBlockNumber();
  let lastSnapshotAt = 0;

  // ── Loop 1: snapshot heartbeat ─────────────────────────────────────────────
  async function heartbeat() {
    if (Date.now() - lastSnapshotAt < cfg.snapshotIntervalMs) return;

    if (!(await vaultRead.canSnapshot(assetAddr))) return;
    lastSnapshotAt = Date.now();

    try {
      const balance = await vaultRead.reserveBalance(assetAddr);
      console.log(`\n[snapshot] vault holds ${formatUnits(balance, 18)} — publishing to source chain`);

      const tx = await vault.snapshotReserves(assetAddr);
      const rcpt = await tx.wait();
      console.log(`[snapshot] source tx ${tx.hash} in block ${rcpt?.blockNumber}`);

      const proof = await pipeline.proofFor(tx.hash, "snapshot");
      const q = toQueryTuple(proof);
      const gasLimit = await gasLimitFor(
        ccRpc,
        ascAddr,
        asc.interface.encodeFunctionData("submitReserveSnapshot", [q]),
        wallet.address,
        proof.continuityProof.roots?.length || 1,
      );
      const submit = await asc.submitReserveSnapshot(q as any, { gasLimit });
      const sr = await submit.wait();
      console.log(`[snapshot] proven on Creditcoin: ${submit.hash} (gas ${sr?.gasUsed})`);

      await report(asc, assetAddr);
    } catch (e: any) {
      console.error(`[snapshot] failed: ${e.shortMessage ?? e.message}`);
    }
  }

  // ── Loop 2: mint relay ─────────────────────────────────────────────────────
  async function relayMints() {
    const head = await sourceRpc.getBlockNumber();
    if (head < sourceFromBlock) return;

    const events = await vaultRead.queryFilter(
      vaultRead.filters.Locked!(),
      sourceFromBlock,
      head,
    );
    sourceFromBlock = head + 1;

    for (const ev of events) {
      const txHash = (ev as any).transactionHash as string;
      if (seenLocks.has(txHash)) continue;
      seenLocks.add(txHash);

      const [user, asset, amount, nonce] = (ev as any).args;
      console.log(`\n[mint] Locked ${formatUnits(amount, 18)} for ${user} (nonce ${nonce})`);

      try {
        const proof = await pipeline.proofFor(txHash, "lock");
        const q = toQueryTuple(proof);
        const gasLimit = await gasLimitFor(
          ccRpc,
          ascAddr,
          asc.interface.encodeFunctionData("mintWithProof", [q]),
          wallet.address,
          proof.continuityProof.roots?.length || 1,
        );
        const tx = await asc.mintWithProof(q as any, { gasLimit });
        const rcpt = await tx.wait();
        console.log(`[mint] minted on Creditcoin: ${tx.hash} (gas ${rcpt?.gasUsed})`);
        await report(asc, asset);
      } catch (e: any) {
        // A revert here is the system working. The worker cannot override the
        // invariant, and it should say so loudly rather than retrying blindly.
        const msg = e.shortMessage ?? e.message ?? String(e);
        console.error(`[mint] REJECTED by the ASC: ${msg}`);
        if (/InvariantViolated/.test(msg)) {
          console.error("       -> the mint would have breached the aggregate bound.");
        } else if (/ReserveStale/.test(msg)) {
          console.error("       -> reserve proof is outside the freshness window; snapshot first.");
        } else if (/MintFrozen/.test(msg)) {
          console.error("       -> circuit breaker engaged; redemptions remain open.");
        }
      }
    }
  }

  console.log("worker running. snapshot heartbeat + mint relay active.\n");

  // Take the first snapshot immediately rather than waiting a full interval.
  lastSnapshotAt = Date.now() - cfg.snapshotIntervalMs;

  while (!shuttingDown) {
    try {
      await relayMints();
      await heartbeat();
    } catch (e: any) {
      console.error(`[loop] ${e.shortMessage ?? e.message}`);
    }
    await sleep(cfg.pollIntervalMs);
  }

  console.log("worker stopped.");
}

async function report(asc: Contract, asset: string) {
  try {
    // Read by name, never by position. The report struct has fifteen fields and two of
    // them (provenAt, trustedParties) sit between the numbers and the booleans — a
    // positional destructure silently prints the wrong figures rather than failing.
    const r = await asc.solvencyReport!(asset);
    console.log(
      `           reserve=${formatUnits(r.verifiedReserve, 18)}  ` +
        `supply=${formatUnits(r.outstandingSupply, 18)}  ` +
        `encumbered=${formatUnits(r.encumberedReserve, 18)}  ` +
        `ratio=${fmtRatio(r.collateralRatioBps)}  epoch=${r.epoch}  haircut=${r.haircutBps}bps`,
    );
    console.log(
      `           attestedAt=${r.attestedAtHeight}  latest=${r.latestAttestedHeight}  ` +
        `staleness=${r.stalenessBlocks}  trustedParties=${r.trustedParties}  ` +
        `fresh=${r.fresh}  solvent=${r.solvent}  frozen=${r.mintFrozen}`,
    );
  } catch {
    /* reporting must never break the loop */
  }
}

/**
 * Restart on any error that escapes the loops rather than exiting.
 *
 * Both snapshot and relay loops already swallow per-iteration failures. What was left
 * unguarded was everything before them, and anything that escapes them entirely. The
 * cost of the worker being down is not an error message: it is that the last proof
 * ages past its staleness bound and minting freezes until someone notices.
 */
async function supervise() {
  let attempt = 0;
  for (;;) {
    try {
      await main();
      return; // clean shutdown, e.g. SIGINT
    } catch (e: any) {
      attempt++;
      const wait = Math.min(60_000, 5_000 * attempt);
      console.error(
        `[supervisor] worker exited: ${e?.shortMessage ?? e?.message ?? e}\n` +
          `[supervisor] restarting in ${wait / 1000}s (attempt ${attempt})`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

supervise().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
