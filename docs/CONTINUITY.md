# Interval proof of reserve

*Hypothesis · prior art · mechanism · soundness · experiments · what is and is not novel*

---

## The gap, in the industry's own words

Every proof of reserve in existence is a **snapshot**. It says the reserve was X at
height H. It says nothing about H+1.

This is the category's standing criticism, and it is not ours:

> "Proof of Reserves audits offer only a snapshot in time, not a continuous, real-time
> view of solvency… the interval between snapshots creates a window where deterioration
> goes undetected."

> "Real-time or continuous PoR remains a goal but is not yet widely implemented due to
> computational and privacy constraints."

Every mechanism in MintBound up to this point shared the flaw. The timelock closes the
*announced* withdrawal path. The mint velocity cap *bounds* the damage of an unannounced
one. Neither tells you what happened between two snapshots.

## Hypothesis

> A negative — "no reserve left this vault" — cannot be proven cheaply, because it would
> require enumerating every transaction in the interval. But the positive that refutes it
> is a **single inclusion proof**.
>
> Therefore reserve continuity over an interval can be asserted optimistically under bond
> and refuted cryptographically. If Attestcoin makes the refutation trustless and
> permissionless, the resulting guarantee covers the whole interval rather than its
> endpoints — converting point-in-time proof of reserve into continuous proof of reserve.

## Prior art, stated before the claim

Bonded assertions with challenge windows are **not new**, and pretending otherwise would
be the third novelty overclaim in this project's history. What is different is narrow and
specific — it is what happens when someone disputes.

| System | Assertion is about | Dispute resolved by |
|---|---|---|
| **UMA Optimistic Oracle** | Any off-chain fact | **A token-holder vote.** A price request goes to the DVM; stakers commit and reveal over 48 hours; a 65% majority of staked UMA decides. Resolution is *social* |
| **Optimistic rollups** | The rollup's own state transition | **Re-execution** of that transition on L1. Deterministic — but only ever about the rollup's own chain |
| **SolvencyContinuity** | A **foreign chain's** transaction history | **A Merkle + continuity proof of that foreign chain, verified by native code in the disputing transaction.** No vote, no committee, no re-execution, no subjectivity |

The reason nobody builds the third row on Ethereum is structural: Ethereum can re-execute
its own state but cannot natively verify another chain's transactions, so an optimistic
claim *about a foreign chain* has to fall back on a committee — which is exactly what UMA
does. Attestcoin removes the committee. That is what makes an optimistic construction
acceptable for a solvency guarantee rather than merely convenient for a price feed.

**So the honest claim is:** the mechanism is borrowed, the dispute-resolution primitive is
what Creditcoin uniquely enables, and the application to reserve continuity is where the
value is.

## Soundness

An ERC-20 balance decreases **only** through a `Transfer` event whose `from` is the
holder. So:

```
    balance(V) = X at height A                    proven by a reserve snapshot
  ∧ no Transfer(from = V) in (A, B]               asserted under bond, refutable
  ⟹ balance(V) ≥ X for every height in [A, B]
```

Not interpolated between two points — established across the interval. Deposits only add,
so the bound holds in the safe direction throughout.

Three constraints stop the claim being decorative:

| Constraint | Why it is load-bearing |
|---|---|
| `fromHeight` must equal where coverage currently ends | A claim about a disconnected interval proves nothing about the reserve backing supply *now*. Coverage advances as an unbroken chain or not at all |
| `toHeight` must already be attested on Creditcoin | Over unattested blocks **no disproof could ever be generated**. Accepting an unfalsifiable claim by default is strictly worse than having no claim |
| One open claim per asset | Keeps coverage strictly contiguous and the state trivial to reason about |

The refutation itself is bound twice: the log must be emitted by the **asset's real token
contract** (anyone can emit a `Transfer`-shaped log from a contract they control) and its
`from` must be the **canonical vault**.

## Economics

The bond goes to whoever refutes. Watching is therefore *paid work*, which is what makes
the optimistic assumption reasonable rather than hopeful. Refutation costs one
transaction and is open to anyone — the custodian cannot exclude challengers, and there
is no reputation, stake or whitelist to acquire first.

Asserting a false negative is simply a losing wager against anyone with an RPC endpoint.

## Experiments

`packages/contracts/test/Continuity.test.ts` — **21 tests**, written to break it.

**The guarantee**
- anchors only to a cryptographically proven snapshot height
- unrefuted claims establish coverage; bond returns to the asserter
- coverage advances contiguously across consecutive intervals

**Refutation**
- one outbound `Transfer` destroys the claim and pays the challenger the bond
- a refuted claim can never later be settled
- refutation is permissionless — any address may collect

**Attempts to get coverage without earning it**
- ✗ unfalsifiable claim over unattested blocks → `BeyondAttestation`
- ✗ claim that skips a gap → `NonContiguous`
- ✗ empty/inverted interval → `EmptyInterval`
- ✗ underfunded bond → `BondTooSmall`
- ✗ second concurrent claim → `ClaimAlreadyOpen`
- ✗ settling early → `StillLive`

**Attempts to forge a refutation**
- ✗ `Transfer` emitted by a fake token contract → `NoOutflowFound`
- ✗ `Transfer` not from the canonical vault → `NoOutflowFound`
- ✗ outflow from outside the interval (either side) → `HeightOutsideInterval`
- ✗ proof the precompile rejects → reverts in the precompile
- ✗ refutation built on a **reverted** source transaction → `SourceTransactionReverted`
- ✗ proof from the wrong source chain → `WrongChainKey`

**Honest reporting**
- `uncoveredBlocks()` reports every attested block as uncovered until claims settle
- `isContinuouslyProven()` returns false while coverage lags the attested tip, and only
  turns true once the whole range to the tip is covered

## What is and is not novel

**Not novel:** optimistic assertions, challenge windows, bonds, slashing, fraud proofs.
UMA and every optimistic rollup got there first. Say so first.

**Not novel:** wanting continuous proof of reserve. The industry names it as the goal.

**Defensible:** an optimistic claim about a *foreign chain's* history whose dispute is
settled by a native cross-chain inclusion proof rather than by a vote or by re-execution.
That combination requires a chain that can verify other chains natively, which is why it
has not appeared on Ethereum.

**Defensible:** the resulting guarantee — reserve continuity across an interval rather
than at sampled instants — which is the specific thing the category is criticised for
lacking.

## Honest limits

- **Optimistic, not absolute.** Within the liveness window a claim is unproven. The
  guarantee is "no one could refute this in an hour, with a bond on the table", which is
  strictly weaker than a direct proof and strictly stronger than a snapshot.
- **Assumes a standards-compliant token.** A rebasing or fee-on-transfer token can change
  balances without a corresponding `Transfer(from = V)`, which would break the soundness
  argument. Such assets must not be registered.
- **Liveness is a real cost.** Coverage lags the attested tip by at least one liveness
  window. `uncoveredBlocks()` reports that lag rather than hiding it.
- **Censorship is the residual attack.** If a challenger cannot get a transaction included
  during the whole liveness window, a false claim settles. This is the standard fraud-proof
  assumption, and it is why liveness is an hour rather than a minute.
- **Bond sizing is a governance parameter**, not a solved problem. It must exceed the cost
  of refuting and ideally scale with the value at risk.
- **This proves reserve did not leave. It does not prove the reserve is worth anything** —
  asset quality is a separate question this contract makes no claim about.
