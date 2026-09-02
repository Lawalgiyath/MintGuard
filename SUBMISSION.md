# MintBound — DoraHacks submission copy

Paste-ready text for the BUIDL page. Written so that every factual claim resolves to
something a reader can run, read, or look up on a block explorer.

---

## Project name

**MintBound**

## Tagline

Proof, not promise. Per-mint cryptographic authorization for wrapped and tokenized
real-world assets.

## Sector / track

RWA (secondary: DeFi infrastructure)

---

## Short description

Every wrapped token makes one promise: that each token is backed by something real,
somewhere else. Today that promise is *reported* — by an oracle network, a custodian, or
a monthly PDF.

MintBound turns the promise into a condition of whether new tokens can exist at all. It
holds mint authority and refuses to use it unless Creditcoin's Block Prover precompile
has cryptographically verified, **inside the minting transaction**, that the backing is
there.

It is infrastructure, not an application: the primitive that other RWA products on
Creditcoin can depend on so that the assets they represent cannot quietly become unbacked
liabilities.

The rules ask for cross-chain logic *“without relying on centralized oracle operators”*.
MintBound answers that with a number rather than a paragraph: **`trustedParties()` returns
`0`** — a value the contract publishes, meaning zero off-chain parties must be honest for
the reserve figure to hold. No other reserve system publishes that number at all.

Two further things are unusual, and both are checkable in under a minute. It is the only
project in this hackathon that verifies **reserves** rather than events. And it is the
only one that audits itself: `npx mintbound-cli claims` re-checks **every factual claim
on this page** against live chain state and returns a non-zero exit code if any of them
fails.

---

## The problem

Attestcoin's own front page names the problem: *“Billions lost to bridge exploits, again
and again”*, and *“wrap and unwrap tokens just to move”*.

In July 2023, Multichain operated wrapped assets across ten chains against custodied
reserves, held roughly $1.26B, and lost approximately $126–130M when centralised control
failed. Every one of those chains could have shown a healthy per-chain reserve check
while the system as a whole was insolvent, because no per-chain design ever looks at the
other chains.

The year before, holders of the Cashio stablecoin discovered their tokens were backed by
nothing and $52.8M evaporated. In neither case was there a moment at which the system
said *the backing is leaving* — because nothing in it was watching the backing.

This is a structural gap, not a bug in one project. A mint contract on chain B cannot see
chain A. So it asks someone. Proof of Reserve systems answer that question honestly and
well, but the answer is still a *report*: a number, attested by a party you must trust,
about a moment that has already passed. It says nothing about encumbrances, nothing about
liabilities on other chains, and nothing about what happened between reports.

For a lender in a market where a local auditor's signature carries little weight and
cross-border recourse is theoretical, a monthly attestation is not assurance.
Cryptographic proof is the only form of assurance that travels unchanged — it is
identical for a lender in Lagos and a lender in London. That is the inclusion argument,
and it is why this belongs on Creditcoin specifically.

---

## Attestcoin Protocol Integration Summary

*(This is a separate form field from Project Description. Paste this there.)*

MintBound holds mint authority over a wrapped asset and will not exercise it unless the
Attestcoin Protocol has cryptographically verified, inside the minting transaction, that
the backing exists. The protocol is not a checkpoint here — remove either precompile and
there is no product, because Attestcoin is the guard's only source of truth about the
source chain.

Six integration points feed one on-chain invariant:

1. **State-to-event lifting.** The Block Prover proves *transactions*; solvency is a
   question about *state*. A permissionless function makes the vault emit its own balance
   into a log, so the balance becomes a fact about a transaction and therefore provable.
   This generalises — it turns a transaction oracle into a state oracle usable by any dApp
   on Creditcoin.
2. **Per-mint verification via Block Prover precompile `0x0FD2`** — Merkle and continuity
   proofs checked in the same transaction that mints. No reporter in the path;
   `trustedParties()` returns 0.
3. **Freshness read on-chain from ChainInfo precompile `0x0FD3`**, so no off-chain party
   can lie about how stale a proof is.
4. **Encumbrance-aware bounds.** Withdrawals are announced and timelocked; an announced
   exit stops counting as backing immediately, which closes the ~9 minute attestation
   window. The delay is required to exceed 2x measured detection latency, enforced at
   construction.
5. **Cross-chain liability aggregation.** Remote wrapped supply is proven the same way and
   summed; a registered chain that stops reporting freezes minting.
6. **Optimistic interval continuity.** "No outflow over [a,b]" is asserted under bond and
   refutable by a single inclusion proof, with the bond paid to the challenger.

**On depth specifically.** Attestcoin secures itself with *“a decentralized network of
independent verifiers, called Attestors, who each confirm what's true and put real money
on the line.”* Mechanism 6 applies that identical economic pattern one layer up: where the
protocol bonds attestors to secure *facts*, `SolvencyContinuity` bonds claimants to secure
*intervals between facts*. We did not merely call the protocol — we extended its own
security model to the gap it does not cover.

Built against `@gluwa/usc-contracts@0.2.0` and `@gluwa/usc-sdk@0.18.0`, live on CC3
testnet (chainId 102031) with Ethereum Sepolia as source (chainKey 1). Measured on-chain:
`mintWithProof` costs 382,578 gas including full proof verification and the aggregate
invariant.

Full technical documentation, including four undocumented protocol behaviours we hit and
how we handled them: `docs/ATTESTCOIN_INTEGRATION.md`

Verifiable by anyone with no key and no funds: `npx mintbound-cli verify --source-tx 0x...`

---

## Depth detail — append to Project Description if the field allows

*Depth of Attestcoin utilization is the stated core scoring criterion, so this is the
most specific section here. It expands the six points summarised above.*

MintBound uses the protocol in **six distinct ways**, feeding a single on-chain
invariant:

**1. State-to-event lifting.** The Block Prover precompile proves *transactions*, not
*state*. Reserve solvency is a question about *state* — a balance. MintBound closes that
gap: a permissionless function on the source chain writes the vault's balance into a log,
which makes the balance a fact about a transaction, which makes it provable. This
technique generalises — it turns a transaction oracle into a **state oracle available to
every dApp on Creditcoin**, and is the most reusable thing in the repo.

**2. Per-mint Merkle + continuity proof** via Block Prover precompile `0x0FD2`. Verified
in the same transaction that mints. No reporter anywhere in the mint path.

**3. Freshness read on-chain** from ChainInfo precompile `0x0FD3`. The contract asks
Creditcoin itself how stale the proof is, so no off-chain party can lie about it. (Note:
`0x0FD3` has no published Solidity interface — ours is reconstructed from the SDK ABI.)

**4. Encumbrance subtraction.** Withdrawals from the reserve must be *announced* and are
timelocked. An announced exit stops counting as backing from the moment it is announced,
not when it executes — which closes the ~9-minute attestation window.

**5. Cross-chain liability aggregation.** `SupplyBeacon` proves wrapped `totalSupply()`
on each remote chain; the bound sums liabilities across all of them. A registered chain
that stops reporting freezes minting — unknown liability is not treated as zero
liability.

**6. Optimistic interval continuity.** You cannot cheaply prove "no funds left over this
interval", but a *single* inclusion proof refutes it. So the negative is asserted under
bond and refuted cryptographically: claim, bond, refutation window, slash.

---

## The invariant

Everything above serves one rule, checked inside the minting transaction:

> **Total liabilities across all chains, plus this mint, must not exceed the proven
> reserve minus announced exits, after haircut.**

Two properties follow, and they are the actual specification:

- **No mint may ever leave supply above the proven ceiling.**
- **If supply is above the ceiling for any reason, minting is already frozen.**

The naive single-statement version (`supply <= ceiling` at all times) is *false*, and our
own invariant fuzzer proved it false against an earlier draft of our specification — a
legitimate reserve decrease after minting is a counterexample. We restated it rather than
weakening the system to fit the claim.

Underneath it all is one asymmetry: **increasing liabilities requires a fresh proof;
decreasing them requires nothing.** Every failure mode — stale proof, silent chain,
absent worker, unavailable prover — lands on the same side. Minting stops. Redeeming
never does.

---

## What is live

**7 contracts on Creditcoin CC3 testnet, 3 on Ethereum Sepolia.** Not mocked.

| Contract | Address (CC3, chainId 102031) |
|---|---|
| MintBoundASC | `0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8` |
| WrappedAsset | `0x1f42B80ebac56AF3f023997A4240D3B97476A557` |
| ProvenReserveFeed | `0x5578784ddE6c05c0370119FF68c439847CB307D7` |
| ConventionalPoRFeed | `0xbAceA461241F5D9D27e2308D279AB1add95B226F` |
| SecureMintReference | `0x8f2A246623b000DE0486242f8806b0dDeF2375b9` |
| SolvencyGatedCredit | `0x44082286d90ebB087F34EE4Bc6Bd918B205d7156` |
| SolvencyContinuity | `0x448292774b807B49025002e256d004378f788d07` |

A full deposit → attestation → proof → mint cycle has completed end to end on live
infrastructure.

**Measured gas** (not estimated):

| Operation | Gas |
|---|---|
| `submitReserveSnapshot` | 368,592 |
| `mintWithProof` | 382,578 |

Under 400k for cross-chain proof verification *plus* the full aggregate invariant *plus*
the mint.

**Test surface:** 118 unit tests · 7 invariants × 256 randomised runs · 13 live
infrastructure checks · 6/6 live attacks blocked · all 10 contracts verified on-explorer.

---

## Check it yourself — no key, no funds, no setup

```bash

> **If `npx` reports the package is not found**, it has not been published yet.
> Everything above also runs straight from a clone, with no publish step:
> `git clone https://github.com/Lawalgiyath/MintGuard && cd MintGuard && npm install && npm run claims`
npx mintbound-cli claims     # re-check every claim on this page against live state
npx mintbound-cli status     # live balance sheet + assurance vector
npx mintbound-cli attack     # fire the documented attacks at the live guard
npx mintbound-cli verify --source-tx 0x...
```

`claims` is the one to run first. It takes each factual assertion in this submission,
resolves it against chain state and the block explorer right now, and exits non-zero if
any of them fails — including the ones that are inconvenient for us. A self-audit that
cannot return FAIL is marketing in a monospace font, so this one can, and does.

This works because the Proof Builder is a read API and the guard's entry points are
reachable by `eth_call`. **You do not have to trust anything we wrote here.** Point the
tool at the deployment and read the answer off the chain.

---

## The adoption path

`ProvenReserveFeed` implements Chainlink's `AggregatorV3Interface`.

We are not claiming to be a better Chainlink — Chainlink's Secure Mint already gates
minting on Proof of Reserve, and it does the aggregate check correctly. We are a **drop-in
cryptographic evidence backend for the interface the industry already uses.** Change one
address in any existing Proof of Reserve integration and you get, without rewriting
anything:

- cross-chain transaction proof instead of an oracle report
- encumbrance-adjusted reserve instead of a raw balance
- independently measured liabilities instead of assumed ones
- freshness enforced by a precompile instead of a heartbeat

To prove this is real rather than asserted, the repo contains
`examples/SecureMintReference.sol` — Chainlink's Secure Mint pattern, written to their
spec with no knowledge of MintBound — running unmodified against our feed, in the test
suite.

We also publish something no other reserve system does: **`trustedParties(asset)`**,
returning `0` for cryptographically proven reserves and `1` for oracle-reported ones. An
integrating protocol can read how much trust its own evidence requires.

---

## What is distinctive

Three things, stated narrowly because each is checkable:

**State-to-event lifting on Attestcoin.** The Block Prover proves *transactions*;
solvency is a question about *state*. Making a vault emit its own balance turns a
transaction oracle into a **state oracle available to every dApp on Creditcoin**. It is
the most reusable thing in this repository, and any other project this season can adopt
it.

**Encumbrance-aware bounds tied to measured attestation latency.** Announced exits stop
counting as backing the moment they are announced, and the withdrawal delay is required
to exceed twice the observed detection latency — enforced at construction, not by
convention.

**The composition.** Reserve proof, liability proof, encumbrance, freshness and interval
continuity resolved into one bound, evaluated inside the minting transaction, with zero
trusted parties in that path.

---

## Where this sits in the field

We surveyed the public repositories built against the Attestcoin Protocol this season
— roughly 80 of them — rather than guessing. They cluster tightly:

| What people built | Roughly |
|---|---|
| Credit scoring and portable reputation | ~15 |
| Settlement and payment verification | ~10 |
| Monitoring, alerting, agents | ~8 |
| **Reserve solvency** | **1** |

Everyone else is proving that an **event happened** — a payment settled, a loan was
repaid, a delivery occurred — and then acting on it. MintBound proves **state**, and
enforces a balance-sheet invariant on what it proves.

This is a claim about **category**, not about the quality of other work. The question
"is the money still there?" is being asked once in this hackathon.

The RWA track asks for work that bridges off-chain value with on-chain transparency.
Reserve solvency is that question, stated exactly.

---

## Who pays, and why

CEIP funds products, so here is the commercial shape rather than a slogan.

**Who needs this.** Anyone who issues a token backed by something held elsewhere: wrapped
asset issuers, tokenised treasury and invoice platforms, and any RWA protocol on Creditcoin
whose collateral sits on another chain. Today they either publish a periodic attestation or
consume an oracle feed; both are reports, and both are the thing that failed at Multichain
and Cashio.

**Why they would switch.** They mostly do not have to. `ProvenReserveFeed` implements
`AggregatorV3Interface`, so adoption is a one-address change inside an integration that
already exists — not a rewrite, not a new standard to learn.

**Where revenue comes from.** The honest answer is that the primitive itself should be free
and unpermissioned, because a solvency check nobody can run is worth nothing. The
commercial surface sits beside it: running the snapshot and proof relay as a service for
issuers who do not want to operate one, and per-asset assurance reporting for the parties
who need to show a regulator or a counterparty that the backing was continuously proven.
The relay is deliberately untrusted — it can censor, it cannot forge — so selling it
creates no new trust assumption for anyone.

**What it does for Creditcoin.** Every proof is a CC3 transaction. An issuer running
continuous attestation on one asset generates steady, non-speculative block space demand,
and the pattern in mechanism 1 turns Attestcoin's transaction oracle into a state oracle
that any other project in this hackathon can reuse.

---

## Repository

- [`docs/deck.html`](docs/deck.html) — the submission deck, 13 slides, prints to PDF
- [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md) — setup + how the protocol is used (submission requirement)
- [`docs/INVARIANTS.md`](docs/INVARIANTS.md) — formal safety properties and the tests that check them
- [`docs/EVIDENCE.md`](docs/EVIDENCE.md) — every claim mapped to a runnable artifact
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- [`packages/cli`](packages/cli) — verify any of it yourself
