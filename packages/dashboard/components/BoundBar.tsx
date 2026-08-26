"use client";

import { formatRatio, formatUnits, isInfiniteRatio } from "@/lib/format";
import type { Health, SolvencyState } from "@/lib/types";

/**
 * THE BOUND.
 *
 * The invariant is `totalSupply <= verifiedReserve * haircut`. Rendered as a physical
 * constraint rather than an inequality: the track is the proven reserve, the fill is
 * outstanding supply, and the tick is the ceiling supply may touch but never cross.
 *
 * This is the one component allowed to be dramatic, because it is the one moment the
 * product is actually about.
 */
export function BoundBar({ state, health }: { state: SolvencyState; health: Health }) {
  const { verifiedReserve, outstandingSupply, discountedReserve, haircutBps, decimals } = state;

  // Scale to whichever is larger so a breach visibly overshoots the tick rather than
  // silently clipping at 100% — the overshoot IS the information.
  const scale = verifiedReserve > outstandingSupply ? verifiedReserve : outstandingSupply;
  const pct = (v: bigint) => (scale === 0n ? 0 : Number((v * 10000n) / scale) / 100);

  const fillPct = Math.min(100, pct(outstandingSupply));
  const tickPct = Math.min(100, pct(discountedReserve));

  const breached = health === "breached";
  const infinite = isInfiniteRatio(state.collateralRatioBps);

  return (
    <section className="bound" data-health={health} aria-label="The bound">
      <div className="bound-top">
        <div>
          <div className="label">The bound — proven coverage</div>
          <div className="bound-ratio" aria-live="polite">
            {infinite ? "∞" : formatRatio(state.collateralRatioBps)}
          </div>
          <div className="stat-sub" style={{ marginTop: 8 }}>
            {breached
              ? "Outstanding supply exceeds the proven ceiling. Minting is frozen."
              : state.outstandingSupply === 0n
                ? "No supply outstanding. Every token minted from here must clear the bound."
                : `Every ${state.symbol} outstanding is backed by proven reserve.`}
          </div>
        </div>

        {!breached && health === "proven" && (
          <div className="held" role="status">
            <span aria-hidden="true">◆</span> THE BOUND HOLDS
          </div>
        )}
        {breached && (
          <div className="held" style={{ color: "var(--breach)" }} role="status">
            <span aria-hidden="true">◆</span> BOUND BREACHED — MINT FROZEN
          </div>
        )}
      </div>

      <div
        className="track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fillPct)}
        aria-label={`Outstanding supply is ${fillPct.toFixed(1)} percent of the proven reserve`}
      >
        <div className="fill" style={{ width: `${fillPct}%` }} />
        {tickPct > 0 && (
          <div
            className="tick"
            style={{ left: `${tickPct}%` }}
            data-align={tickPct > 88 ? "end" : tickPct < 12 ? "start" : undefined}
            data-label={haircutBps === 10000 ? "CEILING" : `CEILING · ${haircutBps / 100}%`}
          />
        )}
      </div>

      <div className="track-legend">
        <div>
          <div className="label">Outstanding supply</div>
          <div className="num" style={{ fontSize: 15, marginTop: 6 }}>
            {formatUnits(outstandingSupply, decimals)}{" "}
            <span style={{ color: "var(--ink-3)", fontSize: 11 }}>{state.symbol}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="label">Proven reserve ceiling</div>
          <div className="num" style={{ fontSize: 15, marginTop: 6 }}>
            {formatUnits(discountedReserve, decimals)}
            {haircutBps !== 10000 && (
              <span style={{ color: "var(--ink-3)", fontSize: 11 }}>
                {" "}
                ({haircutBps / 100}% of {formatUnits(verifiedReserve, decimals, 0)})
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
