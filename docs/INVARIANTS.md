# Invariants

This document states MintBound's safety properties as formal propositions, names the
mechanism that enforces each one, and points at the executable test that checks it.

Everything here is machine-checked. `packages/contracts/test/solidity/MintBoundInvariant.t.sol`
runs seven invariants against a randomised handler that can prove arbitrary reserves,
attempt arbitrary mints, redeem, and age the attested source height — in any order.

---

## Notation

| Symbol | Meaning | On-chain source |
|---|---|---|
| $R(t)$ | Last cryptographically proven source-chain reserve balance | `reserves[asset].verifiedBalance` |
| $E(t)$ | Announced-but-unexecuted withdrawals | `reserves[asset].encumbered` |
| $h$ | Haircut, as a fraction | `haircutBps / 10000` |
| $C(t)$ | Effective backing — the *ceiling* | derived, see below |
| $S_c(t)$ | Wrapped supply on chain $c$ | `WrappedAsset.totalSupply()`, `remoteSupply[·]` |
| $L(t)$ | Total liabilities across all chains | `totalLiabilities(asset)` |
| $\Lambda$ | Detection latency — source blocks between an event and its attestation | measured live |
| $\Delta$ | Withdrawal delay, in source blocks | `ReserveVault.WITHDRAWAL_DELAY` |

The ceiling subtracts encumbrances **before** applying the haircut:

$$C(t) = \bigl(\max(R(t) - E(t),\ 0)\bigr) \times h$$

This ordering is not cosmetic. Applying the haircut first would credit the protocol with
a discounted portion of money that has already been announced as leaving.

---

## I1 — Bounded issuance

> **No mint may ever leave total liabilities above the proven ceiling.**

$$\forall\ \text{mint of size } \delta:\quad L(t) + \delta \le C(t)$$

Enforced in `MintBoundASC._checkBound`, evaluated inside the same transaction that
mints. Checked by `invariant_noMintEverBreachesTheBound`.

Note this is a bound on the **stock**, not the flow. The check is not "is this deposit
backed" but "is the resulting total backed" — which is what catches reserve that left an
hour ago.

## I2 — Breach implies freeze

> **If liabilities exceed the ceiling for any reason, minting is already frozen.**

$$L(t) > C(t) \implies \neg\,\text{canMint}(t)$$

Checked by `invariant_breachImpliesFrozen`.

**I1 and I2 are two halves of one property, and the split is load-bearing.** The naive
statement — $L(t) \le C(t)$ at all times — is *false*, and the fuzzer proved it false
against an earlier version of this document. A reserve can legitimately fall after supply
was minted against it: the custodian's balance drops, the next proof reports a lower
$R$, and supply is now above the ceiling without anyone having done anything wrong.

Specifying the invariant as "supply never exceeds the ceiling" would therefore have
demanded something the system cannot provide, and the only ways to satisfy it are worse
than the problem — burn users' tokens, or refuse to record the lower reserve. What the
system can guarantee is the pair: **no mint ever causes a breach, and any breach however
caused stops further minting.**

## I3 — Encumbrance never backs new supply

> **Announced withdrawals are excluded from backing from the moment they are announced,
> not from the moment they execute.**

$$\text{mint permitted at } t \implies L(t) + \delta \le (R(t) - E(t)) \times h$$

Checked by `invariant_encumbranceNeverBacksNewSupply`.

## I4 — Liveness–safety margin

> **A withdrawal cannot execute before the system could have detected it.**

$$\Delta \ \ge\ 2\Lambda$$

Enforced at construction: `ReserveVault` reverts if `withdrawalDelay < MIN_WITHDRAWAL_DELAY`
(120 blocks), and the deploy script sets 150. Observed $\Lambda$ on CC3 is roughly 40–57
blocks, so the live margin runs about 2.6–3.8×.

This is the invariant that closes the attestation gap. Because a withdrawal must be
announced $\Delta$ blocks before it can move, and announcement immediately reduces the
ceiling via I3, the reserve stops backing new supply strictly before the money can leave.

**This is convergent with, not derived from, the announce-then-execute pattern described
in the cross-chain bridge liquidity literature.** We arrived at it from the attestation
lag; the literature arrives at it from auditability. Same shape, independently.

## I5 — Exact supply accounting

> **Supply equals what was minted minus what was redeemed. There is no other path.**

$$S(t) = \sum \text{mints} - \sum \text{redemptions}$$

Checked by `invariant_supplyAccountingIsExact`. Combined with I6, this closes off
supply appearing from anywhere other than a proof-gated mint.

## I6 — Immutable minter

> **The wrapped token's minter is the guard, permanently.**

`WrappedAsset.minter` is immutable. No governance action, upgrade, or call sequence
changes it. Checked by `invariant_minterIsAlwaysTheASC`.

## I7 — Absolute circuit breaker

> **While frozen, no supply may be created by any path.**

Checked by `invariant_frozenMeansNoNewSupply`.

## I8 — Redemption is never gated

> **Anyone holding wrapped tokens can always burn them, regardless of protocol state.**

Checked by `invariant_redemptionAlwaysReducesSupply`.

This is the asymmetry the whole design turns on: **increasing liabilities requires a
fresh proof; decreasing them requires nothing.** Every failure mode in the system —
stale proof, missing chain, frozen breaker, absent worker, unavailable prover — lands on
the same side of that line. Minting stops. Redeeming does not.

---

## Running them

```bash
npm run test:invariant -w @mintbound/contracts
```

The harness is forge-std's invariant tooling running under Hardhat 3 — not a standalone
Foundry project, so `forge test` is not the entry point. Run count is configurable;
the committed default is 256 runs per invariant.
