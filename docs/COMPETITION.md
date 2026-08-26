# The field — BUIDL CTC 2026 Fall

Surveyed by scanning DoraHacks BUIDL pages (IDs 47700–48600) and filtering for
Creditcoin/Attestcoin submissions. **Last refreshed 2026-08-26.**

Descriptions are the authors' own one-liners, taken verbatim from each project's page
metadata.

## Hackathon facts

| | |
|---|---|
| **Submission deadline** | **13 September 2026, 23:59 ET — EXTENDED** (the concept note's 6 September is wrong) |
| Winner announcement | 20 September 2026 |
| Prize pool | $15,000 — Grand **$10,000**, 2nd $3,000, 3rd $2,000 |
| Extras | CertiK: 8K audit credits + 3 months Skynet Boost. Top 3 fast-tracked to **CEIP** ($10M, $25k–$250k tickets) |
| Tracks | DeFi · RWA · AI · Gaming · DePIN |
| Registered | ~138 participants |
| Hard requirement | Working Attestcoin integration + technical docs. **"Depth of Attestcoin Protocol utilization will be evaluated as one of the core scoring criteria."** |

## The submissions found

> **15 as of 2026-08-26** — AttestGuard (48023), Sovereign Attest Agent (48082) and
> Credit Reputation Agent (48097) arrived after the first survey. Per-project
> two-way comparison lives in [`HEAD_TO_HEAD.md`](HEAD_TO_HEAD.md).

| # | Project | The author's own pitch | Cluster |
|---|---|---|---|
| 47813 | **ProofYield** | Proves Sepolia coupon cashflows on Creditcoin before an ERC-4626 vault can raise share price | RWA yield |
| 47990 | **Oracle-Free Council** | AI agents harden decisions, write each locked decision back as an attestation a Governor verifies before executing | AI agents |
| 48000 | **VeriSettle** | Releases Creditcoin escrow only after an Attestcoin-verified Ethereum delivery-acceptance receipt | Escrow |
| 48015 | **Emberline** | Keeps delivery evidence private; releases milestone funding after attestations satisfy quorum | Escrow |
| 48016 | **BORROWIQ** | AI-driven credit scoring; analyses on-chain activity to price loan risk | Credit |
| 48033 | **BountyOps** | Blocks agent jobs until required cross-chain facts are cryptographically verified | AI agents |
| 48049 | **AttestDesk** | Advances trade credit only after BlockProver verify-then-execute proves an invoice was paid | Credit |
| 48059 | **Spark** | "2.5 billion people cannot access credit." Turns a payment on one chain into credit on another | Credit |
| 48073 | **LedgerLine** | On-chain credit bureau; verifies repayments trustlessly to replace manual sheets with scores | Credit |
| 48080 | **Cr3dX** | Money on Ethereum, credit state on Creditcoin, Attestcoin the only path between | Credit |
| 48099 | **SpaceFinance** | Lock ETH on Sepolia, receive loans on Creditcoin, verified trustlessly | Collateral lending |
| 48101 | **CreditPass** | Verifies Sepolia loan repayments to build a cross-chain credit score | Credit |

*Caveat on method:* DoraHacks renders BUIDL bodies client-side, so this reads page
metadata only. It reliably shows **what exists and how authors frame it**. It is not a
code audit, and it cannot tell us how complete any rival is.

## The two things this table shows

### 1. Half the field is the same project

**Six of twelve are credit-history or credit-scoring plays** — Spark, LedgerLine, Cr3dX,
CreditPass, BORROWIQ and AttestDesk. All six do essentially the same thing: prove a
repayment or payment event on Sepolia, and turn it into credit state on Creditcoin.

That is not a criticism of any of them. It is the natural reading of what Creditcoin is
for, so six teams independently built it. But a judge reviewing submissions in order will
have seen that idea five times before reaching the sixth, and differentiation inside that
cluster comes down to execution polish rather than concept.

### 2. Every single submission gates on an *event*

| What is verified | Projects |
|---|---|
| A repayment happened | Spark, LedgerLine, Cr3dX, CreditPass, AttestDesk |
| A delivery was accepted | VeriSettle, Emberline |
| A coupon was paid | ProofYield |
| A decision was locked | Oracle-Free Council, BountyOps |
| A deposit was locked | SpaceFinance |
| **A balance is _currently_ this** | **MintBound — alone** |

This is the `SimpleMinterASC` tutorial shape — *verify one event, then do one thing* —
applied across eleven verticals. It is the obvious use of the protocol.

**MintBound is the only submission attesting state rather than an event.** An event
cannot tell you something is *still* there: proving an invoice was paid says nothing
about whether the money left afterwards. Only a count catches theft.

## Head-to-head

| Property | The other 11 | MintBound |
|---|---|---|
| Verifies a source-chain event | yes, all | yes |
| Verifies a source-chain **balance** | none | yes — state-to-event lifting |
| **Aggregate** invariant across all outstanding liabilities | none (all per-position / per-event) | yes |
| Detects a **withdrawal** after the fact | structurally cannot | yes |
| **Encumbrance** — reserves already promised away | none | yes, enforced on-chain |
| Freshness read **on-chain** (ChainInfo `0x0FD3`) | none observed; all cite BlockProver only | yes — second precompile |
| Standards-compatible interface | none | yes — `AggregatorV3Interface` |
| Reusable primitive vs. vertical app | 11 apps | infrastructure + 3 example consumers |
| Stateful invariant testing | unknown | 7 invariants × 256 runs |
| Adversarial suite attacking its own system | none mentioned | 6 live attacks |

## Closest competitors, ranked by actual threat

**1. SpaceFinance (48099) — closest in mechanism.** "Lock ETH on Sepolia, receive loans
on Creditcoin" is genuinely collateral-backed issuance, which is MintBound's shape. The
distinction is real but must be said clearly: it verifies the *lock event* per position
(flow), not the *vault balance* in aggregate (stock). It cannot see the collateral leave.

**2. ProofYield (47813) — closest in framing.** Same "no trusted bridges or oracles" RWA
pitch. Verifies coupon *cashflows* — events — before letting a vault raise share price.
Flow, not stock, and no aggregate solvency check.

**3. Spark (48059) — closest to CEIP's heart, and the real risk.** CEIP explicitly
prioritises financial inclusion and emerging markets. Spark opens with "2.5 billion
people cannot access credit." That narrative is more natively on-thesis for Creditcoin
than institutional RWA is. MintBound has a genuine inclusion argument — cryptographic
proof matters most where local audit and legal recourse are weakest — but it is a
second-order argument and Spark's is first-order. **This is where the grand prize could
go on narrative alone.**

## Honest risks

- **Nothing is deployed.** Twelve competitors have submitted; MintBound has not. This
  dominates every other consideration.
- **Spark's inclusion story may out-narrate a technical win.** Prepare the inclusion
  framing explicitly rather than leaning only on rigour.
- **"Isn't this just OFT / CCIP CCT?"** — the newest way to lose, and a fair question.
  Cross-chain supply conservation IS solved by those standards. Acknowledge it first,
  then draw the real line: they conserve supply by construction and report on their own
  supply; MintBound measures each chain's real `totalSupply()` by proof and enforces the
  reserve bound against that measurement. Detective, not preventive. Independent, not
  self-reported.
- **"Isn't this Chainlink PoR?"** remains the fastest way to lose. Never claim the
  aggregate check as the Chainlink differentiator — Secure Mint already does it. The
  three real ones are trust model, encumbrance, and on-chain freshness.
- **Standing out cuts both ways.** If judges arrive wanting credit infrastructure, being
  the only reserve-verification entry is a risk as well as an advantage. Mitigation: lead
  with what MintBound gives *the other eleven* — `ISolvencyOracle` is something a lending
  market or a yield vault in this very field could consume today.
