<div align="center">

# MintBound

**Every mint is bound. By proof, not by promise.**

A per-mint cryptographic authorization primitive for wrapped and tokenized
real-world assets on Creditcoin.

`BUIDL CTC 2026 Fall` · RWA track · Creditcoin CC3 Testnet (`102031`) · Ethereum Sepolia (`chainKey 1`)

</div>

---

## The one sentence

> **Every reserve system in the world asks someone to *report* whether the money is
> there. MintBound *proves* it — and proves it is still there a minute later.**

## Why it matters, and where

More than **one in five unbanked adults** in developing economies stay outside the
financial system because they *do not trust financial institutions* (World Bank Findex).
That is not a technology gap — it is a proof gap.

And the research says it bites hardest exactly where you would expect: financial
inclusion tracks social trust, and **the effect is strongest in countries with weaker
legal enforcement** — trust operates as a *substitute* for formal institutions
(Xu, *Trust and financial inclusion: A cross-country study*, Finance Research Letters 35,
101310, 2020).

Where a local auditor's signature is not a guarantee and cross-border recourse is
theoretical, a monthly attestation is not assurance. Cryptographic proof is the only form
of assurance that travels — and it is identical for a lender in Lagos and one in London.

## The promise, in one line

> **The moment your backing starts to leave, you find out — and you can still get out.**

On 23 March 2022 someone was holding CASH because they believed it was backed. Overnight
it went to $0.00005 — about **$52.8M** gone — because a mint function accepted a
collateral account it never checked. The holders found out *afterwards*. There was no
moment where the system said *"the backing is leaving."*

Both halves of the promise are enforced in code:

- **You find out.** Reserves cannot leave the vault without a public, cryptographically
  provable announcement ~30 minutes in advance. Anyone can prove it. Nobody needs
  permission to be the one who notices.
- **You can still get out.** Redemption needs no proof, no oracle, no freshness — and
  works while the system is frozen. Minting is what freezes. Exiting never does.

---

## The claim, stated so it can be checked

> A wrapped asset that cannot be minted unless a native precompile has cryptographically
> verified, **per transaction**, that the exact backing event happened on the source chain
> and that the resulting **total** is still fully covered — with no DON, no multisig, no
> relayer, no heartbeat, and no trusted reporter anywhere in the authorization path.

This is deliberately narrower than "we invented proof-of-reserve minting." We did not.
Chainlink Secure Mint, CelsiusX, and the 2025 Wrapped Zcash design all got to
reserve-gated minting first, as a category. A claim a judge can verify in ten seconds is
worth more than a bigger one they can rebut in thirty, so here is the one that survives:

| Approach | What it actually verifies | Trust in the mint path |
|---|---|---|
| **Chainlink Secure Mint / PoR** | `totalSupply + amount <= reserves`, where `reserves` is a balance a DON aggregates and reports on a heartbeat. Encumbrances are out of scope (handled in an auditor's report, not on-chain) | The DON's aggregated report |
| **CelsiusX-style** | Custodian/relayer attestation of the locked amount | The custodian |
| **Wrapped Zcash (2025)** | Oracle-reported collateral + mint/burn controls | The oracle |
| **`SimpleMinterASC`** (Creditcoin's own tutorial) | One lock's inclusion — flow, not stock | Nothing, but also no aggregate, no freshness, no reaction to a later withdrawal |
| **MintBound** | The same aggregate check, but every input to it is proven: the balance and its **encumbrances** by Merkle + continuity proof of a specific source transaction, checked synchronously by native code, inside a freshness bound read from a second precompile | **Nothing.** |

---

## What actually makes it work

### 1. State-to-event lifting

The Block Prover precompile proves that *a transaction was included in an attested
block*. It cannot answer "what is the vault's balance right now" — that is state, not an
event. But proof-of-assets needs a balance.

So a **permissionless** function on the source chain reads the balance and writes it into
a log:

```solidity
function snapshotReserves(address asset) external returns (uint256, uint256, uint256) {
    uint256 bal = IERC20(asset).balanceOf(address(this));
    emit ReserveSnapshot(address(this), asset, bal, encumbered[asset], ++epoch[asset]);
}
```

The balance is now a fact *about a transaction*, which is exactly what Attestcoin can
prove. This generalises well beyond MintBound: it turns a transaction oracle into a
**state oracle** for any Creditcoin dApp.

Permissionless matters. If only the custodian could snapshot, they could withhold
snapshots to hide a shortfall. Because anyone can call it, a shortfall becomes publicly
provable — and because minting halts when snapshots go stale, withholding is never a
winning strategy.

### 2. The bound is on the aggregate, not the deposit

```
totalSupply(wrapped) + amount  ≤  verifiedReserve × haircut
```

Checking the incoming deposit alone is what every flow-only design does — and it is
exactly what fails to notice that the reserve backing the *other* 99% of supply left the
vault an hour ago.

**Be precise about who this differentiates us from.** Chainlink Secure Mint already
performs this same aggregate check (`totalSupply + mintAmount <= reserves`). The
aggregate invariant is *not* our differentiator against Chainlink — it is our
differentiator against event-gated designs, including Creditcoin's own tutorial. What
separates MintBound from Secure Mint is items 3, 4 and 5 below: where the reserve number
comes from, whether encumbrances are enforced on-chain, and whether freshness is read
from the chain or reported by someone.

### 3. Freshness is read on-chain — this is the part that is easy to get wrong

A staleness bound is only trustless if "how stale is this?" is answered on-chain. If the
worker supplied the current source height, a lying worker could make an arbitrarily old
reserve look current and the entire claim above would be false.

MintBound reads the latest attested height from the **ChainInfo precompile `0x0FD3`**
inside the mint transaction:

```solidity
uint64 latest = CHAIN_INFO.get_latest_attestation_height_and_hash(SOURCE_CHAIN_KEY).height;
if (latest - st.attestedAtHeight > maxStalenessBlocks) revert ReserveStale(...);
```

Gluwa does not publish a Solidity interface for this precompile. Ours was reconstructed
from the ABI embedded in `@gluwa/usc-sdk@0.18.0` and verified against the live network
(`docs/RESEARCH.md` §2). The snake_case function names are load-bearing — the selector
is computed over them.

### 4. Reserves cannot move without public warning

The honest weak point of any proof-of-reserve design is the gap between a withdrawal and
its detection. Measured on CC3: **~57 blocks, about 11 minutes**. For that window a
drained vault still looks solvent.

MintBound closes it by making withdrawal a **two-step, timelocked** operation and
reporting announced-but-unexecuted exits in the snapshot itself:

```solidity
event ReserveSnapshot(address indexed vault, address indexed asset,
                      uint256 balance, uint256 encumbered, uint256 epoch);
```

Encumbrances are subtracted *before* the haircut, so the instant an exit is announced
and proven, those funds stop counting as backing — **while they are still in the vault**,
and will be for at least `WITHDRAWAL_DELAY` blocks.

That reverses the question from *"how fast can we detect a theft?"* to *"can the
custodian move funds without telling anyone first?"* — and the answer is no, given:

```
WITHDRAWAL_DELAY 150 blocks (~30 min)  >  detection latency 57 blocks (~11.4 min)   ✓ 2.6x
```

The inequality is enforced, not trusted: the constructor rejects delays under 120 blocks
and the deploy script refuses anything under 2× measured latency. The unannounced-exit
escape hatch can be **permanently destroyed** with `renounceEmergencyWithdrawal()` —
there is no setter to turn it back on.

What remains is only loss that bypasses the vault entirely (a compromised key, an
exploited token). That cannot be driven to zero by any scheme, so a **rolling mint
velocity cap** bounds the damage inside it.

### 5. Both sides of the balance sheet, across every chain

Provisions (CCS 2015) defines solvency as a proof of assets **and** a proof of
liabilities at the same commitment moment. We originally argued liabilities were
trivially public — `totalSupply` on Creditcoin is readable by anyone.

**That holds only while supply exists on exactly one chain.** Real wrapped assets are
issued on several, and production reserve checks — including Chainlink's published
guidance for wrapped tokens and reference integrations like Aave's — compare the reserve
against supply on *one* chain.

**Be precise about prior art here.** Cross-chain supply conservation is *not* novel:
LayerZero OFT and Chainlink's CCT standard both preserve global supply by burning on the
source and minting on the destination. What they provide is *preventive through
construction* — the bridge's own logic conserves supply, and the bridge reports on its own
supply. MintBound instead **measures** each chain's real `totalSupply()` by inclusion
proof and enforces the bound against that measurement: detective rather than preventive,
independent rather than self-reported. That distinction matters exactly when the
construction fails, because a bridge's own accounting still reports supply as conserved
when its mint authority is compromised.

So `SupplyBeacon` applies the same lift to the liability side: each chain writes its
outstanding supply into a log, MintBound proves it, and the invariant becomes

```
Σ supply(every registered chain)  ≤  (verifiedReserve − encumbered) × haircut
```

A registered chain that has never reported **halts minting** — an unknown liability is
not a zero liability. The experiment is in the test suite:

```
mint 1,000 against a 1,000 reserve   → local ratio 100.00%, isSolvent() = true
prove chainKey 3 also holds 1,000    → aggregate 2,000 vs 1,000 → 50.00%, FROZEN
wrapped.totalSupply()                → still 1,000, unchanged
```

That last line is why per-chain verification cannot see this failure.
Full write-up: [`docs/CROSS_CHAIN_LIABILITIES.md`](docs/CROSS_CHAIN_LIABILITIES.md).

### 6. Proof of reserve over an interval, not at an instant

Every proof of reserve in existence — including everything above — is a **snapshot**. It
says the reserve was X at height H and nothing about H+1. That gap is the category's
standing criticism, and the industry names continuous PoR as a goal that "remains… not
yet widely implemented."

The asymmetry that cracks it: you cannot cheaply prove *"no funds left this vault"*, but
the positive that refutes it is **one inclusion proof**. So the negative is asserted
under bond and refuted cryptographically.

```
  balance(V) = X at height A            proven by snapshot
∧ no Transfer(from = V) in (A, B]       asserted under bond, refutable by anyone
⟹ balance(V) ≥ X for EVERY height in [A, B]
```

Bonded assertions and challenge windows are not new — UMA and optimistic rollups got
there first. **What is different is dispute resolution.** UMA escalates to a token-holder
vote; rollups re-execute their own state. `SolvencyContinuity` resolves a dispute with a
Merkle + continuity proof of a *foreign chain*, verified by native code in the disputing
transaction. No vote, no committee, no subjectivity. That is only possible on a chain
that can verify other chains natively — which is the whole reason it belongs here.

The bond pays whoever refutes, so watching is paid work. 21 tests, most of them attempts
to break it. Full write-up: [`docs/CONTINUITY.md`](docs/CONTINUITY.md).

### 7. The asymmetric fail-safe

> **Increasing liabilities requires a fresh cryptographic proof. Decreasing them
> requires nothing.**

Every failure mode — attestors stalling, worker censored, Proof Builder down, custodian
withholding, breach detected — degrades to **minting frozen, redemption open.** Never to
silent over-issuance.

---

## Check it from your terminal — no key, no funds, no clone

```bash
npx mintbound-cli claims     # audit every claim this repo makes, against live state
npx mintbound-cli status     # live balance sheet + assurance vector
npx mintbound-cli attack     # fire the documented attacks at the live guard
npx mintbound-cli verify --source-tx 0x...
```

> **If `npx` reports the package is not found**, it has not been published yet.
> Everything above also runs straight from a clone, with no publish step:
> `git clone https://github.com/Lawalgiyath/MintGuard && cd MintGuard && npm install && npm run claims`

```
Assurance  90/100
  ✓ Reserve evidence       25  cryptographic — no reporter in the mint path
  ✓ Proof freshness        20  21 of 200 blocks stale
  ✓ Liability coverage     20  single-chain deployment
  ✓ Encumbrance margin     15  150 block delay vs 40 block detection (3.8x margin)
  ✗ Interval continuity    10  no bonded continuity claim covers the current interval
  ✓ Mint authority         10  emergency withdrawal irreversibly renounced
```

Assurance is a presentation-layer aggregation over six independently checkable
obligations, with [published weights](packages/cli/src/assurance.ts). **No contract reads
it and no mint is gated on it** — enforcement on-chain is binary. It exists so a human can
see which parts of the solvency argument are carried by cryptography and which by an
assumption.

The attack suite is precise about where each attempt died:

```
6/6 blocked — 5 by the Block Prover precompile, 1 by the guard before it got that far
```

All six carry forged proof material, so they are stopped before MintBoundASC's own logic
runs. That is the property worth showing — there is no path around the precompile — but it
means the live suite does **not** exercise emitter binding, event matching, or replay.
Those need a *valid* proof with malicious contents, which cannot be forged against live
CC3, and are covered in the unit suite against a mock verifier. See
[docs/EVIDENCE.md](docs/EVIDENCE.md).

---

## Verify it yourself, on a transaction we have never seen

`/verify` — paste **any** Ethereum Sepolia transaction hash and watch Creditcoin's native
precompile prove it, live. Then watch it refuse the same proof with one byte changed.

```
√ Locate on Ethereum Sepolia          block 11566825, position 0
√ Attested on Creditcoin              ChainInfo precompile 0x0FD3
√ Generate inclusion proof            7 siblings, 76 continuity roots
√ Verified by Block Prover 0x0FD2     result: true
√ Decode receipt and logs             status 1, 4 logs, emitters bound
√ Negative control — tampered root    reverted: "Merkle proof validation failed"
```

No wallet, no gas, nothing of ours deployed — the Proof Builder is a read API and
`verify()` is a view function. The whole trust argument is executable by a stranger on a
transaction of their own choosing, which is a stronger demonstration than proving ours.

---

## It speaks Chainlink's interface — so nothing has to be rewritten

The usual objection to a new reserve primitive is that nobody will rewire their contracts
for it. So we did not ask them to.

`ProvenReserveFeed` implements **`AggregatorV3Interface`** — the exact interface Chainlink
Proof of Reserve feeds serve and Secure Mint integrations already consume. Any of them can
point at MintBound instead and keep working, **unchanged**.

That is not a claim in a README. `contracts/creditcoin/examples/SecureMintReference.sol`
is a faithful reproduction of Chainlink's Secure Mint pattern, written against
`AggregatorV3Interface` with **no knowledge that MintBound exists**. A passing test runs
it, unmodified, on a MintBound proof — and two more show it silently gaining properties
its author never wrote:

```
√ runs Chainlink's OWN Secure Mint pattern, unmodified, on our proof
√ reports the ENCUMBRANCE-ADJUSTED reserve, which ordinary PoR does not
√ gives an unmodified integration our freshness guarantee via its own staleness check
```

So MintBound is **not a competitor to Proof of Reserve**. It is a stronger evidence tier
wearing the incumbent's connector — the only realistic way a new reserve primitive ever
gets adopted.

### And it grades its own evidence

```solidity
oracle.trustedParties(asset)   // 0 = cryptographically proven
                               // 1 = oracle-reported, and we say so
```

Inclusion proofs cannot reach fiat in a bank or bullion in a vault. MintBound covers
those assets through a Chainlink-compatible feed — and reports `trustedParties = 1`
rather than implying they are proven. Minting on oracle evidence is opt-in per asset and
**off by default**, so widening coverage can never silently weaken the mint guarantee.

No other reserve system publishes how much trust its own number required.

---

## Architecture

```
ETHEREUM SEPOLIA (chainKey 1)            CREDITCOIN CC3 (102031)
┌────────────────────────────┐           ┌────────────────────────────────────┐
│ ReserveVault.sol           │           │ MintBoundASC.sol                   │
│  deposit()   → Locked      │           │  submitReserveSnapshot(Query)      │
│  snapshotReserves()        │           │  mintWithProof(Query)              │
│    → ReserveSnap(+encumb.) │           │  redeem()  ← no proof required     │
│  requestWithdrawal()  ⏱    │           │  implements ISolvencyOracle        │
│  executeWithdrawal()       │           │  velocity cap on new supply        │
└─────────────┬──────────────┘           └──────┬──────────────────┬──────────┘
              │ tx in block                     │ verify           │ freshness
              ▼                                 ▼                  ▼
      ┌───────────────┐              ┌───────────────────┐  ┌────────────────┐
      │ Attestor set  │─attestations→│ BlockProver 0x0FD2│  │ ChainInfo 0x0FD3│
      └───────────────┘              └───────────────────┘  └────────────────┘
              ▲                                 │
      ┌───────┴────────┐                        ▼
      │ Worker         │            ┌──────────────────────────┐
      │ (UNTRUSTED —   │            │ WrappedAsset (immutable  │
      │  can censor,   │            │ minter) · SolvencyGated  │
      │  cannot forge) │            │ Credit (integration demo)│
      └────────────────┘            └──────────────────────────┘
```

---

## Repository

```
README.md          You are here
SUBMISSION.md      Paste-ready DoraHacks copy, every claim checkable
DEPLOY.md          What must be reachable before judging
docs/
  README.md        Index — start here for anything below
  deck.html        The submission deck. 13 slides, prints to PDF
  ATTESTCOIN_INTEGRATION.md   Setup and all six integration points
  EVIDENCE.md      Every claim mapped to a runnable artifact
  INVARIANTS.md    Safety properties as formal propositions
  THREAT_MODEL.md  Threats mapped to the mechanism that answers them
  CROSS_CHAIN_LIABILITIES.md  Both sides of the balance sheet
  CONTINUITY.md    Proof of reserve over an interval
  RESEARCH.md      Verified protocol ground truth, measured live
  BUSINESS_MODEL.md  Who pays, and what it returns to Creditcoin
  WHY_BACK_THIS.md   The investment case
  PITCH.md         One page, one idea
  DESIGN.md        The design system behind the dashboard
packages/
  contracts/       Solidity + Hardhat 3. 126 unit tests + 7 invariants
    contracts/sepolia/      ReserveVault, SupplyBeacon, TestUSD
    contracts/creditcoin/   MintBoundASC, WrappedAsset, ProvenReserveFeed,
                            SolvencyContinuity,
                            examples/{SolvencyGatedCredit, SecureMintReference}
    contracts/interfaces/   IChainInfo, ISolvencyOracle
    contracts/mocks/        Precompile stand-ins, injected at 0x0FD2 / 0x0FD3
    scripts/                deploy, attack, verify-source
  cli/             npx mintbound-cli — claims / status / verify / attack
  worker/          Untrusted relay: snapshot heartbeat and mint relay
  dashboard/       Next.js instrument — LIVE / REPLAY / SIMULATED
```

---

## Quick start

```bash
npm install
cp .env.example .env          # add DEPLOYER_PRIVATE_KEY, WORKER_PRIVATE_KEY

# 1. Contracts
npm run test:contracts        # 126 unit tests
npm run test:invariant        # 7 stateful invariants, 256 randomised runs each
npm run verify:live           # 13 live checks against real CC3 infra — no funds needed

# 2. Deploy (Sepolia first — Creditcoin reads its artefacts)
cd packages/contracts
npx hardhat run scripts/deploy-sepolia.ts    --network sepolia
npx hardhat run scripts/deploy-creditcoin.ts --network creditcoin

# 3. Prove the reverts on the live deployment
npx hardhat run scripts/attack.ts --network creditcoin

# 4. Run the untrusted relay
npm run worker

# 5. Dashboard
npm run dashboard             # http://localhost:3000
```

> **Budget ~10 minutes for the first live proof.** Creditcoin attests Sepolia blocks
> roughly nine minutes behind the tip. This is a protocol property, measured (see below),
> not a bug in this code.

---

## The dashboard's three modes

Attestation latency makes a live end-to-end run impossible inside a short demo, so the
dashboard is honest about it instead of hiding it:

| Mode | Data | Use |
|---|---|---|
| **LIVE** | Read from CC3 and Sepolia right now | The real thing |
| **REPLAY** | Genuine captured proofs, replayed instantly | A fast demo with real cryptography |
| **SIMULATED** | Deterministic scenario engine, 10 scripted acts | Rehearsal and failure modes on demand |

Every value carries its provenance at the row level, and a mode rail runs down the
viewport edge. **Simulated data can never pass as live** — a solvency instrument that can
lie about its own provenance has argued against itself.

Simulated mode is keyboard-driven: `→` next act, `←` previous, `R` reset.

---

## Verified protocol facts

Confirmed by direct RPC call on **2026-08-25**, not read from documentation:

| Fact | Value |
|---|---|
| CC3 testnet | `https://rpc.cc3-testnet.creditcoin.network` · chainId `102031` |
| BlockProver precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fD3` |
| Sepolia `chainKey` | `1` (chainId `11155111`) |
| Ethereum `chainKey` | `3` (chainId `1`) |
| Proof Builder | `https://proof-gen-api.cc3-testnet.creditcoin.network` |
| **Attestation lag** | **~44 blocks ≈ 8.8 min** (head `11563554`, attested `11563510`) |

Three corrections to the original concept note, all documented in `docs/RESEARCH.md`:

1. The prover host `prover.usc-testnet.creditcoin.network` **does not resolve**.
2. The SDK class is `proofProvider.service.ProofBuilder`, not `ProverAPIProofGenerator`.
3. In `@gluwa/usc-contracts@0.2.0` the decoder moved to
   `contracts/write-ability/common/EvmV1Decoder.sol`. The old `contracts/decoding/` path
   silently fails to compile.

---

## Integrating

MintBound is infrastructure, not an app. `SolvencyGatedCredit.sol` is a working lending
market that refuses collateral unless the backing is provably there:

```solidity
ISolvencyOracle oracle = ISolvencyOracle(MINTBOUND);

uint32 ratio = oracle.collateralRatioBps(sourceAsset);
if (!oracle.isSolvent(sourceAsset) || ratio < MIN_RATIO_BPS) revert NotProvenSolvent();
```

A conventional market learns about a depeg from its price feed — that is, after the
market has already priced in the loss. This one closes the moment the reserve proof goes
stale or coverage drops, before any price has moved, because nothing about it depends on
a market observing anything.

---

## Peer-reviewed foundations

- **Dagher, Bünz, Bonneau, Clark, Boneh.** *Provisions: Privacy-Preserving Proofs of
  Solvency for Bitcoin Exchanges.* ACM CCS 2015. `10.1145/2810103.2813674`
  → Provisions' proof-of-assets still relies on the exchange signing for addresses it
  controls — a self-attestation, structurally the same gap as a DON report. MintBound's
  contribution is removing that step, substituting a third-party-unforgeable inclusion
  proof verified by native code. Not "we invented proof of solvency": *we closed
  Provisions' one remaining trust gap with a primitive that did not exist in 2015.*
- **Ji, Chalkias.** *Generalized Proof of Liabilities.* ACM CCS 2021.
  `10.1145/3460120.3484802` → liabilities are public here (`totalSupply` on Creditcoin),
  so only the asset side needed a cryptographic bridge.
- **Xie, Zhang, Cheng, Zhang, Zhang, Jia, Boneh, Song.** *zkBridge: Trustless Cross-Chain
  Bridges Made Practical.* ACM CCS 2022. `10.1145/3548606.3560652` → same security model
  (verify the event, never a committee's assertion about it), different mechanism.

---

## The problem, dated

- **Cashio**, 23 March 2022: ~**$52.8M** lost to an infinite-mint bug caused by missing
  collateral validation in the mint path. CASH went to ~$0.00005.
- Cross-chain bridges: ~**$4.3B** stolen across 49 incidents, June 2021 – September 2024
  — roughly 40% of all value hacked in Web3 over that period. The root cause is almost
  always a trusted validator set the minting contract cannot itself verify.
- Creditcoin's own prior-edition flagship DeFi entry shipped its CDP with a **mock
  oracle** — faking the exact capability this hackathon mandates.

---

<div align="center">

**Bound to the chain, not to a committee.**
Minting is bound. Redemption never is.

</div>
