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

---

## The problem

On 23 March 2022, holders of the Cashio stablecoin discovered their tokens were backed by
nothing. $52.8M evaporated. There was never a moment at which the system said *the
backing is leaving* — because nothing in the system was watching the backing.

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

Built against `@gluwa/usc-contracts@0.2.0` and `@gluwa/usc-sdk@0.18.0`, live on CC3
testnet (chainId 102031) with Ethereum Sepolia as source (chainKey 1). Measured on-chain:
`mintWithProof` costs 382,578 gas including full proof verification and the aggregate
invariant.

Full technical documentation, including four undocumented protocol behaviours we hit and
how we handled them: `docs/ATTESTCOIN_INTEGRATION.md`

Verifiable by anyone with no key and no funds: `npx @mintbound/cli verify --source-tx 0x...`

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

**Test surface:** 80 unit tests · 7 invariants × 256 randomised runs · 13 live
infrastructure checks · 6/6 live attacks blocked.

---

## Check it yourself — no key, no funds, no setup

```bash
npx @mintbound/cli status     # live balance sheet + assurance vector
npx @mintbound/cli attack     # fire the documented attacks at the live guard
npx @mintbound/cli verify --source-tx 0x...
```

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

## What is genuinely novel — and what is not

We killed five of our own novelty claims and are publishing the autopsy, because a claim
that does not survive scrutiny is worse than no claim. The fifth was killed by a project
in this very hackathon, three days before we looked.

| Claim we considered | Verdict |
|---|---|
| Reserve-gated minting | **Not novel.** Chainlink Secure Mint does this. |
| Aggregate (stock, not flow) check as our differentiator | **Not novel.** Secure Mint checks the aggregate too. |
| Cross-chain supply aggregation | **Not novel.** LayerZero OFT and Chainlink CCT do this. |
| Optimistic verification with bonded dispute | **Not novel.** UMA and optimistic rollups got there first. |
| "Bonded assertion of a negative, refutable by one proof" as our idea | **Not novel, and not even uniquely ours this season.** `PugarHuda/utuh` independently built the same primitive for *set completeness* rather than reserve outflow, and did it more generally. Two teams reaching it independently is evidence the primitive is right, not that either of us invented it. |

What survives is narrow and specific, and it survives *because* it is narrow:

- **State-to-event lifting on Attestcoin** — making a *balance* provable through a
  transaction-proof primitive, as a reusable pattern for the whole ecosystem.
- **Encumbrance-aware bounds tied to measured attestation latency** — the withdrawal
  delay is required to exceed 2× the observed detection latency, enforced at
  construction. This is convergent with the announce-then-execute pattern in the
  cross-chain bridge literature; we reached it from the attestation lag rather than
  copying it.
- **The composition**: reserve proof + liability proof + encumbrance + freshness +
  continuity, resolved into one bound evaluated inside the minting transaction, with zero
  trusted parties in that path.

---

## Honest limits

- **Nothing here is private.** Reserve balances and the vault address are public by
  construction — emitter binding requires it. Privacy would need Pedersen commitments and
  range proofs; the bn128 precompiles needed for that exist on Creditcoin, but we did not
  build it and will not claim we scoped it further than that.
- **Continuity is optimistic, not absolute.** During the liveness window the no-outflow
  claim is economically backed, not cryptographically established. Anyone may be the
  watcher; being wrong costs the claimant their bond. It is a game, not a theorem.
- **~9 minute latency** from source event to provability. That is a protocol property —
  the cost of not trusting a reporter — and mechanism 4 is what makes it survivable
  rather than fatal.
- **Chain registration is trusted.** The bound sums over *registered* chains. A chain
  nobody registered contributes zero and is invisible. This is the largest remaining
  trust assumption in the system, and we would rather name it than have it found.

---

## Repository

- [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md) — setup + how the protocol is used (submission requirement)
- [`docs/INVARIANTS.md`](docs/INVARIANTS.md) — formal safety properties and the tests that check them
- [`docs/EVIDENCE.md`](docs/EVIDENCE.md) — every claim mapped to a runnable artifact
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- [`packages/cli`](packages/cli) — verify any of it yourself
