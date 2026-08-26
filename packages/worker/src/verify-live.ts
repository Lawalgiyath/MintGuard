import { Contract, JsonRpcProvider, AbiCoder } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { CHAIN_INFO_ABI, CHAIN_INFO_ADDRESS, cfg } from "./config.js";

/**
 * Live integration verification — requires NO deployment and NO funded wallet.
 *
 * The Proof Builder is a read API and the Block Prover's verify() is a view function,
 * so the entire proof path can be exercised against real infrastructure before a single
 * gas unit is spent. This is what separates "our unit tests pass against our own mocks"
 * from "the real precompile accepts what we produce".
 *
 *   npm run verify:live
 */

const abi = AbiCoder.defaultAbiCoder();

const VERIFIER_ABI = [
  "function verify(uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) view returns (bool)",
  "function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof) view returns (uint64)",
];
const VERIFIER_ADDRESS = "0x0000000000000000000000000000000000000FD2";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  const cc = new JsonRpcProvider(cfg.creditcoinRpc);
  const sep = new JsonRpcProvider(cfg.sepoliaRpc);
  const chainKey = cfg.sourceChainKey;

  const chainInfo = new Contract(CHAIN_INFO_ADDRESS, CHAIN_INFO_ABI, cc);
  const verifier = new Contract(VERIFIER_ADDRESS, VERIFIER_ABI, cc);
  const builder = new proofProvider.service.ProofBuilder(chainKey, cfg.proofBuilderUrl);

  console.log("MintBound — live integration verification");
  console.log("=".repeat(66));

  // 1. ChainInfo precompile (the reconstructed interface)
  console.log("\n[1] ChainInfo precompile 0x0FD3 — reconstructed interface");
  const latest = await chainInfo.get_latest_attestation_height_and_hash(BigInt(chainKey));
  const attested = Number(latest.height ?? latest[0]);
  check("get_latest_attestation_height_and_hash responds", attested > 0, `height ${attested}`);

  const head = await sep.getBlockNumber();
  const lag = head - attested;
  check("attestation lag is within a workable window", lag > 0 && lag < 400,
    `${lag} blocks ≈ ${((lag * 12) / 60).toFixed(1)} min`);

  // 2. Find a real attested transaction carrying logs
  console.log("\n[2] Locating a real attested Sepolia transaction");
  let target: { hash: string; block: number; index: number } | null = null;
  for (let h = attested - 6; h > attested - 40 && !target; h--) {
    const blk = await sep.getBlock(h);
    if (!blk || blk.transactions.length < 4) continue;
    for (const txh of blk.transactions.slice(0, 8)) {
      const rc = await sep.getTransactionReceipt(txh);
      if (rc && rc.status === 1 && rc.logs.length > 0) {
        target = { hash: txh, block: h, index: rc.index };
        break;
      }
    }
  }
  if (!target) throw new Error("Could not locate a suitable attested transaction");
  check("found an attested tx with logs", true, `${target.hash.slice(0, 18)}… block ${target.block} idx ${target.index}`);

  // 3. Proof Builder returns the shape our types declare
  console.log("\n[3] Proof Builder API — real proof generation");
  const res = await builder.getProof(target.hash);
  check("getProof succeeded", res.success === true, res.error ?? "");
  const p: any = res.data;
  check("shape matches ContinuityProofData",
    typeof p.chainKey === "number" &&
      typeof p.headerNumber === "number" &&
      typeof p.txBytes === "string" &&
      Array.isArray(p.merkleProof?.siblings) &&
      Array.isArray(p.continuityProof?.roots),
    `${p.merkleProof.siblings.length} siblings, ${p.continuityProof.roots.length} continuity roots`);

  const merkle = {
    root: p.merkleProof.root,
    siblings: p.merkleProof.siblings.map((s: any) => ({ hash: s.hash, isLeft: s.isLeft })),
  };
  const continuity = {
    lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
    roots: p.continuityProof.roots,
  };

  // 4. The real precompile accepts it
  console.log("\n[4] Block Prover precompile 0x0FD2 — real verification");
  const ok = await verifier.verify(BigInt(p.chainKey), BigInt(p.headerNumber), p.txBytes, merkle, continuity);
  check("precompile verifies a genuine proof", ok === true);

  const realIdx = await verifier.calculateTxIndex(merkle);
  check("calculateTxIndex agrees with the receipt", Number(realIdx) === target.index,
    `precompile ${realIdx}, receipt ${target.index}`);

  // MockBlockProver's derivation must match, or replay-protection tests prove nothing.
  let mockIdx = 0n;
  p.merkleProof.siblings.forEach((s: any, i: number) => {
    if (s.isLeft) mockIdx |= 1n << BigInt(i);
  });
  check("MockBlockProver txIndex derivation matches the real precompile",
    mockIdx === BigInt(realIdx), `mock ${mockIdx}, real ${realIdx}`);

  // 5. Negative control — a tampered proof must not verify
  console.log("\n[5] Negative control — tampered proof");
  let rejected = false;
  let how = "";
  try {
    const bad = { ...merkle, root: "0x" + "de".repeat(32) };
    const r = await verifier.verify(BigInt(p.chainKey), BigInt(p.headerNumber), p.txBytes, bad, continuity);
    rejected = r === false;
    how = "returned false";
  } catch (e: any) {
    rejected = true;
    how = "reverted: " + (e.shortMessage ?? e.message ?? "").slice(0, 60);
  }
  check("tampered merkle root is rejected", rejected, how);

  // 6. Real txBytes decode under the exact layout EvmV1Decoder.sol assumes
  console.log("\n[6] EvmV1Decoder layout against real txBytes");
  const [txType, chunks] = abi.decode(["uint8", "bytes[]"], p.txBytes) as unknown as [bigint, string[]];
  check("txType is supported", Number(txType) <= 4, `type ${txType}`);
  check("chunk count matches type", Number(txType) <= 2 ? chunks.length === 3 : chunks.length === 4,
    `${chunks.length} chunks`);

  const receiptIdx = Number(txType) <= 2 ? 2 : 3;
  const [status, , logs] = abi.decode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    chunks[receiptIdx]!,
  ) as unknown as [bigint, bigint, any[], string];
  check("receiptStatus decodes (the mandatory check)", Number(status) === 1, `status ${status}`);
  check("logs decode with emitter + topics + data", logs.length > 0 && !!logs[0][0],
    `${logs.length} logs, first emitter ${String(logs[0][0]).slice(0, 12)}…`);

  console.log("\n" + "=".repeat(66));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error("Live integration is NOT clean. Do not deploy until this passes.");
    process.exitCode = 1;
  } else {
    console.log("Proof path verified end-to-end against live infrastructure.");
    console.log("Remaining unknowns are on-chain gas and deployment only.");
  }
}

main().catch((e) => {
  console.error("\nverify-live failed:", e?.shortMessage ?? e?.message ?? e);
  process.exitCode = 1;
});
