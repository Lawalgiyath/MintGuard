import type { Interface } from "ethers";

/**
 * Turn a reverted call into a sentence a human can read.
 *
 * ethers' `shortMessage` gives up on custom errors and says "unknown custom error" even
 * when the ABI is right there and the payload decodes perfectly. That matters here: a
 * revert IS the product, so reporting it as unknown makes a correct rejection look like
 * a malfunction. Decode from the raw data first, and only fall back to string scraping.
 */
export function describeRevert(iface: Interface, e: any): string {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;

  if (typeof data === "string" && data.length >= 10 && data !== "0x") {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        // Solidity's require-string revert decodes as Error(string). Unwrap it —
        // "Error(Merkle proof validation failed)" reads worse than the message itself.
        if (parsed.name === "Error") return String(parsed.args[0]);
        if (parsed.name === "Panic") return `Panic(0x${BigInt(parsed.args[0]).toString(16)})`;
        const args = parsed.args.map((a: unknown) => String(a)).join(", ");
        return args ? `${parsed.name}(${args})` : `${parsed.name}()`;
      }
    } catch {
      // Not one of ours — fall through to the string forms below.
    }
  }

  const msg = String(e?.shortMessage ?? e?.reason ?? e?.message ?? e);
  const quoted = msg.match(/reverted with[^:]*: ?"?([^"]+)"?/);
  if (quoted?.[1]) return quoted[1].trim();

  const named = msg.match(/[A-Z][A-Za-z]+\([^)]*\)/);
  if (named?.[0]) return named[0];

  return msg.slice(0, 110);
}
