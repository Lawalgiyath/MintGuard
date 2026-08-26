import { buildTrustPath, healthOf, type DashboardSnapshot, type LedgerEntry, type SolvencyState } from "./types";

/**
 * The scenario engine behind SIMULATED mode.
 *
 * This is the demo script, executable. Each act is a deterministic transition, so the
 * same keystrokes always produce the same screen — which is what makes it safe to
 * present live. It exists because the protocol itself makes a live end-to-end run
 * impossible inside a short demo: Creditcoin attests Sepolia blocks roughly nine
 * minutes late (measured, see docs/RESEARCH.md), so a real deposit cannot become a real
 * mint while an audience watches.
 *
 * Every value it produces is labelled `simulated` at the data level and can never be
 * mistaken for a live reading. The numbers are chosen to match what the contracts
 * actually do — each act corresponds to a passing test in MintBound.test.ts, and the
 * ratios below are the ratios those tests assert.
 */

const E18 = 10n ** 18n;
const u = (n: number) => BigInt(Math.round(n * 1e6)) * (E18 / 1_000_000n);

const RESERVE_0 = u(1_000_000);
const SRC_HEIGHT_0 = 11_563_510;

function baseState(over: Partial<SolvencyState> = {}): SolvencyState {
  const verifiedReserve = over.verifiedReserve ?? RESERVE_0;
  const haircutBps = over.haircutBps ?? 10000;
  const outstandingSupply = over.outstandingSupply ?? 0n;
  const encumberedReserve = over.encumberedReserve ?? 0n;
  // Announced exits stop counting as backing the moment they are proven — long before
  // the funds are allowed to move. This is what closes the detection window.
  const unencumbered =
    verifiedReserve > encumberedReserve ? verifiedReserve - encumberedReserve : 0n;
  const discountedReserve = (unencumbered * BigInt(haircutBps)) / 10000n;

  const ratio =
    outstandingSupply === 0n
      ? 4294967295
      : Number((discountedReserve * 10000n) / outstandingSupply);

  return {
    verifiedReserve,
    encumberedReserve,
    outstandingSupply,
    discountedReserve,
    maxMintable: discountedReserve > outstandingSupply ? discountedReserve - outstandingSupply : 0n,
    collateralRatioBps: ratio,
    haircutBps,
    epoch: 1,
    attestedAtHeight: SRC_HEIGHT_0,
    latestAttestedHeight: SRC_HEIGHT_0 + 12,
    stalenessBlocks: 12,
    maxStalenessBlocks: 200,
    fresh: true,
    solvent: discountedReserve >= outstandingSupply,
    mintFrozen: false,
    decimals: 18,
    symbol: "wmTUSD",
    trustedParties: 0,
    ...over,
  };
}

/**
 * A fixed demo clock. Using Date.now() here would produce different values in the
 * server render and the client hydration, which React rejects. The acts are a script,
 * so their timestamps are part of the script.
 */
const DEMO_T0 = Date.UTC(2026, 8, 6, 14, 30, 0);

let seq = 0;
function entry(
  kind: LedgerEntry["kind"],
  title: string,
  detail: string,
  opts: Partial<LedgerEntry> = {},
): LedgerEntry {
  const n = seq++;
  return {
    id: `sim-${n}`,
    at: DEMO_T0 + n * 37_000,
    kind,
    title,
    detail,
    provenance: "simulated",
    ...opts,
  };
}

export interface Act {
  /** Optional divergence figures for the reported-vs-proven panel. */
  divergence?: {
    reportedAnswer: bigint;
    reportedAgeSeconds: number;
    provenAnswer: bigint;
    provenAgeSeconds: number;
  };
  name: string;
  caption: string;
  /** The narration line for this beat of the demo. */
  script: string;
  state: SolvencyState;
  add: LedgerEntry[];
}

export function buildActs(): Act[] {
  seq = 0;

  const acts: Act[] = [];

  // ── 0 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Genesis",
    caption: "A proven reserve, no supply yet",
    script:
      "Every number on this screen is a cryptographic fact, not a report. No oracle network told us this. A native precompile proved it.",
    state: baseState(),
    add: [
      entry(
        "ReserveProven",
        "Reserve proven",
        `balance 1,000,000.00 · source block ${SRC_HEIGHT_0} · epoch 1`,
      ),
    ],
  });

  // ── 1 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Mint",
    caption: "600,000 minted against a proven lock",
    script:
      "A deposit lands on Sepolia. The worker proves it. The bound is checked against the aggregate, not against the deposit — and the mint clears.",
    state: baseState({ outstandingSupply: u(600_000), epoch: 2 }),
    add: [
      entry("Minted", "Minted", "600,000.00 to 0x71C7…976F · nonce 1"),
      entry("InvariantChecked", "Bound checked", "supply 600,000.00 vs ceiling 1,000,000.00 · 166.67%"),
    ],
  });

  // ── 2 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "At the bound",
    caption: "Supply exactly equals the proven ceiling",
    script:
      "Mint right up to the bound and it holds at exactly one hundred percent. One wei more and it reverts.",
    state: baseState({ outstandingSupply: u(1_000_000), epoch: 3 }),
    add: [
      entry("Minted", "Minted", "400,000.00 to 0x9A3f…21B8 · nonce 2"),
      entry("InvariantChecked", "Bound checked", "supply 1,000,000.00 vs ceiling 1,000,000.00 · 100.00%"),
      entry("Rejected", "Mint rejected", "InvariantViolated — 1,000,000.000000000000000001 exceeds the ceiling", {
        held: true,
      }),
    ],
  });

  // ── 3 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Forged proof",
    caption: "A fabricated inclusion proof",
    script:
      "An attacker submits a proof that was never in a Sepolia block. The precompile refuses to verify it, and nothing moves.",
    state: baseState({ outstandingSupply: u(1_000_000), epoch: 3 }),
    add: [
      entry("Rejected", "Forged proof rejected", "VerificationFailed — precompile 0x0FD2 would not verify", {
        held: true,
      }),
    ],
  });

  // ── 4 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Replay",
    caption: "A genuine proof, submitted twice",
    script:
      "Now a proof that is completely valid — just already used. One deposit authorises exactly one mint, forever.",
    state: baseState({ outstandingSupply: u(1_000_000), epoch: 3 }),
    add: [
      entry("Rejected", "Replay rejected", "LockAlreadyConsumed — deposit nonce 1 was already spent", {
        held: true,
      }),
      entry("Rejected", "Query replay rejected", "QueryAlreadyProcessed — (chainKey, height, txIndex) seen", {
        held: true,
      }),
    ],
  });

  // ── 5 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Reverted source tx",
    caption: "Included in a block, but it failed",
    script:
      "The precompile proves inclusion, not success — a reverted transaction is still in the block. This is the footgun most implementations miss. We check the receipt.",
    state: baseState({ outstandingSupply: u(1_000_000), epoch: 3 }),
    add: [
      entry("Rejected", "Reverted transaction rejected", "SourceTransactionReverted — receiptStatus was 0", {
        held: true,
      }),
    ],
  });

  // ── 6 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Counterfeit vault",
    caption: "A byte-identical event from an impostor",
    script:
      "Anyone can deploy a contract that emits our exact event claiming a billion in reserves. The inclusion proof would be genuine. The emitter binding is what stops it.",
    state: baseState({ outstandingSupply: u(1_000_000), epoch: 3 }),
    add: [
      entry("Rejected", "Counterfeit vault rejected", "NoMatchingEvent — emitter is not the canonical vault", {
        held: true,
      }),
    ],
  });

  // ── 7 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Staleness",
    caption: "The proof ages out of its window",
    script:
      "Nobody snapshots for a while. Creditcoin keeps attesting. Minting stops on its own — no governance, no intervention, nobody had to notice.",
    state: baseState({
      outstandingSupply: u(1_000_000),
      epoch: 3,
      latestAttestedHeight: SRC_HEIGHT_0 + 201,
      stalenessBlocks: 201,
      fresh: false,
    }),
    add: [
      entry("Rejected", "Mint halted", "ReserveStale — 201 blocks since proof, bound is 200", { held: true }),
      entry("Info", "Freshness read on-chain", "latest attested height from ChainInfo precompile 0x0FD3"),
    ],
  });

  // ── 8a: the announced exit — divergence becomes visible ─────────────────
  acts.push({
    name: "Exit announced",
    caption: "400,000 announced for withdrawal — funds have not moved",
    script:
      "The custodian announces a withdrawal. Nothing has left the vault. But a reserve promised to a departing party is not backing anything, and MintBound stops counting it the moment the announcement is proven.",
    state: baseState({
      outstandingSupply: u(1_000_000),
      encumberedReserve: u(400_000),
      epoch: 4,
      mintFrozen: true,
    }),
    divergence: {
      reportedAnswer: u(1_000_000),
      reportedAgeSeconds: 2_820,
      provenAnswer: u(600_000),
      provenAgeSeconds: 96,
    },
    add: [
      entry("Info", "Withdrawal announced on Sepolia", "400,000.00 · executable in ~30 min · provable now"),
      entry("ReserveProven", "Reserve proven", "balance 1,000,000.00 · encumbered 400,000.00 · epoch 4"),
      entry(
        "SolvencyBreach",
        "SOLVENCY BREACH",
        "backing falls to 600,000.00 against 1,000,000.00 supply · minting frozen BEFORE funds move",
      ),
      entry("Rejected", "Mint rejected", "MintFrozen — engaged 30 minutes before the money could leave", {
        held: true,
      }),
    ],
  });

  // ── 8 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "The drain",
    caption: "The custodian moves 400,000 out",
    script:
      "The custodian withdraws forty percent on Sepolia. Nothing on Creditcoin has changed yet — and that is the point. The shortfall only becomes visible when someone snapshots. Anyone can.",
    state: baseState({
      verifiedReserve: u(600_000),
      outstandingSupply: u(1_000_000),
      epoch: 4,
      attestedAtHeight: SRC_HEIGHT_0 + 210,
      latestAttestedHeight: SRC_HEIGHT_0 + 214,
      stalenessBlocks: 4,
      fresh: true,
      mintFrozen: true,
    }),
    add: [
      entry("Snapshot", "Permissionless snapshot", "called by 0xBb42…09Cd — not the team, not the custodian"),
      entry("ReserveProven", "Reserve proven", "balance 600,000.00 · epoch 4"),
      entry(
        "SolvencyBreach",
        "SOLVENCY BREACH",
        "supply 1,000,000.00 exceeds proven ceiling 600,000.00 · 60.00% · minting frozen",
      ),
      entry("Rejected", "Mint rejected", "MintFrozen — circuit breaker engaged", { held: true }),
    ],
  });

  // ── 9 ────────────────────────────────────────────────────────────────────
  acts.push({
    name: "Redemption",
    caption: "Frozen for minting, open for exit",
    script:
      "Increasing liabilities needs a fresh proof. Decreasing them needs nothing at all. Every failure mode lands on frozen mint with open redemption — never on silent over-issuance.",
    state: baseState({
      verifiedReserve: u(600_000),
      outstandingSupply: u(900_000),
      epoch: 4,
      attestedAtHeight: SRC_HEIGHT_0 + 210,
      latestAttestedHeight: SRC_HEIGHT_0 + 216,
      stalenessBlocks: 6,
      fresh: true,
      mintFrozen: true,
    }),
    add: [
      entry("RedeemRequested", "Redemption", "100,000.00 burned by 0x71C7…976F · no proof required"),
      entry("InvariantChecked", "Ratio improves", "supply 900,000.00 vs ceiling 600,000.00 · 66.67%"),
    ],
  });

  return acts;
}

/** Fold acts 0..index into a full snapshot. */
export function snapshotAt(acts: Act[], index: number): DashboardSnapshot {
  const i = Math.max(0, Math.min(index, acts.length - 1));
  const act = acts[i]!;

  const ledger: LedgerEntry[] = [];
  for (let k = 0; k <= i; k++) ledger.push(...acts[k]!.add);
  ledger.reverse();

  const health = healthOf(act.state);

  return {
    mode: "simulated",
    connected: true,
    health,
    divergence: act.divergence,
    state: act.state,
    ledger,
    trustPath: buildTrustPath(act.state, health),
    context: {
      creditcoinChainId: 102031,
      sourceChainKey: 1,
      ascAddress: "0x0000000000000000000000000000000000000000",
      vaultAddress: "0x0000000000000000000000000000000000000000",
    },
    act: { index: i, total: acts.length, name: act.name, caption: act.caption },
  };
}
