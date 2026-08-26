import { assess } from "../assurance.js";
import { EXPLORER } from "../config.js";
import { readLive, toAssuranceInput } from "../read.js";
import { CROSS, TICK, bar, c, heading, kv, rule, units } from "../render.js";

/**
 * `mintbound status` — the whole solvency argument, read from live chains, in one screen.
 *
 * Every number printed here was fetched over RPC in the last few seconds. Nothing is
 * cached, nothing is synthesised, and no key or funded account is required to run it.
 */
export async function status(opts: { json?: boolean } = {}) {
  const s = await readLive();
  const a = assess(toAssuranceInput(s));

  if (opts.json) {
    console.log(
      JSON.stringify(
        { state: s, assurance: a },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
    return a.score === a.max ? 0 : 1;
  }

  const d = s.decimals;
  const ratio = s.outstandingSupply === 0n ? Infinity : s.collateralRatioBps / 100;

  heading("MintBound — live solvency");
  kv("network", `Creditcoin CC3 (102031) <- Ethereum Sepolia (chainKey ${s.sourceChainKey})`);
  kv("guard", s.asc);
  kv("reserve vault", s.vault);

  heading("Balance sheet");
  kv("proven reserve", `${units(s.verifiedReserve, d)} @ source height ${s.attestedAtHeight}`);
  kv("announced exits", `- ${units(s.encumberedReserve, d)} (encumbered, no longer counts)`);
  kv("haircut", `x ${(s.haircutBps / 100).toFixed(2)}%`);
  kv("effective backing", `= ${units(s.discountedReserve, d)}`);
  kv("outstanding supply", `${units(s.outstandingSupply, d)} ${s.symbol}`);
  kv("headroom to bound", `${units(s.maxMintable, d)}`);
  console.log("");

  const usage =
    s.discountedReserve === 0n
      ? 0
      : Number((s.outstandingSupply * 10000n) / s.discountedReserve) / 10000;
  console.log(`  ${bar(usage)}  ${(usage * 100).toFixed(1)}% of the bound used`);
  kv(
    "",
    c.grey(
      ratio === Infinity ? "no supply outstanding" : `collateral ratio ${ratio.toFixed(0)}%`,
    ),
  );

  heading("Freshness");
  kv("source tip", String(s.sourceHead));
  kv("Creditcoin attested", `${s.latestAttestedHeight}  ${c.grey(`(${Math.max(s.sourceHead - s.latestAttestedHeight, 0)} blocks behind tip)`)}`);
  kv("proof staleness", `${s.stalenessBlocks} / ${s.maxStalenessBlocks} blocks`);
  kv("verdict", s.fresh ? c.green(`${TICK} fresh`) : c.red(`${CROSS} stale — minting frozen`));

  heading("Mint gate");
  const gate = s.solvent && s.fresh && !s.mintFrozen;
  kv("solvent", s.solvent ? c.green(TICK) : c.red(CROSS));
  kv("fresh", s.fresh ? c.green(TICK) : c.red(CROSS));
  kv("circuit breaker", s.mintFrozen ? c.red("engaged") : c.green("clear"));
  kv("minting", gate ? c.green("PERMITTED") : c.red("FROZEN"));
  console.log(
    c.grey(
      "\n  Redemption is never gated on any of the above. Every failure mode here\n" +
        "  lands on the same side: minting stops, redeeming does not.",
    ),
  );

  heading(`Assurance  ${a.score}/${a.max}`);
  for (const o of a.obligations) {
    const mark = o.met ? c.green(TICK) : c.red(CROSS);
    console.log(`  ${mark} ${o.label.padEnd(22)}${c.grey(String(o.weight).padStart(3))}  ${o.detail}`);
  }
  console.log("");
  console.log(
    c.grey(
      "  Assurance is a presentation-layer aggregation over six independently\n" +
        "  checkable obligations, with published weights. No contract reads it and\n" +
        "  no mint is gated on it — enforcement on-chain is binary.",
    ),
  );

  rule();
  console.log(c.grey(`  ${EXPLORER.creditcoin}/address/${s.asc}`));
  console.log(c.grey(`  ${EXPLORER.sepolia}/address/${s.vault}`));
  console.log("");

  return gate ? 0 : 1;
}
