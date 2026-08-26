"use client";

import { formatUnits } from "@/lib/format";
import type { SolvencyState } from "@/lib/types";

export interface DivergenceData {
  /** Gross reserve as a report-on-a-heartbeat design would publish it. */
  reportedAnswer: bigint;
  /** Seconds since that report was published. */
  reportedAgeSeconds: number;
  /** Proven, encumbrance-adjusted reserve. */
  provenAnswer: bigint;
  /** Seconds since the proof landed. */
  provenAgeSeconds: number;
}

function age(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
}

/**
 * Same interface. Different truth.
 *
 * Both columns serve `AggregatorV3Interface` and describe the same reserve at the same
 * instant. The left is how a report-on-a-heartbeat design necessarily behaves: gross,
 * and as old as its last update. The right is a per-transaction proof, net of announced
 * withdrawals.
 *
 * The gap between them is not a claim about anyone's engineering — it is the structural
 * difference between reporting a number and proving one, made visible.
 */
export function Divergence({ data, state }: { data: DivergenceData; state: SolvencyState }) {
  const { decimals } = state;
  const diff =
    data.reportedAnswer > data.provenAnswer
      ? data.reportedAnswer - data.provenAnswer
      : 0n;
  const overstatedPct =
    data.provenAnswer > 0n && diff > 0n
      ? Number((diff * 10000n) / data.provenAnswer) / 100
      : 0;
  const diverged = diff > 0n;

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <header className="panel-head">
        <div>
          <div className="label">Same interface. Different truth.</div>
          <div style={{ fontSize: 13, marginTop: 5, color: "var(--ink-2)" }}>
            Both columns serve <span className="mono">AggregatorV3Interface</span> for the same
            reserve, right now
          </div>
        </div>
        {diverged && (
          <span className="pill" data-health="breached">
            <span className="dot" />
            OVERSTATED BY {overstatedPct.toFixed(2)}%
          </span>
        )}
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        {/* ── reported ── */}
        <div className="stat" data-signal={diverged ? "stale" : undefined} style={{ borderBottom: 0 }}>
          <div className="label">Reported — gross, on a heartbeat</div>
          <div className="stat-value">{formatUnits(data.reportedAnswer, decimals)}</div>
          <div className="stat-sub">
            published {age(data.reportedAgeSeconds)}
            <br />
            includes reserve already promised to a departing party
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 10 }}>
            trustedParties 1
          </div>
        </div>

        {/* ── proven ── */}
        <div className="stat" data-signal="proof" style={{ borderBottom: 0, borderRight: 0 }}>
          <div className="label">Proven — net of announced exits</div>
          <div className="stat-value">{formatUnits(data.provenAnswer, decimals)}</div>
          <div className="stat-sub">
            proven {age(data.provenAgeSeconds)}
            <br />
            per-transaction inclusion proof, encumbrances subtracted
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--proof)", marginTop: 10 }}>
            trustedParties {state.trustedParties}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "16px",
          borderTop: "1px solid var(--rule-strong)",
          background: "var(--bg-sunken)",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--ink-2)",
        }}
      >
        {diverged ? (
          <>
            <b style={{ color: "var(--breach)" }}>
              A consumer reading the left column would mint against{" "}
              {formatUnits(diff, decimals)} of backing that is not there.
            </b>{" "}
            Both numbers are honestly produced. The difference is that one is a report of a
            gross balance from some time ago, and the other is a proof of what currently
            backs supply.
          </>
        ) : (
          <>
            No divergence right now — nothing is encumbered and the report is current. The
            gap opens the moment a withdrawal is announced, or the heartbeat falls behind.
          </>
        )}
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 10 }}>
          The left column is a MODEL of report-on-a-heartbeat behaviour, not a live
          third-party feed, and is not a claim about any specific provider&apos;s quality.
        </div>
      </div>
    </section>
  );
}
