# Why back this

*The investment case, written for someone deciding where $25k–$250k goes.*

---

## The human story

On 23 March 2022, someone was holding CASH. They believed it was backed — that was the
entire proposition of the token. Overnight it went to **$0.00005**. Around **$52.8
million** evaporated because a mint function accepted a collateral account it never
checked.

The part that matters is not the number. It is that the holders found out *afterwards*.
There was no moment where the system said *"the backing is leaving."* By the time anyone
knew, the thing they would have redeemed into was already gone.

That is the failure this exists to prevent, and it produces a promise a normal person
can hold onto:

> **The moment your backing starts to leave, you find out — and you can still get out.**

Both halves are enforced in code, not policy:

- **You find out.** Reserves cannot leave the vault without a public, cryptographically
  provable announcement roughly 30 minutes in advance. Anyone can prove that
  announcement to Creditcoin. Nobody needs permission to be the one who notices.
- **You can still get out.** Redemption requires no proof, no freshness, no oracle, and
  works while the system is frozen. Minting is what freezes. Exiting never does.

Every failure mode in the system — attestors stalling, the relayer being censored, the
proof service going down, the custodian going quiet — lands in the same place: **minting
frozen, redemption open.** There is no configuration, no key, and no admin action that
inverts that.

---

## What is actually being funded

Not a wrapped token. A **reserve verification primitive** with three properties that do
not currently coexist anywhere:

**1. The number is a proof, not a report.**
Every proof-of-reserve product in production ultimately rests on someone *reporting* a
balance — a decentralized oracle network, a custodian, an auditor. MintBound's mint path
contains no reporter at any step. The balance, its encumbrances, and its freshness are
each verified by native Creditcoin code inside the transaction that acts on them.

**2. Encumbrance is enforced on-chain — a gap the incumbents name and do not close.**
The PoR industry states its own limitation plainly: proof of reserves *"says nothing
about whether those assets are encumbered, pledged as collateral elsewhere, or owed to
creditors."* Today that is handled in an auditor's prose, monthly. MintBound proves
announced withdrawals cryptographically and subtracts them from backing **before the
funds are permitted to move**. A reserve with an exit already announced against it stops
counting immediately.

**3. It grades its own evidence.**
`trustedParties(asset)` returns `0` for cryptographically proven reserves and `1` for
oracle-reported ones. No other reserve system publishes how much trust its own number
required. This is what lets MintBound cover fiat and off-chain custody — the assets an
inclusion proof physically cannot reach — **without lowering its standard or blurring
the distinction.** Minting on oracle evidence is opt-in per asset and off by default.

---

## The distribution answer

The usual objection to a new reserve primitive is that nobody will rewire their
contracts for it. So we did not ask them to.

`ProvenReserveFeed` implements **`AggregatorV3Interface`** — the exact interface
Chainlink Proof of Reserve feeds serve and Secure Mint integrations already consume.
Any of them can point at MintBound instead and keep working with **no code change**.

This is not a claim. `SecureMintReference.sol` is a faithful reproduction of Chainlink's
Secure Mint pattern, written against `AggregatorV3Interface` with **no knowledge that
MintBound exists**, and there is a passing test that runs it unmodified on a MintBound
proof. Two further tests show it silently gaining properties its author never wrote:

- its reserve figure becomes encumbrance-adjusted;
- its existing `updatedAt` staleness check — code it already had, already audited — now
  enforces MintBound's freshness bound.

So the addressable surface is not "projects willing to adopt a new standard." It is
**every integration already built against Proof of Reserve**, which as of mid-2026 is
40+ feeds across 56 projects securing north of $17B.

MintBound does not compete with Proof of Reserve. It is a **stronger evidence tier
wearing the incumbent's connector** — which is the only realistic way a new reserve
primitive has ever been adopted.

---

## Why this specifically matters to Creditcoin

**It extends the protocol rather than consuming it.**

The Block Prover proves *transaction inclusion*. It cannot answer "what is this account's
balance?" — that is state, not an event, and it is a hard ceiling on what any Attestcoin
dApp can do. **State-to-event lifting** removes that ceiling: write the balance into a
log, and it becomes a fact about a transaction, which is exactly what the precompile can
prove. That pattern is not specific to reserves. It turns Attestcoin from a transaction
oracle into a **state oracle for every dApp on Creditcoin**, and it is not in the
protocol's documentation today.

**It is the only submission using two precompiles.** Every other entry uses BlockProver
`0x0FD2`. MintBound also uses ChainInfo `0x0FD3` for on-chain freshness — an interface
Gluwa does not publish in Solidity, reconstructed from the ABI embedded in the SDK and
verified against the live network.

**It found real defects in the developer surface** — a dead prover hostname, a
superseded SDK class, a moved decoder import path — all documented in
`docs/RESEARCH.md`. That is the behaviour profile of an ecosystem contributor, not a
prize applicant.

---

## What the diligence looks like

| | |
|---|---|
| Tests | **52 unit tests**, covering every documented attack |
| Invariants | **7 stateful invariants at 256 randomised runs each** — and the fuzzer corrected our own specification (see below) |
| Precompile mocking | Injected at the real addresses (`0x0FD2`, `0x0FD3`) so production code runs unmodified |
| Live integration | **13/13 checks against real CC3 infrastructure** — `npm run verify:live` |
| Real proof verified | The live precompile accepts our proof; a tampered one reverts |
| Adversarial tooling | A live attack suite runs six real exploits against the deployment |
| Honest limits | Six gaps documented before anyone had to ask |

**The invariant suite found something, which is the point of writing one.** Our first
stated invariant was `supply <= ceiling` at all times. The fuzzer produced a
counterexample within seconds: mint against a high proven reserve, then prove a lower one.
Supply is now above the ceiling and no rule was broken — a contract cannot retroactively
destroy correctly-issued supply. That situation *is* the breach the circuit breaker
exists to announce. The real invariant is stronger and has two halves: no mint may ever
breach the bound, and any breach must imply frozen. Both now hold across 256 randomised
call sequences. The specification was wrong, not the code — which is exactly the outcome
invariant testing is for.

The live verification is worth dwelling on: the Proof Builder is a read API and the
precompile's `verify()` is a view function, so the **entire proof path was validated
against production infrastructure before a single gas unit was spent.** That is not a
common instinct.

---

## Business model and sustainability

Both questions have their own document — [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md) — because
both deserve more than a bullet. The short version:

**Revenue:** basis points on minted supply, paid by the issuer at mint time; reads free
forever so the primitive stays adoptable. Priced as underwriting, not as data — the buyer
is the issuer of the liability, not the consumer of the number. **Not implemented yet, on
purpose.** The honest caveat is stated there too: Chainlink secures $17B and captures
under $10M a year, so nobody should pitch reserve verification as an easy volume business.

**For CEIP specifically the return is ecosystem, not revenue** — it removes the
credibility blocker on Creditcoin's own RWA thesis, and state-to-event lifting extends the
protocol for every dApp on the chain, MIT licensed.

**Bus factor:** real, and bounded by architecture. The contracts are immutable and
non-upgradeable — no proxy, no upgrade path, no admin key that must be held responsibly
forever. If the author disappears tomorrow, the deployed system keeps working exactly as
it does today. The off-chain worker is untrusted and anyone can run one.

## The risks, stated plainly

Because a fund that reads a document with no risk section discounts the whole thing.

- **Not yet deployed.** Everything above is tested and live-verified; contracts go up
  once testnet funds land. Until then this is a strong argument rather than a running
  system.
- **Residual attack surface exists.** Losses that bypass the vault entirely — a
  compromised key, an exploited token — cannot be driven to zero by any detection
  scheme. A rolling mint velocity cap bounds the damage; it does not eliminate it.
- **On-chain reserves get the strong guarantee; off-chain ones do not.** The
  oracle-reported tier is honest coverage, not equivalent coverage, and the contract
  says so through `trustedParties`.
- **Single asset, single source chain, testnet.** The scope is deliberately narrow to
  make the invariant provable rather than broad to make the demo impressive.

---

## The one sentence

> Every reserve system in production asks someone to *report* whether the money is
> there. MintBound proves it — including the part about whether it is already promised
> to someone else — and speaks the incumbent's interface so nothing has to be rewritten
> to use it.
