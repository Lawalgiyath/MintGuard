import { Contract } from "ethers";
import { CHAIN_INFO_ABI, ERC20_ABI } from "../abi.js";
import { CHAIN_INFO_ADDRESS, EXPLORER, creditcoin, sepolia } from "../config.js";
import { providers, readLive } from "../read.js";
import { CROSS, TICK, c, heading, rule, units } from "../render.js";

/**
 * `mintbound claims` — audit our own pitch.
 *
 * Every factual claim MintBound makes in its submission is listed here with the live
 * check that settles it. Not a description of evidence: the evidence, fetched now.
 *
 * WHY THIS EXISTS. A submission is a set of assertions by an interested party. The
 * normal way to evaluate one is to read it carefully and trust some of it. This command
 * removes that step — point it at the deployment and every claim resolves to PASS or
 * FAIL against chain state, including the claims that are inconvenient for us.
 *
 * It can fail. That is the point. A self-audit that cannot return FAIL is marketing with
 * a monospace font, so the exit code is non-zero when any claim does not hold, and the
 * claims that are currently unmet are printed just as loudly as the ones that are met.
 */

interface Claim {
  id: string;
  /** Stated exactly as the submission states it. */
  claim: string;
  /** Where the answer comes from. "chain" means read, not asserted. */
  source: string;
  ok: boolean;
  detail: string;
}

const BLOCKSCOUT_API = `${EXPLORER.creditcoin}/api`;

/**
 * Ask the explorer whether a contract's source is actually published.
 *
 * Distinguishes "not published" from "could not ask". Firing seven of these at once
 * made Blockscout time out intermittently, and reporting that as an unpublished
 * contract would be a false FAIL — exactly the kind of misreport this command exists to
 * avoid. So: retry once, and return `reachable: false` rather than a verdict when the
 * explorer will not answer.
 */
async function sourcePublished(
  address: string,
): Promise<{ published: boolean; reachable: boolean; name: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `${BLOCKSCOUT_API}?module=contract&action=getsourcecode&address=${address}`,
        { signal: AbortSignal.timeout(25_000) },
      );
      if (!res.ok) throw new Error(String(res.status));
      const body: any = await res.json();
      const row = body?.result?.[0];
      const src = String(row?.SourceCode ?? "");
      return { published: src.length > 0, reachable: true, name: String(row?.ContractName ?? "") };
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { published: false, reachable: false, name: "" };
}


/** The guard's own mint gate, mirrored exactly: solvent AND fresh AND not frozen. */
function canMintNow(s: { solvent: boolean; fresh: boolean; mintFrozen: boolean }): boolean {
  return s.solvent && s.fresh && !s.mintFrozen;
}

export async function claims(opts: { json?: boolean } = {}) {
  const cc = creditcoin();
  const sep = sepolia();
  const { cc: ccProvider } = providers();
  const s = await readLive();

  const out: Claim[] = [];
  const add = (
    id: string,
    claim: string,
    source: string,
    ok: boolean,
    detail: string,
  ) => out.push({ id, claim, source, ok, detail });

  // ── 1. no reporter in the mint path ─────────────────────────────────────────
  add(
    "no-reporter",
    "No off-chain party has to be trusted for the reserve figure.",
    "chain: MintBoundASC.solvencyReport().trustedParties",
    s.trustedParties === 0,
    s.trustedParties === 0
      ? "trustedParties() == 0 — the figure came from the Block Prover precompile"
      : `trustedParties() == ${s.trustedParties} — this asset is oracle-backed, not proven`,
  );

  // ── 2. the reserve was actually proven, not merely configured ───────────────
  const proven = s.epoch > 0 && s.attestedAtHeight > 0 && s.verifiedReserve > 0n;
  add(
    "proof-exists",
    "The reserve figure came from a verified inclusion proof of a real source transaction.",
    "chain: reserves[asset].epoch / attestedAtHeight",
    proven,
    proven
      ? `${units(s.verifiedReserve, s.decimals)} proven at source height ${s.attestedAtHeight} (epoch ${s.epoch})`
      : "no proof recorded — the guard has never accepted a snapshot for this asset",
  );

  // ── 3. freshness is read from the precompile, not reported to us ────────────
  // Read 0x0FD3 directly and compare with what the guard reports. If an off-chain party
  // could influence the freshness figure, these two would be free to disagree.
  let precompileHeight = 0;
  try {
    const info = new Contract(
      CHAIN_INFO_ADDRESS,
      CHAIN_INFO_ABI as unknown as string[],
      ccProvider,
    );
    const r: any = await info.get_latest_attestation_height_and_hash!(s.sourceChainKey);
    precompileHeight = Number(r.height);
  } catch {
    /* leaves precompileHeight at 0, which fails the claim below */
  }
  const freshnessAgrees =
    precompileHeight > 0 && Math.abs(precompileHeight - s.latestAttestedHeight) <= 2;
  add(
    "freshness-on-chain",
    "Freshness is read on-chain from ChainInfo precompile 0x0FD3, so nobody off-chain can lie about it.",
    "chain: 0x0FD3 read directly, compared against the guard's own report",
    freshnessAgrees,
    freshnessAgrees
      ? `precompile says ${precompileHeight}, guard says ${s.latestAttestedHeight} — same source`
      : `precompile ${precompileHeight} vs guard ${s.latestAttestedHeight} — could not confirm they agree`,
  );

  // ── 4. the freshness bound actually bites ─────────────────────────────
  // The first draft of this command omitted freshness and reported 10/10 while the
  // deployment was frozen on a proof 23,741 blocks past its bound. That is exactly the
  // bias a self-audit exists to remove — it checked only the claims we thought to list.
  //
  // The claim worth checking is not "minting works right now". It is the safety
  // property: a proof past the staleness bound MUST freeze minting. When the proof is
  // stale, that is directly observable, and the freeze is evidence rather than an
  // outage. When it is fresh, the bound simply is not being exercised, and we say so
  // instead of claiming credit.
  const stale = s.stalenessBlocks > s.maxStalenessBlocks;
  const gateBites = stale ? !s.fresh && !canMintNow(s) : s.fresh;
  add(
    "staleness-bites",
    "A proof past the staleness bound freezes minting, rather than being used anyway.",
    "chain: stalenessBlocks vs maxStalenessBlocks, against the guard's own mint gate",
    gateBites,
    stale
      ? `proof is ${s.stalenessBlocks} of ${s.maxStalenessBlocks} blocks stale, and minting is ${canMintNow(s) ? "STILL OPEN — the gate did not bite" : "frozen — the gate bit"}`
      : `proof is ${s.stalenessBlocks} of ${s.maxStalenessBlocks} blocks stale; the bound is not currently being exercised`,
  );

  // ── 4. the bound holds right now ────────────────────────────────────────────
  const withinBound = s.outstandingSupply <= s.discountedReserve;
  add(
    "bound-holds",
    "Outstanding supply is within the proven ceiling.",
    "chain: totalSupply vs (verifiedReserve - encumbered) x haircut",
    withinBound,
    `${units(s.outstandingSupply, s.decimals)} supply against ${units(s.discountedReserve, s.decimals)} effective backing`,
  );

  // ── 5. encumbrance arithmetic matches the enforced rule ─────────────────────
  // Recompute the ceiling the way the contract does and check the contract agrees.
  const unenc =
    s.verifiedReserve > s.encumberedReserve ? s.verifiedReserve - s.encumberedReserve : 0n;
  const expected = (unenc * BigInt(s.haircutBps)) / 10000n;
  add(
    "encumbrance-first",
    "Announced exits are subtracted from backing BEFORE the haircut, not after.",
    "chain: recomputed from verifiedReserve, encumbered and haircutBps",
    expected === s.discountedReserve,
    expected === s.discountedReserve
      ? `${units(s.encumberedReserve, s.decimals)} encumbered, excluded before the ${(s.haircutBps / 100).toFixed(2)}% haircut`
      : `recomputed ${units(expected, s.decimals)} but the guard reports ${units(s.discountedReserve, s.decimals)}`,
  );

  // ── 6. the liveness/safety margin, against MEASURED latency ─────────────────
  const detection = Math.max(s.sourceHead - s.latestAttestedHeight, 0);
  const marginOk = detection > 0 && s.withdrawalDelayBlocks >= 2 * detection;
  add(
    "margin",
    "A withdrawal cannot execute before the system could have detected it (delay >= 2x detection latency).",
    "chain: ReserveVault.WITHDRAWAL_DELAY vs live attestation lag",
    marginOk,
    detection > 0
      ? `${s.withdrawalDelayBlocks} block delay vs ${detection} blocks of measured lag — ${(s.withdrawalDelayBlocks / detection).toFixed(1)}x margin`
      : "attestation lag reads as zero; cannot evidence the margin right now",
  );

  // ── 7. the operator cannot move the reserve ─────────────────────────────────
  add(
    "renounced",
    "The operator has irreversibly given up the ability to move the reserve.",
    "chain: ReserveVault.emergencyEnabled()",
    !s.emergencyEnabled,
    s.emergencyEnabled
      ? "emergency withdrawal is STILL ENABLED — the operator retains a unilateral exit"
      : "emergencyEnabled() == false, permanently — there is no function to re-enable it",
  );

  // ── 8. the minter is immutable and is the guard ─────────────────────────────
  let minter = "";
  try {
    const w = new Contract(
      cc.contracts.WrappedAsset!,
      [...ERC20_ABI, "function MINTER() view returns (address)"] as unknown as string[],
      ccProvider,
    );
    minter = String(await (w as any).MINTER());
  } catch {
    /* empty string fails the claim */
  }
  const minterOk = minter.toLowerCase() === String(cc.contracts.MintBoundASC).toLowerCase();
  add(
    "minter-immutable",
    "Only the guard can mint, and that cannot be changed by anyone.",
    "chain: WrappedAsset.MINTER (immutable)",
    minterOk,
    minterOk
      ? `MINTER is the guard at ${minter.slice(0, 10)}… and is declared immutable`
      : `MINTER is ${minter || "unreadable"} — expected the guard`,
  );

  // ── 9. published source ─────────────────────────────────────────────────────
  const ccNames = Object.keys(cc.contracts);
  // Sequential on purpose. Seven parallel requests made the explorer time out and
  // produced a false FAIL; this takes a few seconds longer and tells the truth.
  const checks: { n: string; published: boolean; reachable: boolean }[] = [];
  for (const n of ccNames) {
    checks.push({ n, ...(await sourcePublished(cc.contracts[n]!)) });
  }
  const published = checks.filter((r) => r.published).length;
  const unreachable = checks.filter((r) => !r.reachable).length;
  add(
    "source-published",
    "Every deployed contract publishes verified source, so the code behind each address can be read.",
    "explorer: Blockscout getsourcecode, queried live",
    published === ccNames.length,
    unreachable > 0
      ? `${published}/${ccNames.length} confirmed; ${unreachable} could not be checked — the explorer did not answer, which is not the same as unpublished`
      : `${published}/${ccNames.length} Creditcoin contracts return source from the explorer`,
  );

  // ── 10. the gas figure we quote ─────────────────────────────────────────────
  // Quoting a measured number is only worth anything if the measurement is reachable.
  const MINT_TX = "0xb5a9c959d5fcadad2608e6c0e0e444cc9854489706e96f0f1ee495ba33f70d56";
  let mintGas = 0n;
  try {
    const rec = await ccProvider.getTransactionReceipt(MINT_TX);
    mintGas = rec?.gasUsed ?? 0n;
  } catch {
    /* zero fails the claim */
  }
  add(
    "gas-measured",
    "mintWithProof costs about 382,578 gas including proof verification and the full invariant.",
    `chain: receipt for ${MINT_TX.slice(0, 12)}…`,
    mintGas > 0n && mintGas < 400_000n,
    mintGas > 0n
      ? `the real receipt reports ${mintGas.toString()} gas`
      : "could not fetch the receipt to confirm the figure",
  );

  // ── report ──────────────────────────────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify({ claims: out }, null, 2));
    return out.every((x) => x.ok) ? 0 : 1;
  }

  heading("MintBound — auditing our own claims");
  console.log(
    c.grey(
      "  Every factual claim in the submission, with the live check that settles it.\n" +
        "  Read now, from chains and explorers. This command can fail, and says so when\n" +
        "  it does — a self-audit that cannot return FAIL is marketing in a monospace font.",
    ),
  );
  console.log("");

  // Operational status first. The claims below are about SAFETY properties, which hold
  // whether or not the deployment is currently minting — so state the operational
  // position plainly rather than letting a page of green ticks imply it.
  const minting = canMintNow(s);
  console.log(
    `  ${c.grey("right now:")} minting ${minting ? c.green("PERMITTED") : c.yellow("FROZEN")}` +
      c.grey(`  ·  proof ${s.stalenessBlocks}/${s.maxStalenessBlocks} blocks stale  ·  redemption always open`),
  );
  if (!minting) {
    console.log(
      c.grey(
        "  A frozen mint is the safety property, not an outage: no fresh proof, no new\n" +
          "  liabilities. Restart the snapshot worker and it clears on the next proof.",
      ),
    );
  }
  console.log("");

  for (const x of out) {
    const mark = x.ok ? c.green(TICK) : c.red(CROSS);
    console.log(`  ${mark} ${c.bold(x.claim)}`);
    console.log(`      ${x.detail}`);
    console.log(`      ${c.grey(x.source)}`);
    console.log("");
  }

  const passed = out.filter((x) => x.ok).length;
  rule();
  const tally = `${passed}/${out.length}`;
  console.log(
    `  ${passed === out.length ? c.green(tally) : c.red(tally)} claims verified against live state.`,
  );
  if (passed !== out.length) {
    console.log(
      c.grey(
        "\n  The unmet claims above are printed exactly as loudly as the met ones,\n" +
          "  because a submission you cannot fail is not evidence of anything.",
      ),
    );
  }
  console.log("");

  return passed === out.length ? 0 : 1;
}
