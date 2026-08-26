# Privacy — the analysis, not the excuse

*Why MintBound publishes reserve amounts in cleartext, and what that does and does not
cost.*

---

## The challenge

One submission in this field (Emberline) keeps sensitive evidence private while still
proving a quorum. MintBound publishes everything: exact reserve balances, encumbrances,
per-chain supply, permanently, in cleartext. That looks like a straight loss — and it is
sharpened by the fact that we cite **Provisions (CCS 2015)**, which is explicitly a
*privacy-preserving* proof of solvency, as our foundation.

So it deserves a real answer rather than a shrug.

## Three different questions get called "privacy"

### 1. The reserve amount — already public, so hiding it is theatre

MintBound's reserves are ERC-20 balances held by a known contract on a public chain.
**Anyone with an RPC endpoint can read them right now**, with no permission and no
cooperation from us:

```
eth_call → balanceOf(vault)     // returns the balance, to anyone, always
```

Verified against live Sepolia. This is not a MintBound property; it is what a public
blockchain *is*.

So encrypting that number before handing it to Creditcoin would conceal nothing. The
plaintext is already sitting on the source chain, queryable, forever. A commitment scheme
over a public value buys confidentiality against exactly nobody, and would cost gas,
complexity and auditability to achieve it.

**We are not choosing to publish a secret. We are declining to pretend a public number is
a secret.**

### 2. Which address holds the reserve — a deliberate trade, and the interesting one

This is the privacy question Provisions actually addresses: proving control of assets
*without revealing which addresses you control*.

MintBound gives that up on purpose, and the reason is load-bearing.
`CANONICAL_VAULT` is pinned immutably at construction, and every proof is bound to it:

```solidity
if (logs[i].address_ == CANONICAL_VAULT && ...) return logs[i];
```

Without that binding, anyone can deploy a contract that emits a byte-identical
`ReserveSnapshot` claiming any balance, get it into a real Sepolia block, and produce a
completely valid inclusion proof. The counterfeit-vault attack is the single most likely
exploit in this design, and emitter binding is what closes it.

**You cannot simultaneously have "anyone can verify the emitter is legitimate" and
"nobody knows which address the emitter is."** Those are the same bit of information.
Provisions can hide addresses because it proves control by *signature*; MintBound proves
facts by *inclusion*, and inclusion proofs are bound to an emitter by construction.

That is a genuine trade-off with a stated reason — verifiability over anonymity — not an
oversight.

### 3. Per-user liabilities — out of scope, and correctly so

Provisions' companion problem, extended by **Ji & Chalkias, *Generalized Proof of
Liabilities*, CCS 2021**, is proving what an exchange owes *without publishing every
customer's balance*. That is where DAPOL+ and Merkle sum trees earn their keep.

It does not apply here. MintBound's liability is the `totalSupply` of an ERC-20. There
are no per-user balances to protect, because the liability is a single public number by
construction. Implementing DAPOL+ against a token supply would be machinery with nothing
to hide.

## Where privacy genuinely would matter — and what it would take

There is exactly one tier where the amount is **not** already public: the
oracle-reported tier, covering assets an inclusion proof cannot reach — fiat in a bank
account, bullion in a vault. There the balance is a genuine secret, and a confidential
construction would buy something real.

The building blocks exist on Creditcoin. Verified live against CC3 testnet:

| Precompile | Address | Status |
|---|---|---|
| Bn128Add | `0x06` | **available** |
| Bn128Mul | `0x07` | **available** |
| Bn128Pairing | `0x08` | documented for mainnet + testnet |

So Pedersen commitments over bn128 are cheap and practical here. An issuer could publish
`C = g^balance · h^blinding` instead of the balance, and commitments would add
homomorphically across multiple custody accounts — Provisions' proof-of-assets structure,
directly.

**What stops it being a weekend's work is the comparison.** The invariant is not "what is
the reserve" but "is the reserve at least the supply". Proving `reserve − supply ≥ 0`
about a committed value requires a **range proof** — Bulletproofs or equivalent. That is
real cryptography with real gas cost, real audit surface, and real risk of being subtly
wrong. Shipping a range proof we could not confidently audit would be worse than shipping
none.

**Honest status: designed, scoped, not implemented.** It is the correct next piece of
work for the oracle tier and it is named as roadmap rather than claimed as done.

## The summary a judge should hear

> For on-chain reserves, privacy is not something MintBound gives up — the balance is
> already public on the source chain, and the vault address must be public for the proof
> to mean anything at all. The privacy that would matter applies to off-chain reserves,
> where the amount really is secret; the bn128 precompiles Creditcoin already exposes
> make Pedersen commitments practical there, and the blocker is the range proof, which we
> have scoped and not built.
>
> Emberline's privacy protects off-chain delivery documents. Ours would protect off-chain
> reserve amounts. Those are different data classes, and on the class MintBound actually
> handles, there is nothing to hide that is not already visible.
