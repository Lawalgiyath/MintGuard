/** Formatting helpers. Every number on this dashboard is a measurement, so they are
 *  formatted like measurements: fixed precision, tabular, never abbreviated in a way
 *  that hides a shortfall. */

export function formatUnits(value: bigint, decimals: number, precision = 2): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;

  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, precision)
    .padEnd(precision, "0");

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${precision > 0 ? "." + fracStr : ""}`;
}

/** Compact form for headline figures: 1.24M, 940.2K. */
export function formatCompact(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const n = Number(value) / Number(base);
  if (!isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

const UINT32_MAX = 4294967295;

/** Coverage ratio. Infinite coverage (zero supply) is reported honestly, not as 0%. */
export function formatRatio(bps: number): string {
  if (bps >= UINT32_MAX) return "∞";
  return `${(bps / 100).toFixed(2)}%`;
}

export function isInfiniteRatio(bps: number): boolean {
  return bps >= UINT32_MAX;
}

export function shortHash(h?: string, lead = 6, tail = 4): string {
  if (!h) return "—";
  if (h.length <= lead + tail + 2) return h;
  return `${h.slice(0, lead)}…${h.slice(-tail)}`;
}

/**
 * Clock in UTC, deliberately.
 *
 * Local-time formatting is a hydration hazard: the server renders in the host's
 * timezone and the browser re-renders in the viewer's, React sees two different
 * strings and throws. UTC is identical everywhere, and an instrument reporting in UTC
 * is correct anyway — the ledger records chain events, which have no local time.
 */
export function formatClock(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

/** Source-chain blocks to human duration, at Sepolia's ~12s cadence. */
export function blocksToDuration(blocks: number): string {
  const secs = blocks * 12;
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}
