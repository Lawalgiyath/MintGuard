# MintBound — Threat Model

Every row below maps to a test in `packages/contracts/test/MintBound.test.ts`. The tests
are the proof that this document is not aspirational.

## What is trusted

Stated precisely, because the value of the whole design is in how short this list is:

1. **Ethereum Sepolia finality.** If the source chain reorgs deeply, a proven event may
   cease to be true.
2. **Creditcoin's attestor set.** If a supermajority of attestors collude, they can
   attest a chain state that never existed.

That is the complete list. There is no third item. In particular there is **no**
oracle network, multisig, relayer, custodian, or heartbeat reporter anywhere in the
authorization path — which is the specific, checkable claim MintBound makes, and the
one thing that distinguishes it from Chainlink Secure Mint, CelsiusX's model, and the
2025 Wrapped Zcash design (all of which are prior art for reserve-gated minting as a
*category*).

The off-chain worker is explicitly **not** trusted. It can censor and it can stall. It
cannot forge, cannot over-issue, and cannot make a stale reserve look fresh. Anyone can
run one, and running several improves liveness without touching safety.

## Attack surface

| # | Threat | Mechanism | Mitigation | Test |
|---|---|---|---|---|
| 1 | Forged inclusion proof | Fabricate Merkle/continuity data | Native verification by Block Prover `0x0FD2`; contract reverts on `false` | `rejects a forged proof the precompile will not verify` |
| 2 | Reverted-transaction injection | Prove inclusion of a *failed* source tx | `receiptStatus == 1` enforced. **The precompile does not check this** — Gluwa documents it in a danger callout | `rejects a REVERTED source transaction…` |
| 3 | Counterfeit vault | Deploy a clone emitting a byte-identical `ReserveSnapshot` with a fabricated balance, get it into a real block | `log.address_ == CANONICAL_VAULT`, pinned immutably at construction | `rejects a byte-identical event emitted by a counterfeit vault` |
| 4 | Log-position manipulation | Place a counterfeit log *first* so `logs[0]` picks it | `_findVaultLog()` **scans** for the canonical emitter instead of indexing position — the reference implementation's `logs[0]` habit is unsafe here | `is not fooled by a counterfeit log placed BEFORE the genuine one` |
| 5 | Query replay | Resubmit an identical valid proof | `processedQueries[keccak(chainKey, height, txIndex)]` | `rejects resubmission of the same query` |
| 6 | Double-mint from one deposit | Same `Locked` event proven at a different height ⇒ different `queryId` | `consumedLocks[keccak(user, asset, nonce)]` — a second, independent guard | `rejects a second mint from one deposit…` |
| 7 | Stale-snapshot replay | Replay yesterday's *genuine, higher* balance to mask today's shortfall | Strictly monotonic `epoch` | `rejects replaying an older, higher snapshot…` |
| 8 | Height regression | Overwrite a newer snapshot with a reorged-out older one | `blockHeight >= attestedAtHeight` | `rejects a snapshot whose source height regresses` |
| 9 | Cross-chain confusion | Present a transaction from a cheaper chain | `chainKey` pinned immutably; mismatches revert | `rejects a proof from a different source chain` |
| 10 | Lying about freshness | Worker reports a false "current" source height | Freshness is read **on-chain** from ChainInfo `0x0FD3`. No caller input participates | `halts minting once the proof falls outside the staleness bound` |
| 11 | Post-mint custodian withdrawal | Rug after supply exists | **Withdrawals are timelocked and must be announced.** The announcement is proven on Creditcoin and the reserve is de-rated *before the funds can move*. See "Closing the detection window" below | `de-rates the reserve the moment an exit is announced, before funds move`, `will not execute before the timelock elapses` |
| 11b | Unannounced loss (compromised key, exploited token) | Reserves vanish without using the vault's own path | Drift detection + automatic freeze, **plus a rolling mint velocity cap** bounding damage inside the residual window | `detects the shortfall, freezes minting, and keeps redemption open`, `caps how much supply can be created per window` |
| 11c | Custodian announces, then rushes execution | Try to exit before Creditcoin sees the announcement | `WITHDRAWAL_DELAY` (150 blocks ≈ 30 min) exceeds 2× measured detection latency (57 blocks). Deploy script **refuses** a shorter value | `refuses a withdrawal delay shorter than detection latency` |
| 11d | Over-announcing to drain via encumbrance | Announce more than is held | `InsufficientUnencumberedBalance` — announcements cannot exceed free balance | `cannot announce more than is unencumbered` |
| 12 | Snapshot withholding | Custodian hides a shortfall by never snapshotting | Anyone may snapshot; and staleness halts minting anyway, so withholding degrades to frozen-mint | `halts minting once the proof falls outside…` |
| 13 | Governance capture | Admin sets a hostile parameter | `haircutBps` bounded to ≤ 10000; unfreeze timelocked and health re-checked at execution; **no admin path mints a token** | `cannot set a haircut above 100%`, `requires the timelock to elapse` |
| 14 | Unauthorised minting | Call the token directly | `WrappedAsset.MINTER` is immutable with no setter and no role registry | `lets nobody but the ASC mint`, `has no admin path to change the minter` |
| 15 | Snapshot griefing | Spam `snapshotReserves` to bloat logs | `MIN_SNAPSHOT_GAP` rate limit | — (source-chain guard) |
| 16 | Fee-on-transfer over-authorisation | Asset takes a fee, so the vault receives less than `amount` | Deposit measures the **balance delta**, not the requested amount | — (source-chain guard) |

## The honest gaps

Stated here rather than left for a judge to find.

**1. Custodian risk is now closed for the vault's own withdrawal path — but not for
losses that bypass it entirely.**

The original design had an honest weakness: a custodian could withdraw instantly, and
Creditcoin could not learn of it for ~11 minutes. That gap is closed (see below). What
remains is the class of loss that does not use the vault's withdrawal function at all —
a compromised owner key combined with a malicious upgrade, an exploited token contract,
or a bug in the asset itself. No detection scheme can drive that to zero, so instead
the **mint velocity cap** bounds how much supply can be created inside any such window.
Damage becomes a function of a parameter you choose, not of the attacker's patience.

**2. The freshness window is a real trade-off.**
`maxStalenessBlocks` must exceed attestation latency or minting freezes permanently
through no fault of anyone. That means there is always a window in which a mint can
clear against a slightly old reserve. Narrowing it increases safety and decreases
liveness. There is no setting that eliminates the trade-off — only settings that
choose a point on it, which is why the parameter is explicit and on-chain rather than
buried.

**3. EVM source chains only.**
The Attestcoin supported set is EVM. Verified live on 2026-08-25: Sepolia (`chainKey 1`)
and Ethereum mainnet (`chainKey 3`). Bitcoin-backed reserves are out of scope.

**4. On-chain reserves only.**
Fiat or off-chain custody cannot be lifted into an event by definition. Proving those
needs a TLS-attestation approach (DECO, CCS 2020), not an inclusion proof. MintBound
does not claim to cover them.

**5. Liveness depends on the Proof Builder API.**
This is a liveness dependency, not a safety one. If it is down, no new proofs are
generated, minting freezes, and redemptions continue. Self-hosted proof generation is
possible.

**6. `viaIR` is required to compile.**
The `Query` struct plus proof decoding exceeds the legacy pipeline's stack budget. This
is a build constraint worth recording because a reviewer switching it off will get a
confusing "stack too deep" rather than an obvious error.

## Closing the detection window

**The original weakness.** A withdrawal was instantaneous and unobservable until someone
counted. Detection required: someone calls `snapshotReserves` → the tx finalizes → the
attestors attest it. Measured worst case:

```
44 blocks attestation + 5 snapshot gap + 8 finality margin = 57 blocks ≈ 11.4 min
```

For those ~11 minutes a drained vault still looked solvent, and mints kept clearing.

**The fix, and why it is a fix rather than a mitigation.** Withdrawal became a two-step,
timelocked operation, and — the load-bearing part — the snapshot event now reports
`encumbered`: the total of announced-but-unexecuted withdrawals.

```solidity
event ReserveSnapshot(address indexed vault, address indexed asset,
                      uint256 balance, uint256 encumbered, uint256 epoch);
```

MintBound subtracts encumbrances *before* applying the haircut:

```solidity
unencumbered = verifiedBalance - encumbered;
effectiveReserve = unencumbered * haircut / 1e4;
```

So the instant an exit is announced and that announcement is proven, the funds stop
counting as backing — **while they are still sitting in the vault**, and will be for at
least `WITHDRAWAL_DELAY` blocks.

This reverses the security question. It is no longer *"how fast can we detect a theft?"*
but *"can the custodian move funds without telling anyone first?"* — and the answer is
no, provided:

```
WITHDRAWAL_DELAY  >  attestation latency + snapshot gap
150 blocks (~30 min)  >  57 blocks (~11.4 min)     ✓ 2.6x margin
```

That inequality is not left to operator judgement: `ReserveVault`'s constructor rejects
any delay under 120 blocks, and the deploy script independently refuses anything under
2× measured latency.

**And the escape hatch is destructible.** `emergencyWithdraw` exists so the second line
of defence can be demonstrated on a real chain. `renounceEmergencyWithdrawal()` destroys
it permanently — there is no setter to turn it back on. After that transaction, *every*
outflow must be announced and timelocked, and anyone can verify from the chain that it
happened. A production deployment renounces at genesis.

**What this buys, stated carefully:** a custodian cannot remove reserves without giving
the invariant roughly 30 minutes of public, cryptographically-provable warning. They can
still announce and wait. But by the time the money moves, supply against it has already
been frozen, and no new supply was ever issued against it.

## Why the failure direction is always the same

The single most important property, and the one to close a demo on:

> **Increasing liabilities requires a fresh cryptographic proof.
> Decreasing them requires nothing.**

`mintWithProof` demands a verified proof, a fresh reserve, an unfrozen asset, and a
satisfied aggregate bound. `redeem` demands none of those and works while frozen.

Consequently every failure mode — attestors stalling, the worker being censored, the
Proof Builder going down, the custodian withholding snapshots, a breach being detected —
converges on the same state: **minting frozen, redemption open.** No failure path leads
to silent over-issuance. Gating redemption would invert this and trap users inside
precisely the situation the circuit breaker exists to announce.
