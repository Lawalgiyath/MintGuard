import { NextResponse } from "next/server";
import { replayBundle } from "@/lib/deployments";

export const dynamic = "force-dynamic";

/**
 * REPLAY mode's data source: proof material genuinely captured from live testnet runs.
 *
 * The worker records every proof it obtains from the Attestcoin Proof Builder into
 * `deployments/replay-bundle.json`. These are the real artefacts — the transaction
 * hashes resolve on Etherscan, the Merkle roots and continuity roots are the ones the
 * Block Prover precompile actually verified.
 *
 * REPLAY exists because Creditcoin attests finalized Sepolia blocks roughly nine minutes
 * behind the tip, so a deposit cannot become a mint inside a short demo. Replaying
 * captured proofs compresses the waiting without inventing the cryptography.
 *
 * Only a summary crosses the wire. The full bundle is close to a megabyte, most of it
 * `txBytes`, and none of that is needed to show what was proven.
 */
export async function GET() {
  const raw = replayBundle() as any[];

  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({
      available: false,
      reason:
        "No capture bundle found. Run the worker with CAPTURE_PROOFS=true to record real proofs.",
      entries: [],
    });
  }

  // Most recent first, trimmed to what the ledger can meaningfully show.
  const entries = raw
    .slice(-14)
    .reverse()
    .map((e) => {
      const p = e?.proof ?? {};
      return {
        txHash: String(e?.txHash ?? ""),
        label: String(e?.label ?? ""),
        capturedAt: String(e?.capturedAt ?? ""),
        headerNumber: Number(p?.headerNumber ?? 0),
        txIndex: Number(p?.txIndex ?? 0),
        merkleRoot: String(p?.merkleProof?.root ?? ""),
        siblings: Array.isArray(p?.merkleProof?.siblings) ? p.merkleProof.siblings.length : 0,
        continuityRoots: Array.isArray(p?.continuityProof?.roots)
          ? p.continuityProof.roots.length
          : 0,
      };
    });

  return NextResponse.json({
    available: true,
    total: raw.length,
    entries,
  });
}
