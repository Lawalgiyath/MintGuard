const ESC = String.fromCharCode(27);
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) =>
  useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s;

export const c = {
  dim: wrap("2"),
  bold: wrap("1"),
  green: wrap("32"),
  red: wrap("31"),
  yellow: wrap("33"),
  cyan: wrap("36"),
  grey: wrap("90"),
};

export const TICK = "✓";
export const CROSS = "✗";

export function rule(width = 68) {
  console.log(c.grey("─".repeat(width)));
}

export function heading(title: string) {
  console.log("");
  console.log(c.bold(title));
  rule();
}

export function step(n: number, total: number, text: string) {
  process.stdout.write(c.grey(`[${n}/${total}] `) + text);
}

export function stepOk(text: string) {
  console.log(" " + c.green(TICK) + " " + c.dim(text));
}

export function stepFail(text: string) {
  console.log(" " + c.red(CROSS) + " " + c.dim(text));
}

export function kv(key: string, value: string, pad = 22) {
  console.log(`  ${c.grey(key.padEnd(pad))}${value}`);
}

/** Format a base-10 fixed-point integer without pulling in a bignum formatter. */
export function units(v: bigint, decimals = 18, dp = 2): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, dp).replace(/0+$/, "");
  const group = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${group}${fracStr ? "." + fracStr : ""}`;
}

export function bar(fraction: number, width = 28): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(clamped * width);
  const body = "█".repeat(filled) + c.grey("░".repeat(width - filled));
  return clamped >= 1 ? c.green(body) : clamped >= 0.5 ? c.cyan(body) : c.yellow(body);
}
