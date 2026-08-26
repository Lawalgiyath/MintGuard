/**
 * MintBound Assurance — how much trust the solvency evidence still requires.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is not a consensus value, it is not read by any contract, and no mint is ever
 * gated on it. Enforcement in MintBound is binary and lives on-chain: either the
 * aggregate bound holds against a fresh proof or the mint reverts. Nothing here can
 * loosen that.
 *
 * WHAT THIS IS
 * ------------
 * A presentation-layer aggregation over six independent proof obligations, so that a
 * human can see at a glance which parts of the solvency argument are currently carried
 * by cryptography and which are carried by an assumption. The weights below are
 * published rather than tuned: they are part of the specification, and changing them
 * changes a documented number, not a security property.
 *
 * The reason a score is defensible at all here is that each obligation is independently
 * checkable from chain state — no obligation is scored on opinion. If you disagree with
 * a weight, the vector is printed alongside the total so you can reweight it yourself.
 */

export interface Obligation {
  id: string;
  label: string;
  weight: number;
  met: boolean;
  /** Where the answer came from. "chain" means it was read, not asserted. */
  evidence: string;
  detail: string;
}

export interface AssuranceInput {
  /** 0 when the reserve figure is precompile-proven; 1 when it is oracle-reported. */
  trustedParties: number;
  fresh: boolean;
  stalenessBlocks: number;
  maxStalenessBlocks: number;
  /** Vault withdrawal delay in source-chain blocks. */
  withdrawalDelayBlocks: number;
  /** Observed attestation latency in source-chain blocks. */
  detectionLatencyBlocks: number;
  /** Registered remote chains, and how many of those reported a fresh supply proof. */
  registeredChains: number;
  reportingChains: number;
  /** Continuity coverage: the source height proven free of reserve outflow. */
  coveredThrough: number;
  anchorHeight: number;
  /** True once the vault's emergency withdrawal path has been irreversibly renounced. */
  emergencyRenounced: boolean;
}

/** Published weights. These sum to 100 and are part of the spec. */
export const WEIGHTS = {
  reserveEvidence: 25,
  freshness: 20,
  liabilityCoverage: 20,
  encumbrance: 15,
  continuity: 10,
  mintAuthority: 10,
} as const;

export function assess(i: AssuranceInput): {
  obligations: Obligation[];
  score: number;
  max: number;
} {
  const marginOk =
    i.detectionLatencyBlocks > 0 &&
    i.withdrawalDelayBlocks >= 2 * i.detectionLatencyBlocks;

  const chainsOk = i.registeredChains === 0 || i.reportingChains >= i.registeredChains;

  const continuityOk = i.coveredThrough > 0 && i.coveredThrough >= i.anchorHeight;

  const obligations: Obligation[] = [
    {
      id: "reserve",
      label: "Reserve evidence",
      weight: WEIGHTS.reserveEvidence,
      met: i.trustedParties === 0,
      evidence: "chain: MintBoundASC.solvencyReport().trustedParties",
      detail:
        i.trustedParties === 0
          ? "cryptographic — verified by the Block Prover precompile, no reporter in the mint path"
          : `oracle-reported — ${i.trustedParties} off-chain part${i.trustedParties === 1 ? "y" : "ies"} must be honest`,
    },
    {
      id: "freshness",
      label: "Proof freshness",
      weight: WEIGHTS.freshness,
      met: i.fresh,
      evidence: "chain: ChainInfo precompile 0x0FD3, read on-chain",
      detail: `${i.stalenessBlocks} of ${i.maxStalenessBlocks} blocks stale`,
    },
    {
      id: "liabilities",
      label: "Liability coverage",
      weight: WEIGHTS.liabilityCoverage,
      met: chainsOk,
      evidence: "chain: SupplyBeacon proofs aggregated by MintBoundASC.totalLiabilities()",
      detail:
        i.registeredChains === 0
          ? "single-chain deployment — local totalSupply is the whole liability"
          : `${i.reportingChains} of ${i.registeredChains} registered chains reporting`,
    },
    {
      id: "encumbrance",
      label: "Encumbrance margin",
      weight: WEIGHTS.encumbrance,
      met: marginOk,
      evidence: "chain: ReserveVault.WITHDRAWAL_DELAY vs observed attestation lag",
      detail: marginOk
        ? `${i.withdrawalDelayBlocks} block delay vs ${i.detectionLatencyBlocks} block detection ` +
          `(${(i.withdrawalDelayBlocks / Math.max(i.detectionLatencyBlocks, 1)).toFixed(1)}x margin)`
        : `${i.withdrawalDelayBlocks} block delay does not cover 2x the ${i.detectionLatencyBlocks} block detection latency`,
    },
    {
      id: "continuity",
      label: "Interval continuity",
      weight: WEIGHTS.continuity,
      met: continuityOk,
      evidence: "chain: SolvencyContinuity.coveredThrough()",
      detail: continuityOk
        ? `no-outflow bonded through source height ${i.coveredThrough}`
        : "no bonded continuity claim covers the current interval",
    },
    {
      id: "authority",
      label: "Mint authority",
      weight: WEIGHTS.mintAuthority,
      met: i.emergencyRenounced,
      evidence: "chain: ReserveVault.emergencyEnabled()",
      detail: i.emergencyRenounced
        ? "emergency withdrawal irreversibly renounced — the operator cannot move the reserve"
        : "emergency withdrawal still enabled — the operator retains a unilateral exit",
    },
  ];

  const score = obligations.reduce((n, o) => n + (o.met ? o.weight : 0), 0);
  const max = obligations.reduce((n, o) => n + o.weight, 0);
  return { obligations, score, max };
}
