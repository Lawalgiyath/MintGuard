# Evidence

Every security claim MintBound makes, the attack it answers, and where you can check it.

The organising principle: **a claim you cannot check is a claim you should discount.**
Each row below names an executable artifact — a test, a live command, or a transaction
hash — so that nothing here rests on our say-so.

---

## How to check any of it yourself

No key, no funded account, no clone required:

```bash
npx mintbound-cli status     # the live balance sheet and assurance vector
npx mintbound-cli attack     # fire the documented attacks at the live guard
npx mintbound-cli verify --source-tx 0x...   # walk one transaction through the precompile
```

> **If `npx` reports the package is not found**, it has not been published yet.
> Everything above also runs straight from a clone, with no publish step:
> `git clone https://github.com/Lawalgiyath/MintGuard && cd MintGuard && npm install && npm run claims`

These work because the Proof Builder is a read API and the guard's entry points are
reachable by `eth_call`. Verification is a spectator sport here by design.

From a clone:

```bash
npm run test:contracts      # 126 unit tests
npm run test:invariant      # 7 invariants under randomised fuzzing
npm run verify:live         # 13 checks against live CC3 infrastructure
npm run verify:source       # republish source for every deployed contract
```

`verify:source` recovers constructor arguments **from the deployed contracts
themselves** rather than from the deploy script, so a verification that passes is
evidence about what is actually on chain, not about what we believe we deployed.

---

## The matrix

| # | Attack | Conventional PoR | MintBound | Where it is proven |
|---|---|---|---|---|
| 1 | **Fabricated reserve figure** — attacker reports a balance that does not exist | Accepts it. The reported number *is* the evidence. | Rejected. The figure must come with a Merkle inclusion proof the Block Prover precompile verifies. | Live: `attack` case 1. Unit: `MintBound.test.ts` |
| 2 | **Counterfeit vault** — a look-alike contract emits an identical `ReserveSnapshot` | No notion of a canonical emitter | Rejected. `_findVaultLog` scans for the canonical emitter rather than trusting `logs[0]`. | Unit: emitter-binding tests. Live: `attack` case 2 (stopped earlier, at the proof layer) |
| 3 | **Reverted source transaction** — prove a transaction that failed | Not modelled | Rejected. Receipt status is part of what is checked. | Unit + live `attack` case 3 |
| 4 | **Wrong source chain** — supply a proof from a chain the guard does not watch | Not modelled | Rejected with `WrongChainKey(3, 1)`, before any proof work — the key is pinned at construction. | Live: `attack` case 4 |
| 5 | **Replay** — resubmit a valid, already-spent proof | Not modelled | Rejected. `processedQueries` / `consumedLocks`. Visible live: `verify` on a spent snapshot returns *valid but already spent*. | Unit + live `verify` |
| 6 | **Stale proof** — reserve moved after the last attestation | Accepted silently. This is the Cashio-shaped failure. | Rejected. Freshness is read on-chain from ChainInfo precompile `0x0FD3`, so no off-chain party can lie about it. | Unit: staleness tests. Live: `status` freshness block |
| 7 | **Sneak withdrawal** — drain the vault inside the detection window | Invisible until the next report | Cannot happen. Withdrawals are announced and timelocked; announcement de-rates the ceiling immediately, and $\Delta \ge 2\Lambda$ is enforced at construction. | Unit: encumbrance tests. Invariant I3, I4. Live: `status` encumbrance margin |
| 8 | **Cross-chain oversupply** — mint on chain B, count reserves only against chain A | Blind. Reserve looks sufficient because half the liabilities are invisible. | The bound sums liabilities across every registered chain via `SupplyBeacon`. | Unit: cross-chain tests. Invariant I1 |
| 9 | **Silent chain** — a registered chain stops reporting | Not modelled | Minting freezes. Unknown liability is not treated as zero liability. | Unit: `RemoteSupplyMissing` |
| 10 | **Operator rug** — custodian moves the reserve unilaterally | Out of scope | Emergency withdrawal irreversibly renounced on the live deployment. `emergencyEnabled() == false`, permanently. | Live: tx `0xd014b95a…7c6b382` |
| 11 | **Infinite mint** — mint beyond any backing | Depends entirely on the feed | Rejected by the aggregate bound, evaluated in the minting transaction. | Invariant I1, I2 |
| 12 | **Minter takeover** — change who can mint | N/A | Impossible. `WrappedAsset.minter` is immutable. | Invariant I6 |

---

## Where each attack is stopped

Every live attack carries forged proof material. Five are rejected by the Block Prover
precompile; the sixth is rejected by the guard's chain-key pin before the precompile is
even reached. **There is no path around the precompile.**

The guard's internal rejections — emitter binding, event matching, replay protection —
are exercised in `test/MintBound.test.ts` against a mock verifier, where a valid proof
carrying malicious contents can be constructed.

---

## Measured, not estimated

Gas figures from the live CC3 deployment:

| Operation | Gas |
|---|---|
| `submitReserveSnapshot` | 368,592 / 364,112 |
| `mintWithProof` | 382,578 |
| `deposit` (Sepolia) | 56,908 |

Under 400k for cross-chain proof verification plus the full aggregate invariant plus the
mint itself.

## Test surface

| Suite | Count | What it covers |
|---|---|---|
| Unit (`mocha`) | 113 | Business logic, rejection paths, Chainlink compatibility, evidence grading, composability, and the source-chain contracts |
| Invariant (forge-std under Hardhat 3) | 7 × 256 runs | The propositions in [INVARIANTS.md](INVARIANTS.md), under randomised call sequences |
| Live infrastructure | 13 | Real CC3 precompiles, Proof Builder, attestation, deployed contract state |
| Live attacks | 6 | Real `eth_call`s against the deployed guard |

Run coverage with `npm run coverage`.

### Coverage

`npm run coverage`. Line coverage is **84.9%** overall, with the contracts carrying the
six mechanisms covered as follows:

| Contract | Line coverage |
|---|---|
| `SupplyBeacon.sol` | 100.00% |
| `ProvenReserveFeed.sol` | 100.00% |
| `MintBoundASC.sol` | 90.83% |
| `SolvencyContinuity.sol` | 88.78% |
| `ReserveVault.sol` | 81.94% |

---

## Deployed addresses

All ten contracts have **published, verified source**. Clicking any address below
lands on readable Solidity, not bytecode — which matters more here than for most
projects, because every claim this system makes is only checkable if the code behind
the address can be read.

**Creditcoin CC3 testnet** (chainId 102031) — verified on Blockscout

| Contract | Address |
|---|---|
| MintBoundASC | `0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8` |
| WrappedAsset | `0x1f42B80ebac56AF3f023997A4240D3B97476A557` |
| ProvenReserveFeed | `0x5578784ddE6c05c0370119FF68c439847CB307D7` |
| ConventionalPoRFeed | `0xbAceA461241F5D9D27e2308D279AB1add95B226F` |
| SecureMintReference | `0x8f2A246623b000DE0486242f8806b0dDeF2375b9` |
| SolvencyGatedCredit | `0x44082286d90ebB087F34EE4Bc6Bd918B205d7156` |
| SolvencyContinuity | `0x448292774b807B49025002e256d004378f788d07` |

**Ethereum Sepolia** — verified on Sourcify

| Contract | Address |
|---|---|
| TestUSD | `0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8` |
| ReserveVault | `0x1f42B80ebac56AF3f023997A4240D3B97476A557` |
| SupplyBeacon | `0x448292774b807B49025002e256d004378f788d07` |

**Key transactions**

| What | Hash |
|---|---|
| Reserve proven (1,000,000 mTUSD @ Sepolia 11570659) | `0xc42a211e02ee86e5d92bb0bee2cef1679fbd358e474a044bdfe1e7ff7c9efa9c` |
| Mint against proof | `0xb5a9c959d5fcadad2608e6c0e0e444cc9854489706e96f0f1ee495ba33f70d56` |
| Emergency withdrawal renounced (irreversible) | `0xd014b95a86a2c25efca8459468544a5b4aebda6cc3051f217e0aa10f47c6b382` |
