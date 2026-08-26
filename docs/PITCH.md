# The pitch — one page, one idea

*Everything else in this repository is depth to be discovered. This is what gets said.*

---

## The one sentence

> **Every reserve system in the world asks someone to *report* whether the money is
> there. MintBound *proves* it — and proves it is still there a minute later.**

Nothing else needs to be in the first breath.

---

## The 30 seconds

> More than one in five unbanked adults stay outside the financial system because they do
> not trust financial institutions. That is not a technology problem — it is a *proof*
> problem, and it is worst exactly where auditors and courts are weakest.
>
> Every proof-of-reserve system in production today ends in someone's word: an oracle
> network's report, a custodian's attestation, a monthly PDF. MintBound removes the word.
> A native Creditcoin precompile verifies, per transaction, that the backing is there —
> and a bonded challenge market proves it stayed there between checks.
>
> Reserves cannot leave without thirty minutes of public, provable warning. If backing
> ever falls short, minting freezes automatically and redemption stays open. Always in
> that order.

**Why this ordering.** Inclusion first, because it is the mandate of the programme this
is being judged for. Proof second, because that is the mechanism. Fail-safe third,
because it is what people remember.

---

## The demo, in one move

Open `/verify`. Ask someone in the room for **any** Ethereum Sepolia transaction hash —
one they choose, from Etherscan, that we have never seen.

Paste it. Creditcoin's native precompile proves it. Then the same proof, one byte
altered, is refused.

> *"Nothing of ours is deployed in that flow. No wallet, no gas, no oracle. That is the
> entire trust argument, run by a stranger, on data we do not control."*

If deployment is live, follow with the dashboard: the bound holding, then a custodian
announcing an exit and the reserve **de-rating before the money can move**.

---

## The four questions, and the four answers

**"Isn't this Chainlink Proof of Reserve?"**
> Chainlink secures $17B and does the same aggregate check we do — say that first. The
> difference is three things: their number is a decentralized oracle network's report,
> ours is a per-transaction proof; they do not subtract reserves already promised to a
> departing party, we do; and our freshness is read on-chain rather than reported. We
> also ship their interface, so any Secure Mint integration can point at us unchanged.

**"Isn't this OFT / CCIP's cross-chain token standard?"**
> Those conserve supply by construction and report on their own supply — the bridge
> auditing itself. We measure each chain's real `totalSupply()` independently, by proof.
> Detective, not preventive. It matters exactly when the construction fails.

**"Why is nothing private?"**
> Because there is nothing to hide that is not already public. Our reserves are ERC-20
> balances on a public chain — anyone can read them right now. The vault address must be
> public or the proof means nothing. Where privacy *would* matter is off-chain reserves,
> and that needs range proofs, which we scoped and did not build. It is roadmap, and we
> say so.

**"Who is this for?"**
> Anyone already integrated with Proof of Reserve — 40+ feeds, 56 projects — because we
> serve the same interface. And, concretely, most of the other submissions in this
> hackathon: a lending market, a yield vault or a credit desk all need collateral they can
> trust. Two lines each.

---

## Integration, for the rest of this hackathon

MintBound is the layer under the field, not a competitor to it. Every one of these is two
lines:

```solidity
ISolvencyOracle o = ISolvencyOracle(MINTBOUND);
require(o.isSolvent(asset), "collateral not proven solvent");
```

| Submission | What it gains |
|---|---|
| **SpaceFinance** — lends against locked ETH | Sees the collateral *leave*, not just arrive |
| **ProofYield** — ERC-4626 RWA vault | Refuses to raise share price when backing is unproven |
| **AttestDesk / LedgerLine** — credit desks | Collateral graded `trustedParties = 0` before advancing |
| **Spark / CreditPass** — credit for the unbanked | A score is worthless if the collateral behind the loan is not there |

And for anyone already on Chainlink PoR, it is not even two lines — it is one address.

---

## What not to say

- ❌ "We invented proof-of-reserve minting." Chainlink got there first.
- ❌ "We invented cross-chain supply accounting." OFT and CCT got there first.
- ❌ "Nobody has done optimistic verification." UMA and rollups got there first.
- ❌ Anything beginning "the first ever". Three novelty claims have already died in this
  project; the surviving ones are narrow and specific, and that is *why* they survive.

Say what is checkable in ten seconds. A claim a judge can verify beats a bigger one they
can rebut.

---

## The close

> Increasing liabilities requires a fresh cryptographic proof. Decreasing them requires
> nothing at all.
>
> Every failure mode — attestors stalling, our relayer censored, the proof service down,
> the custodian going quiet — lands in the same place: **minting frozen, redemption
> open.** There is no key, no config and no admin action that inverts that.
>
> Bound to the chain, not to a committee.
