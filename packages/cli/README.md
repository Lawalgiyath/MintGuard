# mintbound-cli

Check MintBound's solvency evidence yourself, against live chains.

```bash
npx mintbound-cli status
```

> **If `npx` reports the package is not found**, it has not been published yet.
> Everything above also runs straight from a clone, with no publish step:
> `git clone https://github.com/Lawalgiyath/MintGuard && cd MintGuard && npm install && npm run claims`

**No private key. No funded account. No setup.** The Attestcoin Proof Builder is a read
API, and the guard's entry points are reachable by `eth_call` — so every claim MintBound
makes can be checked by a stranger who has not been trusted with anything. That is the
point of the tool.

---

## Commands

### `claims`

Audits our own pitch. Every factual claim MintBound's submission makes, with the live
check that settles it — fetched now, from chains and explorers.

```
  right now: minting FROZEN  ·  proof 23741/200 blocks stale  ·  redemption always open

  ✓ No off-chain party has to be trusted for the reserve figure.
      trustedParties() == 0 — the figure came from the Block Prover precompile
  ✓ A proof past the staleness bound freezes minting, rather than being used anyway.
      proof is 23741 of 200 blocks stale, and minting is frozen — the gate bit
  ✓ mintWithProof costs about 382,578 gas including proof verification and the invariant.
      the real receipt reports 382578 gas

  11/11 claims verified against live state.
```

Exits non-zero when any claim fails. That matters: a self-audit that cannot return FAIL
is marketing in a monospace font.

The first draft of this command omitted freshness and reported 10/10 while the deployment
was frozen on a stale proof — which is precisely the bias a self-audit exists to remove.
The freshness claim was added, and it checks the safety property rather than the
convenient one: not *“minting works right now”* but *“a proof past the bound freezes
minting rather than being used anyway.”*

### `status`

The whole balance sheet, read live from Creditcoin CC3 and Ethereum Sepolia.

```
Balance sheet
────────────────────────────────────────────────────────────────────
  proven reserve        1,025,000 @ source height 11570929
  announced exits       - 0 (encumbered, no longer counts)
  haircut               x 100.00%
  effective backing     = 1,025,000
  outstanding supply    25,000 wmTUSD
  headroom to bound     1,000,000

Assurance  90/100
────────────────────────────────────────────────────────────────────
  ✓ Reserve evidence       25  cryptographic — no reporter in the mint path
  ✓ Proof freshness        20  21 of 200 blocks stale
  ✓ Liability coverage     20  single-chain deployment
  ✓ Encumbrance margin     15  150 block delay vs 40 block detection (3.8x margin)
  ✗ Interval continuity    10  no bonded continuity claim covers the current interval
  ✓ Mint authority         10  emergency withdrawal irreversibly renounced
```

`--json` for machine-readable output.

**On the Assurance number:** it is a presentation-layer aggregation over six
independently checkable obligations, with weights published in
[`src/assurance.ts`](src/assurance.ts). No contract reads it and no mint is gated on it —
enforcement on-chain is binary. It exists so a human can see which parts of the solvency
argument are currently carried by cryptography and which by an assumption. If you
disagree with a weight, the full vector is printed alongside the total so you can
reweight it yourself.

### `verify --source-tx <hash>`

Walk one source-chain transaction through the entire evidence pipeline and report what
the precompile makes of it.

```
[1/4] Fetching source receipt ✓ block 11570611, 1 logs
    event found         ReserveSnapshot
    routes to           submitReserveSnapshot()
[2/4] Checking attestation via ChainInfo precompile 0x0FD3 ✓ height 11570611 attested
[3/4] Building Merkle + continuity proof ✓ 9 Merkle siblings, 90 continuity roots
[4/4] Calling submitReserveSnapshot() on CC3 (eth_call, no transaction sent)
      ✓ proof is valid but already spent
```

The entry point is chosen from the log signatures actually present in the receipt, not
from a flag you pass. A transaction carrying neither `ReserveSnapshot` nor `Locked` is
rejected — correctly, since an arbitrary transaction must not be able to move the bound.

### `attack`

Fire the documented attacks at the live guard. Every one is expected to revert, and the
reverts are the product.

```
  6/6 blocked — 5 by the Block Prover precompile, 1 by the guard before it got that far
```

**What this proves, exactly:** each attempt carries forged proof material, so each is
rejected before MintBoundASC's own logic runs. There is no path around the precompile.
It does **not** exercise the guard's internal rejections — emitter binding, event
matching, replay — because those need a *valid* proof carrying malicious contents, which
cannot be forged against live CC3 by construction. Those are covered in
`packages/contracts/test/MintBound.test.ts` against a mock verifier.

---

## Configuration

Everything has a working default pointed at the live deployment. Override via env:

| Variable | Default |
|---|---|
| `CREDITCOIN_RPC_URL` | `https://rpc.cc3-testnet.creditcoin.network` |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |
| `PROOF_BUILDER_URL` | `https://proof-gen-api.cc3-testnet.creditcoin.network` |

Run from inside the repo and `deployments/*.json` is picked up automatically, so a fresh
redeploy needs no edit here.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Solvent and fresh / proof valid / all attacks blocked |
| 1 | Minting frozen / proof rejected / an attack succeeded |
| 2 | Usage error |

Suitable for CI: `npx mintbound-cli status` failing is a real signal.
