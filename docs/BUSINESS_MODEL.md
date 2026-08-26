# Business model, sustainability, and the honest version of both

*Written for CEIP diligence. Every uncomfortable number is stated rather than omitted.*

---

## Start with the uncomfortable fact

**Oracle monetisation has been hard, and pretending otherwise would be the fastest way to lose credibility.**

Chainlink secures over **$17B** in reserve assets across 40+ Proof of Reserve feeds and 56
projects. Its aggregate fee pool across *all* services has been estimated at **under $10M
annually**. That is the incumbent, at enormous scale, in the same category.

Anyone pitching "we'll charge per verification and it'll be huge" either hasn't looked at
that number or is hoping you haven't. So the model below is built around what reserve
verification is actually worth to the person paying, not around a volume fantasy.

---

## Who pays, and why they would

The insight is that **MintBound's buyer is not the consumer of the data — it is the
issuer of the liability.**

A price oracle is a cost centre: a protocol pays for data it needs to function. A
solvency proof is different. It is closer to a **credit rating or an audit**: the issuer
buys it because being *provably* backed is worth more than being *claimed* backed.

| Buyer | What they get | Why they pay |
|---|---|---|
| **Wrapped-asset issuer** | Provable, continuous backing; a mint function that cannot over-issue | Cheaper cost of capital. Provably-backed collateral gets accepted at lower haircuts by lenders and gets listed by venues that would otherwise refuse |
| **RWA fund / tokenizer** | Continuous on-chain attestation, net of encumbrances | Regulatory tailwind. The GENIUS Act (July 2025) requires permitted stablecoin issuers to publish **monthly** attestations of redeemable tokens outstanding and redemption assets available. MintBound produces that continuously and cryptographically |
| **Lending market / DEX** | `isSolvent(asset)` and `trustedParties(asset)` as a gate | Avoiding the loss. Collateral that de-pegs after the fact is the single largest source of bad debt |
| **The chain itself** | A reason institutional RWA issuers choose Creditcoin | Ecosystem value — see below |

### The specific pricing shape

A **basis-point fee on minted supply, paid by the issuer at mint time**, collected by the
ASC. Not per-call, not per-read.

Why this shape and not a per-call fee:

- It scales with the **liability being underwritten**, which is what the guarantee is
  actually worth — the same logic as insurance premiums or rating fees.
- Reads stay **free forever**, which is what makes `ISolvencyOracle` adoptable. A
  primitive that charges to be read never gets integrated.
- It is collected at the one moment the protocol is already in the transaction path, so
  it needs no new trust, no subscription infrastructure, and no billing relationship.

At 2 bps on minted supply, a $500M wrapped RWA book generates $100k/yr from a single
issuer. That is a real business at modest scale, and it does not require winning the
price-feed market.

**None of this is implemented.** There is no fee switch in the contracts today, on
purpose — a hackathon submission that ships a fee mechanism before it ships a proof is
solving the wrong problem first. It is a roadmap item, and it is deliberately trivial to
add later because the ASC already sits in the mint path.

---

## But for CEIP specifically, the honest answer is different

CEIP is an **ecosystem investment programme**, not a fund seeking standalone venture
returns. It exists to make Creditcoin more valuable. Judged that way, the return is not
MintBound's revenue line — it is what MintBound unlocks for the chain.

**1. It removes the credibility blocker on Creditcoin's own thesis.**
Creditcoin's positioning is on-chain credit and RWA. The single hardest objection an
institutional RWA issuer raises is *"how does anyone know the backing is really there?"*
On most chains the answer is "an oracle network reports it." On Creditcoin the answer
becomes "native code proves it, per transaction, net of encumbrances." That is a
differentiator no competing L1 can copy without building an attestation layer first.

**2. It extends the protocol for everyone, not just for us.**
State-to-event lifting turns the Block Prover from a *transaction* oracle into a *state*
oracle. Every Attestcoin dApp inherits that. It is a documentation-grade pattern the
Gluwa team could adopt directly, and it costs them nothing to do so — MIT licensed.

**3. It aligns with CEIP's stated priority: financial inclusion in emerging markets.**
This connection is real, not retrofitted. Proof-of-reserve infrastructure matters *most*
where the institutional substitutes are weakest. In a market with a mature audit
profession, a deep regulator, and enforceable recourse, a quarterly attestation is
tolerable. In markets where Creditcoin actually operates — where a local auditor's
signature is not a guarantee and cross-border recourse is theoretical — *cryptographic*
proof is not a luxury feature, it is the only form of assurance that travels. A lender in
Lagos gating on `isSolvent()` gets the same guarantee as one in London, without needing
the institutions London has.

That is the argument for why this belongs in a programme about accessibility, and not
only in one about institutional RWA.

---

## "Solo builder — will this survive?"

The honest answer has two halves: the risk is real, and the architecture was chosen so it
matters less than usual.

### The risk, stated plainly

One person built this. Bus factor is one. If that person stops, no one is shipping
features. Pretending otherwise would be silly.

### Why the damage is bounded by design

**The contracts are immutable and non-upgradeable.** There is no proxy, no upgrade path,
no admin key that must be responsibly held forever. `WrappedAsset.MINTER` is immutable
with no setter. Once `renounceEmergencyWithdrawal()` is called, the vault's escape hatch
is gone permanently.

The practical consequence: **if the author disappears tomorrow, the deployed system keeps
working exactly as it does today.** Nothing degrades, nothing needs a keeper, nothing
expires. That is not true of most infrastructure, and it is a deliberate trade — the
same immutability that prevents a rug also prevents an abandoned project from rotting.

**The off-chain component is untrusted and replaceable.** The worker can censor but
cannot forge. Anyone can run one; running several improves liveness and changes nothing
about safety. There is no privileged operator to replace.

**The code is small and documented to be handed over.** ~1,200 lines of Solidity,
52 unit tests, 7 stateful invariants at 256 runs each, 13 live integration checks, a
threat model mapping every attack to its test, and a research ledger recording which
upstream docs were wrong and why. That is deliberately more documentation than a solo
project needs — it is written for the person who inherits it.

**The licence is MIT.** If the ecosystem wants the pattern and not the person, it can
take the pattern.

### What funding would actually change

An honest answer to "what does $250k buy" is not "a bigger team immediately." It is:

1. **A security audit.** The CertiK credits from a top-three finish cover part of this;
   an independent second review is what makes it usable for real value.
2. **A second maintainer.** The single highest-value use of money here, precisely because
   bus factor is the stated risk.
3. **Mainnet deployment and the first issuer integration**, which is where the fee model
   stops being theoretical.
4. **Multi-chain source support** — Ethereum mainnet (`chainKey 3`) is already attested by
   CC3, so it is a configuration and testing exercise, not a redesign.

---

## The three-line version

- **Model:** basis points on minted supply, paid by the issuer, reads free forever. Not
  implemented yet, and deliberately so.
- **Honest caveat:** oracle monetisation is hard — the incumbent secures $17B and captures
  under $10M a year. This is priced as underwriting, not as data.
- **For CEIP:** the return is ecosystem, not revenue. It removes the credibility blocker
  on Creditcoin's RWA thesis, extends the protocol for every dApp on it, and delivers a
  form of assurance that works in exactly the markets where institutional assurance does
  not.
