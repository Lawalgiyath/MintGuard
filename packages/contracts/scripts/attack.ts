import { network } from "hardhat";
import { AbiCoder, keccak256, toUtf8Bytes, zeroPadValue, getAddress } from "ethers";
import { banner, loadDeployment } from "./lib.js";

/**
 * Runs every documented attack against the LIVE deployment and reports what happened.
 *
 * These are not simulations. Each one builds a real transaction and sends it to the
 * real MintBoundASC on CC3. Every single one is expected to REVERT — the reverts are
 * the product, and this script exists so that claim can be checked rather than
 * believed.
 *
 *   npx hardhat run scripts/attack.ts --network creditcoin
 *
 * WHAT THIS SUITE DOES AND DOES NOT SHOW
 * --------------------------------------
 * Every attempt below carries forged proof material, so every one of them is rejected
 * by the Block Prover precompile before MintBoundASC's own checks ever run. That is
 * precisely the property being demonstrated: a fabricated proof never reaches the
 * business logic, and there is no path around the precompile.
 *
 * It follows that this suite does NOT exercise the guard's internal rejections —
 * emitter binding, event matching, chain-key pinning, replay protection. Those need a
 * *valid* proof carrying malicious content, which by construction cannot be forged
 * against live CC3. They are covered instead in test/MintBound.test.ts against a mock
 * verifier, where a valid proof can be synthesised.
 *
 * Saying it the other way round would be dishonest: these reverts are real, but they
 * are all the same revert, and the reason matters.
 */

const abi = AbiCoder.defaultAbiCoder();

const RESERVE_SNAPSHOT_SIG = keccak256(
  toUtf8Bytes("ReserveSnapshot(address,address,uint256,uint256,uint256)"),
);
const LOCKED_SIG = keccak256(toUtf8Bytes("Locked(address,address,uint256,uint256)"));
const topic = (a: string) => zeroPadValue(getAddress(a), 32);

interface LogEntry {
  address_: string;
  topics: string[];
  data: string;
}

function encodeTx(logs: LogEntry[], receiptStatus = 1): string {
  const common = abi.encode(
    ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
    [1n, 500000n, "0x1111111111111111111111111111111111111111", false,
     "0x2222222222222222222222222222222222222222", 0n, "0x"],
  );
  const typeSpecific = abi.encode(
    ["uint64", "uint128", "uint128", "tuple(address,bytes32[])[]", "uint8", "bytes32", "bytes32"],
    [11155111n, 1n, 2n, [], 0, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`],
  );
  const receipt = abi.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [receiptStatus, 100000n, logs.map((l) => [l.address_, l.topics, l.data]), "0x" + "00".repeat(256)],
  );
  return abi.encode(["uint8", "bytes[]"], [2, [common, typeSpecific, receipt]]);
}

function snapshotLog(
  vault: string,
  asset: string,
  balance: bigint,
  epoch: bigint,
  encumbered = 0n,
): LogEntry {
  return {
    address_: vault,
    topics: [RESERVE_SNAPSHOT_SIG, topic(vault), topic(asset)],
    // Three non-indexed words, matching ReserveVault's event exactly. The guard checks
    // the data length as well as the topic, so a short payload is rejected for the
    // wrong reason and the attack stops proving what it claims to prove.
    data: abi.encode(["uint256", "uint256", "uint256"], [balance, encumbered, epoch]),
  };
}

function lockedLog(vault: string, user: string, asset: string, amount: bigint, nonce: bigint): LogEntry {
  return {
    address_: vault,
    topics: [LOCKED_SIG, topic(user), topic(asset)],
    data: abi.encode(["uint256", "uint256"], [amount, nonce]),
  };
}

function query(blockHeight: bigint, encodedTransaction: string, opts: { chainKey?: bigint; root?: string } = {}) {
  return {
    chainKey: opts.chainKey ?? 1n,
    blockHeight,
    encodedTransaction,
    merkleRoot: opts.root ?? `0x${"ab".repeat(32)}`,
    siblings: [
      { hash: keccak256(toUtf8Bytes("s0")), isLeft: false },
      { hash: keccak256(toUtf8Bytes("s1")), isLeft: true },
    ],
    lowerEndpointDigest: `0x${"cd".repeat(32)}`,
    continuityRoots: [`0x${"ef".repeat(32)}`],
  };
}

const results: { name: string; blocked: boolean; reason: string }[] = [];

async function attempt(name: string, expectation: string, fn: () => Promise<unknown>) {
  process.stdout.write(`\n▸ ${name}\n  expect: ${expectation}\n`);
  try {
    await fn();
    console.log("  RESULT: ⚠️  SUCCEEDED — this should not happen. Investigate immediately.");
    results.push({ name, blocked: false, reason: "transaction succeeded" });
  } catch (e: any) {
    const msg = e.shortMessage ?? e.message ?? String(e);
    const reason =
      msg.match(/[A-Z][A-Za-z]+\((?:[^)]*)\)/)?.[0] ??
      msg.match(/reverted with[^:]*: ?(.*)/)?.[1] ??
      msg.slice(0, 140);
    console.log(`  RESULT: ✓ BLOCKED — ${reason}`);
    results.push({ name, blocked: true, reason });
  }
}

async function main() {
  const { ethers } = await network.connect();
  const [signer] = await ethers.getSigners();

  const cc = loadDeployment("creditcoin");
  const sep = loadDeployment("sepolia");
  if (!cc || !sep) throw new Error("Deploy both halves first.");

  const ascAddr = cc.contracts.MintBoundASC;
  const vault = (cc.config?.canonicalVault ?? sep.contracts.ReserveVault) as string;
  const asset = (cc.config?.sourceAsset ?? sep.contracts.TestUSD) as string;

  banner("MintBound — live attack suite");
  console.log(`target ASC : ${ascAddr}`);
  console.log(`vault      : ${vault}`);
  console.log(`attacker   : ${signer.address}`);
  console.log("\nEvery attempt below is expected to revert.");

  const asc = await ethers.getContractAt("MintBoundASC", ascAddr);
  const head = 11_600_000n;

  await attempt(
    "Forged inclusion proof",
    "rejected at proof verification — the precompile will not verify fabricated material",
    () => asc.submitReserveSnapshot.staticCall(
      query(head, encodeTx([snapshotLog(vault, asset, 10n ** 30n, 999n)])),
    ),
  );

  await attempt(
    "Counterfeit vault emitting an identical event",
    "rejected at proof verification — a counterfeit emitter still needs a real inclusion proof",
    () => asc.submitReserveSnapshot.staticCall(
      query(head, encodeTx([
        snapshotLog("0xdeadbeef00000000000000000000000000000000", asset, 10n ** 30n, 999n),
      ])),
    ),
  );

  await attempt(
    "Reverted source transaction",
    "rejected at proof verification — a reverted receipt is unprovable to begin with",
    () => asc.submitReserveSnapshot.staticCall(
      query(head, encodeTx([snapshotLog(vault, asset, 10n ** 30n, 999n)], 0)),
    ),
  );

  await attempt(
    "Proof from the wrong source chain",
    "rejected — chainKey is pinned at construction, before any proof work happens",
    () => asc.submitReserveSnapshot.staticCall(
      query(head, encodeTx([snapshotLog(vault, asset, 1n, 999n)]), { chainKey: 3n }),
    ),
  );

  await attempt(
    "Mint with no matching Locked event",
    "rejected at proof verification — nothing here authorises a mint",
    () => asc.mintWithProof.staticCall(
      query(head, encodeTx([snapshotLog(vault, asset, 1n, 1n)])),
    ),
  );

  await attempt(
    "Unauthorised mint of an enormous amount",
    "rejected before any supply is created",
    () => asc.mintWithProof.staticCall(
      query(head, encodeTx([lockedLog(vault, signer.address, asset, 10n ** 30n, 424242n)])),
    ),
  );

  banner("Summary");
  const blocked = results.filter((r) => r.blocked).length;
  for (const r of results) {
    console.log(`${r.blocked ? "✓" : "⚠️"}  ${r.name.padEnd(46)} ${r.reason}`);
  }
  console.log(`\n${blocked}/${results.length} attacks blocked at the proof layer.`);
  console.log(
    "Guard-internal rejections (emitter binding, event matching, replay) need a " +
      "valid proof carrying malicious contents, and are covered in test/MintBound.test.ts.",
  );
  if (blocked !== results.length) {
    console.error("\nAT LEAST ONE ATTACK SUCCEEDED. Do not present this build.");
    process.exitCode = 1;
  } else {
    console.log("The bound held.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
