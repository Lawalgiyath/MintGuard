import hre, { network } from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { banner, loadDeployment } from "./lib.js";

/**
 * Publish source for every deployed contract, so that anyone clicking through from an
 * address lands on readable Solidity rather than bytecode.
 *
 *   npx hardhat run scripts/verify-source.ts --network creditcoin
 *   npx hardhat run scripts/verify-source.ts --network sepolia
 *
 * This is not housekeeping. The whole claim of this project is that you do not have to
 * trust us — and an unverified contract is precisely a claim you cannot check. Every
 * number the CLI and the dashboard report is only as good as the source behind the
 * address being readable.
 *
 * CONSTRUCTOR ARGUMENTS ARE READ BACK FROM THE CHAIN wherever the contract exposes them,
 * rather than copied from the deploy script. A verification that succeeds against
 * arguments we merely believe we used proves less than one that succeeds against the
 * arguments the deployed contract actually reports.
 */

interface Target {
  name: string;
  address: string;
  args: unknown[];
}

async function main() {
  const conn = await network.connect();
  const { ethers } = conn;
  const net = (await ethers.provider.getNetwork()).chainId;

  const isCreditcoin = net === 102031n;
  const key = isCreditcoin ? "creditcoin" : "sepolia";
  const dep = loadDeployment(key);
  if (!dep) throw new Error(`No deployment record for ${key}.`);

  banner(`MintBound — publish source (${key}, chainId ${net})`);

  const targets: Target[] = [];

  if (isCreditcoin) {
    const c = dep.contracts;

    // Recovered on-chain: these are immutables, so what the contract reports IS what it
    // was constructed with.
    const asc = await ethers.getContractAt("MintBoundASC", c.MintBoundASC!);
    targets.push({
      name: "MintBoundASC",
      address: c.MintBoundASC!,
      args: [
        await asc.SOURCE_CHAIN_KEY(),
        await asc.CANONICAL_VAULT(),
        await asc.maxStalenessBlocks(),
      ],
    });

    const wrapped = await ethers.getContractAt("WrappedAsset", c.WrappedAsset!);
    targets.push({
      name: "WrappedAsset",
      address: c.WrappedAsset!,
      args: [
        await wrapped.name(),
        await wrapped.symbol(),
        await wrapped.decimals(),
        await wrapped.MINTER(),
      ],
    });

    if (c.ProvenReserveFeed) {
      const feed = await ethers.getContractAt("ProvenReserveFeed", c.ProvenReserveFeed);
      targets.push({
        name: "ProvenReserveFeed",
        address: c.ProvenReserveFeed,
        args: [
          await feed.ORACLE(),
          await feed.SOURCE_ASSET(),
          await feed.decimals(),
          await feed.description(),
        ],
      });
    }

    // The remaining three take arguments that are not all exposed as public getters, so
    // they come from the deploy script's literals. Kept beside the deploy script on
    // purpose — if one changes, both must.
    if (c.SecureMintReference) {
      targets.push({
        name: "SecureMintReference",
        address: c.SecureMintReference,
        args: [c.ProvenReserveFeed!, 3600n],
      });
    }

    if (c.ConventionalPoRFeed) {
      targets.push({
        name: "ConventionalPoRFeed",
        address: c.ConventionalPoRFeed,
        args: [c.MintBoundASC!, String(dep.config?.sourceAsset), 18, 1800n],
      });
    }

    if (c.SolvencyGatedCredit) {
      targets.push({
        name: "SolvencyGatedCredit",
        address: c.SolvencyGatedCredit,
        args: [c.MintBoundASC!, 10_000],
      });
    }

    if (c.SolvencyContinuity) {
      const cont = await ethers.getContractAt("SolvencyContinuity", c.SolvencyContinuity);
      targets.push({
        name: "SolvencyContinuity",
        address: c.SolvencyContinuity,
        args: [
          await cont.ASC(),
          await cont.SOURCE_CHAIN_KEY(),
          await cont.CANONICAL_VAULT(),
          await cont.MIN_BOND(),
          await cont.LIVENESS(),
        ],
      });
    }
  } else {
    const c = dep.contracts;

    const asset = await ethers.getContractAt("TestUSD", c.TestUSD!);
    targets.push({
      name: "TestUSD",
      address: c.TestUSD!,
      args: [await asset.name(), await asset.symbol(), await asset.decimals()],
    });

    const vault = await ethers.getContractAt("ReserveVault", c.ReserveVault!);
    targets.push({
      name: "ReserveVault",
      address: c.ReserveVault!,
      args: [
        Number(dep.config?.minSnapshotGap ?? 5),
        await vault.WITHDRAWAL_DELAY(),
      ],
    });

    if (c.SupplyBeacon) {
      // The beacon watches the WRAPPED token, which lives in the Creditcoin deployment
      // record rather than this one. Reading it from the wrong file yields an empty
      // address and a verification that fails for a reason that looks like a plugin bug.
      const cc = loadDeployment("creditcoin");
      const wrappedOnCc = cc?.contracts?.WrappedAsset;
      if (wrappedOnCc) {
        targets.push({
          name: "SupplyBeacon",
          address: c.SupplyBeacon,
          args: [wrappedOnCc, 5n],
        });
      } else {
        console.log("! SupplyBeacon skipped — no Creditcoin deployment record found.");
      }
    }
  }

  // Blockscout serves CC3 and needs no key. Sepolia goes to Sourcify, which also needs
  // no key — deliberately, so that reproducing this requires no credentials from us.
  const provider = isCreditcoin ? "blockscout" : "sourcify";
  console.log(`verification provider: ${provider}`);

  const results: { name: string; ok: boolean; note: string }[] = [];

  for (const t of targets) {
    process.stdout.write(`\n▸ ${t.name.padEnd(22)} ${t.address}\n`);
    console.log(`  args: ${t.args.map((a) => String(a)).join(", ") || "(none)"}`);
    try {
      await verifyContract(
        { address: t.address, constructorArgs: t.args, provider },
        hre,
      );
      console.log("  ✓ published");
      results.push({ name: t.name, ok: true, note: "published" });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // "Already verified" is a success from the reader's point of view — the source is
      // there — so do not report it as a failure.
      const already = /already verified|already been verified/i.test(msg);
      console.log(already ? "  ✓ already verified" : `  ✗ ${msg.slice(0, 160)}`);
      results.push({
        name: t.name,
        ok: already,
        note: already ? "already verified" : msg.slice(0, 100),
      });
    }
  }

  banner("Summary");
  const ok = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"}  ${r.name.padEnd(22)} ${r.note}`);
  console.log(`\n${ok}/${results.length} contracts have published source.`);
  if (ok !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
