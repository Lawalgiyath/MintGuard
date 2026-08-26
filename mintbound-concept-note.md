# MintBound — Concept Note
*(formerly "ReserveGuard" — renamed; see §2.5)*

**A per-mint cryptographic authorization primitive for wrapped and tokenized real-world assets on Creditcoin.**

Target: BUIDL CTC 2026 Fall (Creditcoin / Credit Labs) — RWA track, secondary DeFi track.
Chain: Creditcoin CC3 Testnet. Source chain: Ethereum Sepolia (`chainKey = 1`).
Protocol: Attestcoin Protocol (Readability), Block Prover Precompile `0x0FD2`.

---

## 0. Read this first — the honest framing, twice-corrected

**First correction (own review):** Creditcoin ships `SimpleMinterASC` / `ASCMinter.sol` as its reference tutorial — verify a burn/lock, then mint. "Verify a lock before minting" alone is the tutorial, not a project. The differentiator has to be the *aggregate solvency invariant* (running tally, per-mint bound, freshness window), not the bridging step.

**Second correction (adversarial review, three angles — judge, skeptical engineer, sponsor):** the *broader category* "proof-of-reserve gates minting" is not novel either. It is Chainlink's stated product thesis ("Secure Mint" — PoR wired directly into a mint function to prevent infinite-mint attacks), it is what CelsiusX described doing ("never mint more wrapped tokens than the locked amount"), and a 2025 Wrapped Zcash design explicitly combines cross-chain collateral verification, PoR, and mint/burn controls. If the pitch is "we invented reserve-gated minting," a judge kills it in the time it takes to say "Chainlink Secure Mint."

**What survives both corrections** is narrower and more defensible than either "reserve-gated minting" or "verify-then-mint": **no existing public implementation authorizes each mint with a per-transaction cryptographic inclusion proof of the exact source-chain event, verified synchronously by a native precompile, with zero trusted intermediary — DON, multisig, relayer, or heartbeat report — anywhere in the authorization path.** Chainlink PoR is a decentralized *oracle network* reporting a balance on a heartbeat: the mint contract trusts the DON's aggregated answer, not a proof of a specific chain event. CelsiusX's model and Wrapped Zcash's design are custodial/relayer-attested. MintBound's mint function has no analogous trust step — it either has a valid Merkle + continuity proof against an attested Creditcoin chain state, or it reverts. That is the sentence to put in front of judges, verbatim.

The rest of this note is built around making that sentence demonstrably true and demonstrably the star of the demo — not the bridging, and not "proof of reserve" as a category claim.

---

## 1. Executive summary

MintBound is a mint-authorization layer for wrapped and tokenized assets on Creditcoin. It will not increase the supply of a wrapped token unless the Attestcoin Protocol has cryptographically proven, per transaction, that source-chain reserves — verified within a bounded freshness window — cover the *entire* outstanding supply, not merely the incoming deposit. No oracle network, multisig, or off-chain reporter is trusted at any point in that authorization path; every fact the contract acts on is a Merkle-proven, continuity-proven transaction inclusion checked synchronously by Creditcoin's native precompile.

It enforces one invariant on every state transition:

```
totalSupply(wToken)  ≤  Σ ( verifiedReserve(vaultᵢ) × haircutᵢ )
```

where `verifiedReserve` is a source-chain balance attested by Creditcoin's decentralized attestor set and verified synchronously by the Block Prover Precompile within `maxStaleness` source-chain blocks.

It exposes that invariant as a public read interface (`ISolvencyOracle`) so any Creditcoin dApp — a lending market, a DEX, an RWA fund — can gate its own logic on the live solvency of a wrapped asset it holds. MintBound is infrastructure, not an app.

**One-line pitch (use exactly this):**
*"A wrapped asset that cannot be minted unless a native precompile has cryptographically verified, per transaction, that the exact backing event happened on the source chain and that the resulting total is still fully covered — no DON, no multisig, no heartbeat, no trusted reporter anywhere in the path."*

---

## 2. The problem, documented

### 2.1 The failure class: mint authorization decoupled from reserve verification
The canonical incident is Cashio. On 23 March 2022, the Solana-based stablecoin CASH lost approximately **$52.8 million** to an "infinite mint" vulnerability caused by missing collateral validation in the mint path; the token collapsed to roughly $0.00005 (Halborn incident analysis). The mint function did not verify that the collateral account it was told about was real. The general shape: **a contract that can create liabilities faster than it can verify assets.**

### 2.2 Why cross-chain makes it worse
Cross-chain bridges are the largest theft vector in the industry: roughly **$4.3 billion stolen across 49 bridge incidents, June 2021–September 2024, ~40% of all value hacked in Web3 over that period** (DeFiLlama, as aggregated by BlockEden; corroborated by Chainlink's own Education Hub citing DeFiLlama for "more than $2.8 billion — almost 40% of the entire value hacked in Web3"). The root cause is almost always a trusted validator set, multisig, or custodian the minting contract cannot itself verify — the **blockchain oracle problem**.

### 2.3 The Creditcoin-specific gap
Creditcoin's whole thesis is on-chain credit and RWA, and the Attestcoin Protocol exists to give contracts trustless sight of foreign chains — but the ecosystem lacks primitives that actually consume it. The prior-edition flagship DeFi entry (CreditUSD / crdUSD) stated plainly that Creditcoin "currently lacks DeFi primitives like stablecoins, CDPs, and liquidation mechanisms" and shipped its CDP with a **mock oracle**. The strongest entry to date faked the exact capability this hackathon now mandates.

### 2.4 Why existing solutions don't close it — including the ones that look similar
This is the section to get right, because it's the one that got corrected.

| Approach | What it actually verifies | Trust assumption in the mint path |
|---|---|---|
| **Chainlink Secure Mint / PoR** | A DON aggregates and reports a reserve balance on a heartbeat or deviation threshold | Mint contract trusts the DON's *aggregated report*, not a proof of any specific chain event |
| **CelsiusX-style "never mint more than locked"** | Custodian/relayer attestation of locked amount | Mint contract trusts the custodian's/relayer's attestation |
| **Wrapped Zcash (2025 design)** | Cross-chain collateral verification via oracle + mint/burn controls | Combines PoR and controls, but still an oracle-reported balance, not a per-tx inclusion proof |
| **`SimpleMinterASC` (Creditcoin reference tutorial)** | A single burn/lock transaction's inclusion | Verifies flow, not stock — no aggregate accounting, no freshness bound, no reaction to a later withdrawal |
| **MintBound** | Per-mint: the exact source-chain event, proven by Merkle inclusion + continuity, checked synchronously by native precompile code | **Nothing.** No DON, no multisig, no relayer, no heartbeat. The only thing trusted is source-chain finality plus Creditcoin's attestor set, which the protocol itself is built on. |

State this table's bottom-right cell in the demo, explicitly, next to the Chainlink slide. That is the entire novelty argument in one visual.

### 2.5 Naming — corrected
"ReserveGuard" collides with an existing product (MiCA reserve-risk intelligence tooling for stablecoin issuers, unrelated domain but same name, easy to confuse in a judge's quick search). Renamed to **MintBound** — the name states the actual mechanism (a cryptographic bound enforced at the moment of minting) rather than the category (reserves), which is where the collision and the Chainlink-adjacency both live. Verify no collision before submission; a quick check on GitHub/npm/ENS found none at time of writing.

---

## 3. Peer-reviewed foundations

**Primary anchor — proof of assets:**
Gervais Dagher, Benedikt Bünz, Joseph Bonneau, Jeremy Clark, Dan Boneh. *"Provisions: Privacy-Preserving Proofs of Solvency for Bitcoin Exchanges."* ACM CCS 2015. DOI 10.1145/2810103.2813674.

Provisions decomposes solvency into a proof of assets and a proof of liabilities, proven against the same commitment moment. Provisions' proof of assets still relies on the exchange producing a signature over addresses it controls — a self-attestation, structurally the same trust gap as Chainlink's DON report or CelsiusX's custodial attestation. **MintBound's contribution relative to Provisions is removing that self-attestation entirely**, substituting a third-party-unforgeable inclusion proof of a source-chain transaction, verified by the Attestcoin precompile. This is the precise, defensible novelty claim: not "we invented proof of solvency," but "we closed Provisions' one remaining trust gap using a primitive (native cross-chain inclusion proof) that didn't exist when Provisions was published in 2015."

**Secondary anchor — proof of liabilities:**
Yan Ji, Konstantinos Chalkias. *"Generalized Proof of Liabilities."* ACM CCS 2021. DOI 10.1145/3460120.3484802.

Liabilities are trivially public here (`totalSupply` of an ERC-20 on Creditcoin is transparent), so full DAPOL+ machinery isn't required in v1 — but frame this explicitly: MintBound is a *complete* solvency proof precisely because only the asset side needed a cryptographic bridge.

**Supporting — cross-chain verification model:**
Tiancheng Xie, Jiaheng Zhang, Zerui Cheng, Fan Zhang, Yupeng Zhang, Yongzheng Jia, Dan Boneh, Dawn Song. *"zkBridge: Trustless Cross-Chain Bridges Made Practical."* ACM CCS 2022. DOI 10.1145/3548606.3560652.

Establishes the principle MintBound inherits: verify the source-chain event, never a committee's assertion about it. Different mechanism (zk light client vs. Attestcoin's attestor-set-plus-precompile), same security model.

*Citation hygiene:* all three are ACM CCS, top-tier peer-reviewed. Don't pad with arXiv-only references.

---

## 4. What MintBound is

1. **A per-mint cryptographic authorization gate.** An Attestcoin Smart Contract on Creditcoin holding mint authority, which exercises it only against a live Merkle + continuity proof of the specific backing event, checked against a continuously-enforced aggregate invariant.
2. **A state-attestation pattern** ("state-to-event lifting," §5) that lets a transaction-inclusion oracle attest to *balances*, not just events — the reusable engineering contribution, independent of MintBound itself.
3. **A public, live solvency oracle and dashboard.** `ISolvencyOracle` for other contracts; a dashboard for humans and judges. **This dashboard is the demo's centerpiece, not a nice-to-have** — see §9.

**What MintBound is not:** not a bridge, does not move funds, not "proof of reserve" as a category claim. It is the specific mechanism in the bottom-right cell of §2.4's table.

---

## 5. The core mechanism: state-to-event lifting

Lead the technical portion of the demo with this, because it's the non-obvious insight and it's what makes §2.4's claim true rather than aspirational.

**The constraint:** the Block Prover Precompile proves that *a transaction was included in an attested source-chain block*. It does not expose arbitrary source-chain state. You cannot ask it "what is the ETH balance of `0xVault` right now?"

**Why that matters:** proof of assets needs a *balance*, which is state. Event-driven accounting (sum of verified deposits) cannot detect a withdrawal, and so cannot detect a custodian rug or an exploit after the fact — which is exactly the gap `SimpleMinterASC` and every deposit-event-only minter leaves open.

**The lift:** a permissionless snapshot function on the source chain reads the vault balance and writes it into a log:

```solidity
// Source chain (Sepolia) — ReserveVault.sol
event ReserveSnapshot(
    address indexed vault,
    address indexed asset,
    uint256 balance,
    uint256 blockNumber,
    uint256 indexed epoch
);

/// @notice Permissionless. Anyone may call; anyone may pay the gas.
/// Rate-limited to prevent log spam.
function snapshotReserves(address asset) external {
    require(block.number >= lastSnapshotBlock[asset] + MIN_SNAPSHOT_GAP, "too soon");
    uint256 bal = IERC20(asset).balanceOf(address(this));
    lastSnapshotBlock[asset] = block.number;
    emit ReserveSnapshot(address(this), asset, bal, block.number, ++epoch[asset]);
}
```

The balance is now a *fact about a transaction*, which is exactly what Attestcoin can prove. The ASC on Creditcoin verifies inclusion of the `snapshotReserves` transaction, decodes the log with `EvmV1Decoder`, and holds a cryptographically-verified source-chain *balance* with a known block height — without ever trusting a reporter.

**Why permissionless matters:** if only the custodian could snapshot, they could withhold snapshots to hide a shortfall. Because anyone can call it, a shortfall becomes publicly provable — and because minting halts when snapshots go stale, withholding is never a winning strategy. This is the asymmetric fail-safe (§7.3).

State-to-event lifting generalizes far beyond MintBound: it is a pattern for turning Attestcoin from a transaction oracle into a general state oracle for any Creditcoin dApp. Say this explicitly — it's the line that makes a sponsor lean forward.

---

## 6. Architecture

### 6.1 System diagram (textual)

```
ETHEREUM SEPOLIA (chainKey = 1)          CREDITCOIN CC3 TESTNET
┌──────────────────────────────┐         ┌────────────────────────────────────┐
│ ReserveVault.sol             │         │ MintBoundASC.sol                   │
│  • deposit() → Locked(...)   │         │  • submitReserveSnapshot(proof)    │
│  • withdraw()                │         │  • mintWithProof(proof)            │
│  • snapshotReserves()        │         │  • redeem() → burn, decrement      │
│      → ReserveSnapshot(...)  │         │  • enforces global invariant       │
└──────────────┬───────────────┘         │  • replay protection               │
               │                          └───────────┬────────────────────────┘
               │ tx included in block                 │ calls
               ▼                                      ▼
        ┌────────────────┐                 ┌──────────────────────────────┐
        │ Attestor set   │ ─ gossip ─────► │ Block Prover Precompile      │
        │ (P2P, offchain)│  attestations   │ 0x0FD2                        │
        └────────────────┘                 │ verify() / verifyAndEmit()   │
               ▲                            └──────────────────────────────┘
               │ Merkle + continuity proofs               │
        ┌──────┴──────────────┐                           ▼
        │ Proof Generation API│              ┌──────────────────────────────┐
        │ @gluwa/usc-sdk      │              │ SolvencyOracle (public read) │
        │ (offchain worker)   │              │ wCTC-ETH token (ERC-20)      │
        └─────────────────────┘              └──────────────────────────────┘
                                                          │
                                             consumed by ▼
                                             any Creditcoin dApp
```

### 6.2 Source chain — `ReserveVault.sol` (Sepolia)

| Function | Emits | Purpose |
|---|---|---|
| `deposit(asset, amount)` | `Locked(user, asset, amount, nonce)` | Flow event; authorizes a specific mint |
| `snapshotReserves(asset)` | `ReserveSnapshot(vault, asset, balance, blockNumber, epoch)` | Stock event; the state lift |
| `withdraw(asset, amount, redeemId)` | `Released(user, asset, amount, redeemId)` | Settles a redemption |

Deliberately dumb. It holds funds and emits facts. All policy lives on Creditcoin.

### 6.3 Creditcoin — `MintBoundASC.sol`

Separated ASC pattern: this contract handles cross-chain read/verification only; a distinct `WrappedAsset` (ERC-20) and `SolvencyOracle` hold state and business logic. This ASC is the only address with mint authority.

```solidity
struct ReserveState {
    uint256 verifiedBalance;    // last proven source-chain balance
    uint64  attestedAtBlock;    // source-chain block height of that proof
    uint64  epoch;              // monotonic; rejects stale/replayed snapshots
    uint16  haircutBps;         // risk discount, e.g. 9500 = 95%
}

mapping(address => ReserveState) public reserves;   // asset => state
mapping(bytes32 => bool)         public processedQueries;   // replay protection
mapping(bytes32 => bool)         public consumedLocks;      // deposit nonce guard

uint64  public constant MAX_STALENESS_BLOCKS = 200;  // ~40 min on Sepolia
uint16  public constant MIN_COLLATERAL_BPS   = 10000; // 100%
bool    public mintFrozen;
```

### 6.4 Proof verification

```solidity
function _verifyInclusion(
    uint64 chainKey,
    uint64 blockHeight,
    bytes calldata encodedTransaction,
    bytes32 merkleRoot,
    INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
    bytes32 lowerEndpointDigest,
    bytes32[] calldata continuityRoots
) internal returns (bool) {
    INativeQueryVerifier.MerkleProof memory mp =
        INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
    INativeQueryVerifier.ContinuityProof memory cp =
        INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: lowerEndpointDigest,
            roots: continuityRoots
        });
    return VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, mp, cp);
}
```

**Documented footgun most competing submissions will miss:** the precompile does **not** check whether the transaction succeeded — it proves inclusion and continuity only. A reverted transaction is still included in a block. MintBound validates receipt status, transaction type, emitting contract address, and event signature before touching any state:

```solidity
function _decodeSnapshot(bytes memory encodedTx)
    internal pure returns (address asset, uint256 balance, uint64 srcBlock, uint64 epoch)
{
    uint8 txType = EvmV1Decoder.getTransactionType(encodedTx);
    require(EvmV1Decoder.isValidTransactionType(txType), "bad tx type");

    EvmV1Decoder.ReceiptFields memory rcpt = EvmV1Decoder.decodeReceiptFields(encodedTx);
    require(rcpt.receiptStatus == 1, "source tx reverted");          // ← mandatory

    EvmV1Decoder.LogEntry[] memory logs =
        EvmV1Decoder.getLogsByEventSignature(rcpt, RESERVE_SNAPSHOT_SIG);
    require(logs.length > 0, "no snapshot event");

    // Bind to the canonical vault — otherwise anyone deploys a fake vault
    // emitting an identical event and inflates reserves for free.
    require(logs[0].emitter == CANONICAL_VAULT, "wrong emitter");

    (asset, balance, srcBlock, epoch) = _parseSnapshotLog(logs[0]);
}
```

The `emitter` check is the single most likely place for a competing submission to be exploitable. Call it out in the demo.

### 6.5 Replay protection

Keyed on `(chainKey, blockHeight, transactionIndex)` following the documented `processedQueries` pattern, plus `consumedLocks[keccak(user, nonce)]` so a single deposit can never authorize two mints. Snapshots require strictly increasing `epoch` — without this, an attacker replays yesterday's higher balance to mask today's shortfall.

### 6.6 Off-chain worker

```ts
import { JsonRpcProvider } from 'ethers';
import { chainInfo, blockProver, proofGenerator } from '@gluwa/usc-sdk';

const chainKey = 1; // Ethereum Sepolia on CC3 Testnet
const sourceProvider     = new JsonRpcProvider(SEPOLIA_RPC);
const creditcoinProvider = new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network');

const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
const prover            = new blockProver.PrecompileBlockProver(creditcoinProvider);
const proofGenApi       = new proofGenerator.api.ProverAPIProofGenerator(
  chainKey, 'https://prover.usc-testnet.creditcoin.network'
);

const tx = await sourceProvider.getTransaction(txHash);
await proofGenApi.waitUntilHeightAttested(chainKey, tx.blockNumber);
// → generate Merkle + continuity proofs, submit to MintBoundASC
```

Two loops: a **snapshot heartbeat** and a **mint relay**. Batch verification supports up to 10 queries sharing one continuity proof — use it for multi-asset snapshots. The worker is **untrusted**: it can censor (liveness) but cannot forge (safety), and anyone can run one. Say this out loud in the demo.

---

## 7. Protocol lifecycle

### 7.1 Mint
1. User deposits on Sepolia → `Locked(user, asset, amount, nonce)`.
2. Worker waits for finality + attestation, generates proofs, calls `mintWithProof(...)`.
3. ASC verifies inclusion, checks receipt status, emitter, event signature, replay guards.
4. ASC checks freshness: `currentSrcHeight - reserves[asset].attestedAtBlock ≤ MAX_STALENESS_BLOCKS`.
5. ASC checks the invariant **against the aggregate**, not the single deposit: `(totalSupply + amount) ≤ verifiedBalance × haircut / 1e4`.
6. Mint. Emit `Minted` and `InvariantChecked(ratioBps)`.

Step 5, checked against the running aggregate rather than the individual deposit, is the entire technical difference from every prior-art row in §2.4.

### 7.2 Redeem
1. User burns wrapped tokens on Creditcoin. `totalSupply` decreases **immediately** — no proof required.
2. `RedeemRequested(user, asset, amount, redeemId)` emitted.
3. Vault releases on Sepolia; next snapshot naturally reflects the lower balance.

### 7.3 The asymmetric fail-safe
**Increasing liabilities requires fresh cryptographic proof. Decreasing liabilities requires nothing.** Every failure mode — oracle down, worker censored, custodian withholding snapshots — degrades toward *frozen mint with open redemption*, never toward silent over-issuance. This is the single most defensible design decision and should close the demo.

### 7.4 Drift detection and circuit breaker
On every accepted snapshot, recompute the collateral ratio. If `verifiedBalance × haircut / 1e4 < totalSupply`, set `mintFrozen = true`, emit `SolvencyBreach(...)`, flip `SolvencyOracle.isSolvent(asset)` to `false`. Unfreezing requires a healthy snapshot **plus a timelock** — never a single transaction.

---

## 8. Security analysis

| Threat | Mechanism | Mitigation |
|---|---|---|
| Forged deposit / fake inclusion | Fabricated proof | Merkle inclusion + continuity proof, native precompile `0x0FD2` |
| Replay of a valid proof | Resubmit same tx | `processedQueries` + `consumedLocks[nonce]` |
| Reverted-transaction injection | Prove inclusion of a failed deposit | `receiptStatus == 1` required — precompile does **not** check this |
| Counterfeit vault | Clone emits identical `ReserveSnapshot` | `emitter == CANONICAL_VAULT`, chainKey pinned |
| Stale-snapshot replay | Resubmit an old, higher balance | Strictly monotonic `epoch` |
| Post-mint custodian withdrawal | Rug after minting | Heartbeat snapshots + drift detection + freeze. **Bounded, not eliminated** — §10 |
| Source-chain reorg | Deposit block reorged out | N confirmations before proof generation; attestors attest finalized heights |
| Oracle/worker liveness failure | No fresh proofs | Freshness bound halts minting; redemptions unaffected (§7.3) |
| Snapshot griefing | Spam `snapshotReserves` | `MIN_SNAPSHOT_GAP` rate limit |
| Governance capture | Admin sets extreme haircut | Bounded ≤ 10000, timelocked |

Honest gap: this reduces the trust assumption from "trust the custodian / DON / relayer" to "trust the source chain plus Creditcoin's own attestor set, within a bounded window." That is a real improvement over every row in §2.4, not a proof of impossibility. Say it that way; the bounded-window framing is more credible than a false absolute, and more credible framing is itself a point scored with technically literate judges.

---

## 9. Demo script (3 minutes) — dashboard-first, per the corrected critique

The earlier draft opened with a Sepolia deposit. **Reframe: open on the dashboard.** The invariant, live and enforced, is the star. Bridging is plumbing in service of it.

**0:00–0:20 — Open on the dashboard, not the bridge.** Full-screen: `verifiedReserves`, `totalMinted`, `ratio = 100.0%`, `lastAttested = block N`, all green, updating live. *"Every number on this screen is a cryptographic fact, not a report. No oracle network told us this. A native precompile proved it."*

**0:20–0:35 — The stake, fast.** One line, not a slide: "Cashio lost $52.8M because a mint function trusted an unverified collateral claim. Chainlink's Secure Mint and CelsiusX close that gap with a DON or a custodian attestation. We close it with zero trusted reporter — watch."

**0:35–1:15 — Happy path, shown as a dashboard event, not a demo of bridging.** Deposit on Sepolia (shown small, secondary window). Worker proves it. Dashboard ticks: `totalMinted +10`, `ratio` recalculates live from the aggregate, event log shows `InvariantChecked(10000 bps)`.

**1:15–1:50 — Attack 1: forged/replayed mint.** Submit a fabricated proof and a replay of a consumed deposit, live, on the Creditcoin explorer. Both revert. Dashboard doesn't move — because nothing was ever trusted enough to move it.

**1:50–2:35 — Attack 2: the one nobody else's architecture catches.** Custodian withdraws 40% on Sepolia. Next *permissionless* snapshot (anyone can call it — show someone other than the team calling it) lifts the new balance on-chain. Dashboard flips red in real time: `ratio → 60%`, `SolvencyBreach` emitted, `isSolvent = false`. Attempt mint → reverts. Attempt redeem → **succeeds**, shown live.

**2:35–3:00 — The exact sentence.** "No DON aggregated a report. No multisig signed off. No custodian was trusted to tell the truth. Every number on this dashboard, including the one that just went red, is a per-transaction cryptographic proof enforced by native code. That's the difference between this and Proof of Reserve as it exists today." Show `ISolvencyOracle` and a two-line integration snippet.

---

## 10. Limitations (state these before a judge finds them)

- **Bounded, not eliminated, custodian risk** between snapshots — exposure window is `MIN_SNAPSHOT_GAP + attestation latency`, and any shortfall in that window is publicly provable and automatically acted on, not hidden.
- **EVM source chains only** — Attestcoin's supported set is EVM (Sepolia reference). Bitcoin-backed reserves are roadmap.
- **On-chain reserves only** — fiat/off-chain custody needs a TLS/oracle proof (DECO-class, CCS 2020), not an inclusion proof. Roadmap.
- **Proof Generation API is a liveness dependency**, not a safety one; self-hosted proof generation is possible.
- **Haircut governance** is an admin surface — bounded and timelocked, not trustless in v1.
- **Say the category claim correctly:** this is not "the first proof-of-reserve system." It is the first, to our knowledge, that authorizes each mint from a per-transaction native inclusion proof with zero DON/multisig/relayer/heartbeat trust anywhere in the path. Overclaiming the former loses to a 30-second rebuttal; the latter does not.

---

## 11. Build plan

Submission deadline **6 September 2026**; today **25 August 2026** — ~12 days.

| Days | Milestone |
|---|---|
| 1–2 | Env setup; run `hello-bridge` end-to-end unmodified before writing original code |
| 3–4 | `ReserveVault.sol` on Sepolia: deposit, withdraw, `snapshotReserves` |
| 5–7 | `MintBoundASC.sol`: precompile integration, decoder, all guards, invariant |
| 8 | `SolvencyOracle` + `WrappedAsset`; off-chain worker (both loops) |
| 9 | Attack scripts: fake proof, replay, reverted-tx, stale snapshot, custodian drain |
| 10 | **Dashboard** — treat as core deliverable, not polish, per §9 |
| 11 | Demo video; README with architecture diagram, citations, and the §2.4 comparison table |
| 12 | Buffer, BUIDL page, final testnet redeploy |

**Nothing is mocked.** Every proof in the demo is a real Sepolia transaction verified by the real precompile on CC3.

**Hard rule:** if by day 7 the precompile integration isn't working end-to-end, cut the multi-asset support, not the attack demos or the dashboard — the dashboard is now the demo's spine, not an add-on.

---

## 12. Why this wins — corrected framing

**Against the mandate.** Depth of Attestcoin utilization is an explicit core criterion. MintBound cannot exist without the precompile — inclusion proofs, continuity proofs, batch verification, `EvmV1Decoder` — and introduces a new pattern (state-to-event lifting) the protocol itself doesn't document yet.

**Against the field.** The prior-edition flagship DeFi entry shipped a mock oracle. MintBound is the entry where cross-chain verification is the security property.

**Against the tutorial.** Acknowledge `SimpleMinterASC` explicitly and show the diff: flow vs. stock, per-tx vs. aggregate, no freshness bound vs. bounded staleness.

**Against the *actually* closest prior art — this is the fix.** Do not claim to have invented proof-of-reserve minting; Chainlink, CelsiusX, and Wrapped Zcash got there first as a category. Claim the specific, checkable thing: a mint authorization path with no DON, no multisig, no relayer, and no heartbeat report anywhere in it — only a per-transaction native inclusion proof. Put the §2.4 table in front of the judges and let them check it themselves; a claim a judge can verify in ten seconds is stronger than a bigger claim they can rebut in thirty.

**Against a sponsor's interests.** Nothing blocks institutional RWA adoption harder than unverifiable reserves. MintBound is a reusable primitive via `ISolvencyOracle` and a documentation-grade pattern (state-to-event lifting) the protocol team could adopt directly — a CEIP conversation, not just a prize.

**Against the record.** Prevents a named, dated, $52.8M failure class; addresses a $4.3B category; built on a CCS 2015 mechanism whose one remaining gap (self-attested assets) this specifically closes.

---

## 13. Deliverables checklist

- [ ] Public GitHub repo — **required**
- [ ] Working Attestcoin Protocol integration code — **required**
- [ ] Demo video — **required**
- [ ] Testnet deployment (CC3) with verified contract addresses in README
- [ ] Original work built during the event
- [ ] DoraHacks BUIDL page
- [ ] README: architecture diagram, §2.4 comparison table, peer-reviewed citations, explicit delta vs. `SimpleMinterASC` and vs. Chainlink Secure Mint / CelsiusX / Wrapped Zcash
- [ ] Confirm "MintBound" has no collision (GitHub/npm/ENS/trademark-adjacent search) before finalizing
- [ ] Re-verify exact rules text on the live logged-in DoraHacks page before submitting

---

### Suggested repo layout

```
mintbound/
├── contracts/
│   ├── sepolia/ReserveVault.sol
│   ├── creditcoin/MintBoundASC.sol
│   ├── creditcoin/SolvencyOracle.sol
│   ├── creditcoin/WrappedAsset.sol
│   └── lib/EvmV1Decoder.sol
├── worker/            # snapshot heartbeat + mint relay (@gluwa/usc-sdk)
├── attacks/           # fake-proof, replay, reverted-tx, stale-epoch, drain
├── dashboard/         # Next.js + wagmi — treated as core deliverable
├── docs/THREAT_MODEL.md
└── README.md
```
