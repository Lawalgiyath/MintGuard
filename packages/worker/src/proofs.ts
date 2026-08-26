import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonRpcApiProvider } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { DEPLOYMENTS_DIR, cfg } from "./config.js";

/**
 * Thin wrapper over the Attestcoin proof pipeline.
 *
 * The API surface here was taken from the shipped SDK (v0.18.0), not from the docs —
 * the docs still describe `proofGenerator.api.ProverAPIProofGenerator`, which no longer
 * exists. The current path is `proofProvider.service.ProofBuilder`.
 */

/** The proof payload the ASC's Query struct is built from. */
export interface ContinuityProofData {
  chainKey: number;
  headerNumber: number;
  txBytes: string;
  merkleProof: { root: string; siblings: { hash: string; isLeft: boolean }[] };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
}

/** Shape the ASC expects: a single Query tuple. */
export function toQueryTuple(p: ContinuityProofData) {
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

export class ProofPipeline {
  private builder: proofProvider.service.ProofBuilder;
  private info: chainInfo.PrecompileChainInfoProvider;

  constructor(
    private creditcoinRpc: JsonRpcApiProvider,
    private sourceRpc: JsonRpcApiProvider,
    private chainKey = cfg.sourceChainKey,
  ) {
    this.builder = new proofProvider.service.ProofBuilder(this.chainKey, cfg.proofBuilderUrl);
    // ethers ships dual ESM/CJS builds with structurally identical but nominally
    // distinct provider types. We import the ESM build; the SDK is typed against the
    // CJS one. Same class at runtime, so this cast is a types-only bridge across a
    // dual-package hazard, not a suppressed real error.
    this.info = new chainInfo.PrecompileChainInfoProvider(
      this.creditcoinRpc as unknown as ConstructorParameters<
        typeof chainInfo.PrecompileChainInfoProvider
      >[0],
    );
  }

  /** Latest source-chain height Creditcoin has attested. The same number the ASC reads. */
  async latestAttestedHeight(): Promise<number> {
    const r = await this.info.getLatestAttestedHeightAndHash(this.chainKey);
    return Number(r.height);
  }

  /** How far behind the source tip attestation currently is. */
  async attestationLag(): Promise<{ head: number; attested: number; lag: number }> {
    const [head, attested] = await Promise.all([
      this.sourceRpc.getBlockNumber(),
      this.latestAttestedHeight(),
    ]);
    return { head, attested, lag: head - attested };
  }

  /**
   * Wait for a source transaction to be attested, then build its proof.
   *
   * Expect this to take roughly 9 minutes on CC3 testnet. That is a protocol property,
   * not a bug — Creditcoin attests finalized source blocks, and Sepolia finality plus
   * attestor gossip is the cost of not trusting anyone.
   */
  async proofFor(txHash: string, label = ""): Promise<ContinuityProofData> {
    const tx = await this.sourceRpc.getTransaction(txHash);
    if (!tx) throw new Error(`Transaction ${txHash} not found on source chain`);
    if (!tx.blockNumber) throw new Error(`Transaction ${txHash} not yet mined`);

    const attested = await this.latestAttestedHeight();
    const behind = tx.blockNumber - attested;
    console.log(
      `  [proof${label ? " " + label : ""}] tx in block ${tx.blockNumber}; attested tip ${attested}` +
        (behind > 0 ? ` (waiting ~${Math.ceil((behind * 12) / 60)} min)` : " (already attested)"),
    );

    // Poll every 15s, give up after 20 minutes.
    await this.builder.waitUntilHeightAttested(this.chainKey, tx.blockNumber, 15_000, 1_200_000);

    // OBSERVED LIVE (2026-08-25): attestation does NOT imply the proof is servable yet.
    // The Proof Builder returned HTTP 422 for a transaction that was already attested,
    // then served the same transaction successfully minutes later — its block cache is
    // eventually consistent. Treating the first failure as fatal would strand mints
    // that are perfectly valid, so retry with backoff before giving up.
    const result = await this.getProofWithRetry(txHash);

    const proof = result as unknown as ContinuityProofData;
    if (cfg.captureProofs) captureProof(txHash, label, proof);
    return proof;
  }

  /** Retry proof generation with backoff; the prover's cache is eventually consistent. */
  private async getProofWithRetry(txHash: string, attempts = 6): Promise<unknown> {
    let lastError = "unknown";
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await this.builder.getProof(txHash);
        if (r.success && r.data) return r.data;
        lastError = String(r.error ?? "unknown");
      } catch (e: any) {
        lastError = e?.shortMessage ?? e?.message ?? String(e);
      }
      if (i < attempts - 1) {
        const wait = 20_000 * (i + 1); // 20s, 40s, 60s, 80s, 100s
        console.log(
          `  [proof] not servable yet (${lastError.slice(0, 90)}); retrying in ${wait / 1000}s ` +
            `[${i + 1}/${attempts - 1}]`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw new Error(`Proof generation failed for ${txHash} after ${attempts} attempts: ${lastError}`);
  }
}

/**
 * Gas limit for a proof submission.
 *
 * Gluwa's own examples document this: gas estimation against the Block Prover
 * precompile FAILS even when the call would succeed, because pallet-evm does not
 * reliably propagate revert reasons in estimation mode. Relying on estimateGas alone
 * means the first live submission dies with a confusing error.
 *
 * So: try to estimate, and fall back to a size-derived figure keyed off the continuity
 * proof length, which is what actually drives verification cost.
 */
export async function gasLimitFor(
  provider: JsonRpcApiProvider,
  to: string,
  data: string,
  from: string,
  continuityBlocks: number,
): Promise<bigint> {
  try {
    const estimated = await provider.estimateGas({ to, data, from });
    return (estimated * 135n) / 100n; // +35% headroom
  } catch (e: any) {
    const fallback = BigInt(21_000 + continuityBlocks * 5_000 + 20_000 + 250_000);
    console.warn(
      `  [gas] estimation failed (${e?.shortMessage ?? e?.message ?? "unknown"}); ` +
        `using size-derived limit ${fallback} for ${continuityBlocks} continuity blocks`,
    );
    return fallback;
  }
}

// ─── Replay capture ───────────────────────────────────────────────────────────
// Every proof the worker generates is genuine cryptographic material. Recording it
// lets the dashboard replay a real run instantly instead of asking an audience to
// watch a 9-minute attestation wait. The data is real; only the timing is compressed,
// and the UI says so explicitly.

export interface CapturedProof {
  txHash: string;
  label: string;
  capturedAt: string;
  proof: ContinuityProofData;
}

const bundlePath = () => join(DEPLOYMENTS_DIR, "replay-bundle.json");

export function captureProof(txHash: string, label: string, proof: ContinuityProofData) {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const p = bundlePath();
  const existing: CapturedProof[] = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
  if (existing.some((e) => e.txHash === txHash)) return;
  existing.push({ txHash, label, capturedAt: new Date().toISOString(), proof });
  writeFileSync(p, JSON.stringify(existing, null, 2) + "\n", "utf8");
  console.log(`  [capture] recorded proof for ${label || txHash} (${existing.length} in bundle)`);
}
