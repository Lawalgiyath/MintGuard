import { NextResponse } from "next/server";
import { Contract, JsonRpcProvider, AbiCoder } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { rpc } from "@/lib/deployments";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * Live proof verification for ANY Ethereum Sepolia transaction.
 *
 * This endpoint proves the whole MintBound thesis on a transaction the operator does
 * not control and has never seen — which is a far stronger demonstration than proving
 * our own. Nothing here is deployed by us: it uses Creditcoin's Proof Builder (a read
 * API) and the Block Prover precompile's `verify()` (a view function), so it costs no
 * gas and needs no wallet.
 *
 * The last step is the important one. It tampers with the Merkle root and shows the
 * precompile refusing it. Without a negative control, "it returned true" proves nothing.
 */

const abi = AbiCoder.defaultAbiCoder();

const VERIFIER = "0x0000000000000000000000000000000000000FD2";
const CHAIN_INFO = "0x0000000000000000000000000000000000000fD3";
const CHAIN_KEY = 1n;

const VERIFIER_ABI = [
  "function verify(uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) view returns (bool)",
  "function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof) view returns (uint64)",
];
const CHAIN_INFO_ABI = [
  "function get_latest_attestation_height_and_hash(uint64) view returns ((uint64 height,bytes32 hash,bool isAttestation,bool exists))",
];

export interface Step {
  id: string;
  label: string;
  detail: string;
  status: "ok" | "fail" | "info";
  data?: Record<string, string | number | boolean>;
}

export async function POST(req: Request) {
  let txHash = "";
  try {
    const body = await req.json();
    txHash = String(body.txHash ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json(
      { error: "That is not a transaction hash. Expected 0x followed by 64 hex characters." },
      { status: 400 },
    );
  }

  const steps: Step[] = [];
  const sep = new JsonRpcProvider(rpc.sepolia);
  const cc = new JsonRpcProvider(rpc.creditcoin);
  const verifier = new Contract(VERIFIER, VERIFIER_ABI, cc);
  const chainInfo = new Contract(CHAIN_INFO, CHAIN_INFO_ABI, cc);

  try {
    // 1 — the transaction exists on the source chain
    const tx = await sep.getTransaction(txHash);
    if (!tx || !tx.blockNumber) {
      steps.push({
        id: "found",
        label: "Locate on Ethereum Sepolia",
        detail: "Transaction not found, or not yet mined.",
        status: "fail",
      });
      return NextResponse.json({ txHash, steps, verified: false });
    }
    const receipt = await sep.getTransactionReceipt(txHash);
    steps.push({
      id: "found",
      label: "Locate on Ethereum Sepolia",
      detail: `Found in block ${tx.blockNumber}, position ${receipt?.index ?? "?"}.`,
      status: "ok",
      data: {
        block: tx.blockNumber,
        txIndex: receipt?.index ?? -1,
        type: tx.type ?? 0,
        receiptStatus: receipt?.status ?? 0,
        logs: receipt?.logs.length ?? 0,
      },
    });

    // 2 — has Creditcoin attested that height?
    const latest = await chainInfo.get_latest_attestation_height_and_hash(CHAIN_KEY);
    const attested = Number(latest.height ?? latest[0]);
    const isAttested = tx.blockNumber <= attested;
    steps.push({
      id: "attested",
      label: "Attested on Creditcoin",
      detail: isAttested
        ? `Creditcoin has attested up to source block ${attested.toLocaleString()}, which covers this one.`
        : `Creditcoin has only attested to block ${attested.toLocaleString()}. This transaction is ${(tx.blockNumber - attested).toLocaleString()} blocks ahead — roughly ${Math.ceil(((tx.blockNumber - attested) * 12) / 60)} more minutes.`,
      status: isAttested ? "ok" : "fail",
      data: { attestedHeight: attested, txBlock: tx.blockNumber, source: "ChainInfo precompile 0x0FD3" },
    });
    if (!isAttested) return NextResponse.json({ txHash, steps, verified: false });

    // 3 — generate a real proof
    const builder = new proofProvider.service.ProofBuilder(
      Number(CHAIN_KEY),
      process.env.PROOF_BUILDER_URL ?? "https://proof-gen-api.cc3-testnet.creditcoin.network",
    );
    const res = await builder.getProof(txHash);
    if (!res.success || !res.data) {
      steps.push({
        id: "proof",
        label: "Generate inclusion proof",
        detail:
          "The Proof Builder cannot serve this transaction yet. Attestation does not imply the prover has cached the block — this usually resolves within a few minutes.",
        status: "fail",
      });
      return NextResponse.json({ txHash, steps, verified: false });
    }
    const p: any = res.data;
    steps.push({
      id: "proof",
      label: "Generate inclusion proof",
      detail: `Merkle proof with ${p.merkleProof.siblings.length} siblings and a continuity chain of ${p.continuityProof.roots.length} roots.`,
      status: "ok",
      data: {
        merkleRoot: p.merkleProof.root,
        siblings: p.merkleProof.siblings.length,
        continuityRoots: p.continuityProof.roots.length,
        txBytesSize: `${Math.round((p.txBytes.length - 2) / 2)} bytes`,
      },
    });

    const merkle = {
      root: p.merkleProof.root,
      siblings: p.merkleProof.siblings.map((x: any) => ({ hash: x.hash, isLeft: x.isLeft })),
    };
    const continuity = {
      lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
      roots: p.continuityProof.roots,
    };

    // 4 — the precompile itself verifies it
    const ok: boolean = await verifier.verify(
      BigInt(p.chainKey),
      BigInt(p.headerNumber),
      p.txBytes,
      merkle,
      continuity,
    );
    const idx = await verifier.calculateTxIndex(merkle);
    steps.push({
      id: "verify",
      label: "Verified by Block Prover precompile 0x0FD2",
      detail: ok
        ? "Native Creditcoin code confirms this transaction was included in an attested Sepolia block. No oracle, no committee, no reporter."
        : "The precompile did not verify this proof.",
      status: ok ? "ok" : "fail",
      data: { result: ok, txIndexFromProof: Number(idx), replayKey: `(1, ${p.headerNumber}, ${idx})` },
    });

    // 5 — decode exactly as MintBoundASC does
    try {
      const [txType, chunks] = abi.decode(["uint8", "bytes[]"], p.txBytes) as unknown as [
        bigint,
        string[],
      ];
      const ridx = Number(txType) <= 2 ? 2 : 3;
      const [status, , logs] = abi.decode(
        ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
        chunks[ridx]!,
      ) as unknown as [bigint, bigint, any[], string];

      steps.push({
        id: "decode",
        label: "Decode receipt and logs",
        detail:
          Number(status) === 1
            ? logs.length === 0
              ? "Receipt status is 1. This transaction emitted no logs — MintBound would reject it for lacking a vault event, which is the correct outcome."
              : `Receipt status is 1. ${logs.length} log${logs.length === 1 ? "" : "s"} decoded, each bound to its emitting contract.`
            : `Receipt status is ${status} — this transaction REVERTED. The precompile still proves inclusion, which is exactly why MintBound checks the status itself.`,
        status: Number(status) === 1 ? "ok" : "info",
        data: {
          txType: Number(txType),
          receiptStatus: Number(status),
          logCount: logs.length,
          // ethers v6 Result proxies THROW on out-of-range index access rather than
          // returning undefined, so a truthiness guard on logs[0] is itself unsafe.
          // Check the length.
          firstEmitter: logs.length > 0 ? String(logs[0][0]) : "— (no logs)",
        },
      });
    } catch (e: any) {
      steps.push({
        id: "decode",
        label: "Decode receipt and logs",
        detail: `Could not decode this transaction shape: ${String(e?.message ?? e).slice(0, 120)}`,
        status: "info",
      });
    }

    // 6 — negative control. Without this, step 4 proves nothing.
    let tamperRejected = false;
    let tamperDetail = "";
    try {
      const bad = { ...merkle, root: "0x" + "de".repeat(32) };
      const r: boolean = await verifier.verify(
        BigInt(p.chainKey),
        BigInt(p.headerNumber),
        p.txBytes,
        bad,
        continuity,
      );
      tamperRejected = r === false;
      tamperDetail = r === false ? "Returned false." : "Accepted a tampered proof — this would be alarming.";
    } catch (e: any) {
      tamperRejected = true;
      tamperDetail = `Reverted: ${String(e?.shortMessage ?? e?.message ?? "").slice(0, 90)}`;
    }
    steps.push({
      id: "tamper",
      label: "Negative control — tampered Merkle root",
      detail: tamperRejected
        ? `The same proof with one field altered is refused. ${tamperDetail}`
        : tamperDetail,
      status: tamperRejected ? "ok" : "fail",
    });

    return NextResponse.json({
      txHash,
      steps,
      verified: ok && tamperRejected,
      explorer: `https://sepolia.etherscan.io/tx/${txHash}`,
    });
  } catch (e: any) {
    steps.push({
      id: "error",
      label: "Verification aborted",
      detail: String(e?.shortMessage ?? e?.message ?? e).slice(0, 200),
      status: "fail",
    });
    return NextResponse.json({ txHash, steps, verified: false });
  }
}
