import { Contract, Interface, id as keccakId } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { ASC_ABI, ASC_ERRORS, CHAIN_INFO_ABI } from "../abi.js";
import { CHAIN_INFO_ADDRESS, EXPLORER, RPC, creditcoin } from "../config.js";
import { providers, readLive } from "../read.js";
import { c, heading, kv, rule, step, stepFail, stepOk, units } from "../render.js";
import { describeRevert } from "../revert.js";

const RESERVE_SNAPSHOT_SIG = keccakId("ReserveSnapshot(address,address,uint256,uint256,uint256)");
const LOCKED_SIG = keccakId("Locked(address,address,uint256,uint256)");

interface ProofData {
  chainKey: number;
  headerNumber: number;
  txBytes: string;
  merkleProof: { root: string; siblings: { hash: string; isLeft: boolean }[] };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
}

function toQueryTuple(p: ProofData) {
  return [
    BigInt(p.chainKey),
    BigInt(p.headerNumber),
    p.txBytes,
    p.merkleProof.root,
    p.merkleProof.siblings.map((s) => [s.hash, s.isLeft]),
    p.continuityProof.lowerEndpointDigest,
    p.continuityProof.roots,
  ] as const;
}

/**
 * `mintbound verify --source-tx 0x...`
 *
 * Walks the entire evidence pipeline for one source-chain transaction and reports what
 * the Creditcoin precompile makes of it. This is a read-only path end to end: the final
 * step is an `eth_call`, not a transaction, so it costs nothing and needs no key.
 *
 * The point is that you do not have to take MintBound's word for anything. Point this at
 * a transaction, watch the precompile answer, and decide for yourself.
 */
export async function verify(txHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    console.error(c.red(`Not a transaction hash: ${txHash}`));
    return 2;
  }

  const cc = creditcoin();
  const { cc: ccProvider, sep: sepProvider } = providers();
  const chainKey = Number(cc.config?.sourceChainKey ?? 1);
  const ascAddr = cc.contracts.MintBoundASC;

  heading("MintBound — verify source transaction");
  kv("source tx", txHash);
  kv("source chain", `Ethereum Sepolia (chainKey ${chainKey})`);
  kv("verifier", `${ascAddr} on Creditcoin CC3`);
  console.log("");

  // ── 1. the transaction itself ───────────────────────────────────────────────
  step(1, 4, "Fetching source receipt");
  const receipt = await sepProvider.getTransactionReceipt(txHash);
  if (!receipt) {
    stepFail("not found on Sepolia");
    return 1;
  }
  if (receipt.status !== 1) {
    stepFail(`transaction reverted (status ${receipt.status})`);
    console.log(
      c.grey("\n  A reverted source transaction proves nothing and MintBound rejects it\n" +
        "  outright — the receipt status is part of what the precompile checks."),
    );
    return 1;
  }
  const height = receipt.blockNumber;
  stepOk(`block ${height}, ${receipt.logs.length} logs`);

  // Which entry point does this transaction belong to? Decide from the log signatures
  // actually present, not from a flag the caller passed.
  const topics = new Set(receipt.logs.flatMap((l) => (l.topics[0] ? [l.topics[0]] : [])));
  const isSnapshot = topics.has(RESERVE_SNAPSHOT_SIG);
  const isLock = topics.has(LOCKED_SIG);
  if (!isSnapshot && !isLock) {
    stepFail("no MintBound event in this transaction");
    console.log(
      c.grey(
        "\n  This transaction carries neither a ReserveSnapshot nor a Locked event, so\n" +
          "  there is nothing here for the guard to act on. That is a correct rejection,\n" +
          "  not a failure: an arbitrary transaction must not be able to move the bound.",
      ),
    );
    return 1;
  }
  const entry = isSnapshot ? "submitReserveSnapshot" : "mintWithProof";
  kv("  event found", isSnapshot ? "ReserveSnapshot" : "Locked", 22);
  kv("  routes to", `${entry}()`, 22);
  console.log("");

  // ── 2. attestation ──────────────────────────────────────────────────────────
  step(2, 4, "Checking attestation via ChainInfo precompile 0x0FD3");
  const info = new Contract(CHAIN_INFO_ADDRESS, CHAIN_INFO_ABI as unknown as string[], ccProvider);
  const latest: any = await info.get_latest_attestation_height_and_hash!(chainKey);
  const attestedTip = Number(latest.height);
  const attested = attestedTip >= height;
  if (!attested) {
    const behind = height - attestedTip;
    stepFail(`height ${height} not yet attested (tip ${attestedTip}, ${behind} blocks behind)`);
    console.log(
      c.grey(
        `\n  Creditcoin attests finalized source blocks, so there is roughly a nine minute\n` +
          `  lag before any given Sepolia block becomes provable. This one needs about\n` +
          `  ${Math.ceil((behind * 12) / 60)} more minute(s). That delay is the cost of not trusting a reporter.`,
      ),
    );
    return 1;
  }
  stepOk(`height ${height} attested (tip ${attestedTip})`);

  // ── 3. proof construction ───────────────────────────────────────────────────
  step(3, 4, "Building Merkle + continuity proof");
  const builder = new proofProvider.service.ProofBuilder(chainKey, RPC.proofBuilder);
  let proof: ProofData;
  try {
    const res: any = await builder.getProof(txHash);
    if (!res?.success || !res?.data) throw new Error(String(res?.error ?? "unknown"));
    proof = res.data as ProofData;
  } catch (e: any) {
    stepFail(String(e?.shortMessage ?? e?.message ?? e).slice(0, 90));
    console.log(
      c.grey(
        "\n  Attestation does not imply the proof is servable yet — the Proof Builder's\n" +
          "  block cache is eventually consistent and returns 422 for a short window\n" +
          "  after attestation. Try again in a minute.",
      ),
    );
    return 1;
  }
  stepOk(
    `${proof.merkleProof.siblings.length} Merkle siblings, ` +
      `${proof.continuityProof.roots.length} continuity roots`,
  );

  // ── 4. the precompile's verdict ─────────────────────────────────────────────
  step(4, 4, `Calling ${entry}() on CC3 (eth_call, no transaction sent)`);
  const iface = new Interface([...ASC_ABI, ...ASC_ERRORS] as unknown as string[]);
  const asc = new Contract(ascAddr, iface, ccProvider);
  const query = toQueryTuple(proof);

  let verdict: "accepted" | "rejected" | "already-processed" = "accepted";
  let reason = "";
  try {
    await asc[entry]!.staticCall(query);
    stepOk("precompile verified the proof, guard accepted it");
  } catch (e: any) {
    reason = describeRevert(iface, e);
    if (/processed|consumed|Replay|already/i.test(reason)) {
      verdict = "already-processed";
      stepOk("proof is valid but already spent");
    } else {
      verdict = "rejected";
      stepFail(reason.slice(0, 110));
    }
  }

  // ── the answer ──────────────────────────────────────────────────────────────
  const s = await readLive();
  heading("Result");

  if (verdict === "accepted") {
    console.log(
      "  " +
        c.green("PROOF VALID") +
        c.grey(" — the Block Prover precompile confirmed this transaction is in an"),
    );
    console.log(c.grey("  attested Sepolia block, and the guard's own checks passed on top of it."));
  } else if (verdict === "already-processed") {
    console.log("  " + c.cyan("PROOF VALID, ALREADY SPENT"));
    console.log(
      c.grey(
        "  The cryptography checks out; the guard has simply seen this query before and\n" +
          "  will not act on it twice. Replay protection working as designed.",
      ),
    );
  } else {
    console.log("  " + c.red("REJECTED") + c.grey(` — ${reason.slice(0, 120)}`));
    console.log(
      c.grey(
        "\n  A rejection here is the system working. The guard refuses anything it cannot\n" +
          "  verify rather than falling back to a reported figure.",
      ),
    );
  }

  console.log("");
  kv("proven reserve", `${units(s.verifiedReserve, s.decimals)} @ height ${s.attestedAtHeight}`);
  kv("outstanding supply", `${units(s.outstandingSupply, s.decimals)} ${s.symbol}`);
  kv("effective backing", units(s.discountedReserve, s.decimals));
  kv(
    "status",
    s.solvent && s.fresh && !s.mintFrozen
      ? c.green("CRYPTOGRAPHICALLY SOLVENT")
      : c.red("MINTING FROZEN"),
  );
  kv("parties trusted", s.trustedParties === 0 ? c.green("0") : c.yellow(String(s.trustedParties)));

  rule();
  console.log(c.grey(`  ${EXPLORER.sepolia}/tx/${txHash}`));
  console.log(c.grey(`  ${EXPLORER.creditcoin}/address/${ascAddr}`));
  console.log("");

  return verdict === "rejected" ? 1 : 0;
}
