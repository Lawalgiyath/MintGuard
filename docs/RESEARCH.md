# MintBound — Verified Research Ledger

Every claim below was verified against a live endpoint or an installed package on
**2026-08-25**, not from documentation prose. Items marked ⚠️ are **corrections to
the original concept note** — the note asserted something that is not true of the
shipped protocol.

---

## 1. Live protocol ground truth (verified by direct RPC call)

| Fact | Verified value | How verified |
|---|---|---|
| CC3 testnet RPC | `https://rpc.cc3-testnet.creditcoin.network` | `eth_chainId` → `102031` |
| CC3 testnet chainId | `102031` | live call |
| CC3 explorer | `https://creditcoin-testnet.blockscout.com/` | docs |
| BlockProver precompile | `0x0000000000000000000000000000000000000FD2` | docs + interface |
| **ChainInfo precompile** | `0x0000000000000000000000000000000000000fd3` | **live call returned data** |
| Sepolia `chainKey` | **`1`** (chainId `11155111`, name `"Sepolia ethereum"`) | `get_supported_chains()` live |
| Ethereum mainnet `chainKey` | `3` (chainId `1`) | `get_supported_chains()` live |
| Proof Builder API | `https://proof-gen-api.cc3-testnet.creditcoin.network` | `/api/v1/health` → `200` |
| Swagger | `https://proof-gen-api.cc3-testnet.creditcoin.network/api/swagger/` | `200` |

`get_supported_chains()` returned exactly two source chains, confirming the note's
`chainKey = 1` assumption for Sepolia is correct.

### ⚠️ Correction 1 — the prover URL in the concept note does not exist
The note used `https://prover.usc-testnet.creditcoin.network`. That host does not
resolve. The real testnet endpoint is `proof-gen-api.cc3-testnet.creditcoin.network`
(`prover.cc3-testnet.creditcoin.network` also redirects there).

### ⚠️ Correction 2 — the SDK API in the concept note is from an older version
The note used `proofGenerator.api.ProverAPIProofGenerator`. In the shipped
`@gluwa/usc-sdk@0.18.0` the class is:

```ts
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber, 15_000, 1_200_000);
const proof = await proofBuilder.getProof(txHash);   // -> ProofResult
```

`ProofResult.data` is a `ContinuityResponse`:
`{ chainKey, headerNumber, txBytes, merkleProof: { root, siblings }, continuityProof: { lowerEndpointDigest, roots } }`.

### ⚠️ Correction 3 — the `EvmV1Decoder` import path moved
Reference examples import `@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol`
(valid in `0.1.2`). In `@gluwa/usc-contracts@0.2.0` — the version we pin — the path is:

```
@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol
```

Using the old path against 0.2.0 fails to compile. This is a real trap.

---

## 2. The finding that changes the architecture

The concept note's freshness rule is
`currentSrcHeight - attestedAtBlock <= MAX_STALENESS_BLOCKS`, but the note never
says where `currentSrcHeight` comes from. If a worker supplies it, the entire
"no trusted reporter" claim collapses — a lying worker could claim any height.

**The ChainInfo precompile makes this trustless.** Extracted from the SDK's embedded
ABI and confirmed live:

```
get_latest_attestation_height_and_hash(uint64 chainKey) view
    -> (uint64 height, bytes32 hash, bool isAttestation, bool exists)
is_height_attested(uint64 chainKey, uint64 targetHeight) view -> bool
get_attestation_genesis_height(uint64 chainKey) view -> uint64
get_supported_chains() view -> (uint64 chainKey, uint64 chainId, bytes chainName, uint8 chainEncoding)[]
```

Note the **snake_case** function names — the Solidity selector is computed over
`get_latest_attestation_height_and_hash(uint64)`, so the interface must declare
them in snake_case verbatim.

MintBound reads the current attested source height *from the chain itself* inside
the mint transaction. No off-chain input participates in the freshness decision.
This closes the last hole in the "zero trusted reporter" claim and is a stronger
statement than the concept note was able to make.

---

## 3. Verified precompile interface

`INativeQueryVerifier` (from `@gluwa/usc-contracts@0.2.0`) exposes **more than the
note assumed** — notably `view` variants and batch verification:

```solidity
function verify(uint64 chainKey, uint64 height, bytes calldata encodedTransaction,
                MerkleProof calldata, ContinuityProof calldata) external view returns (bool);
function verifyAndEmit(uint64 chainKey, uint64 height, bytes calldata encodedTransaction,
                MerkleProof calldata, ContinuityProof calldata) external returns (bool);
// batch — N transactions sharing ONE continuity proof
function verify(uint64 chainKey, uint64[] calldata heights, bytes[] calldata encodedTransactions,
                MerkleProof[] calldata, ContinuityProof calldata shared) external view returns (bool);
function calculateTxIndex(MerkleProof calldata) external view returns (uint64);
```

`NativeQueryVerifierLib.hasPrecompile()` exists and detects precompile availability —
this is the clean, protocol-sanctioned hook for a local/simulated deployment.

**Confirmed footgun (documented by Gluwa in a danger callout):** the precompile
"***does not*** validate if a transaction was successful". `receiptStatus == 1`
MUST be checked by the contract. The note called this correctly.

`EvmV1Decoder.LogEntry` is `{ address address_; bytes32[] topics; bytes data; }` —
so the emitter binding the note recommends is `log.address_ == CANONICAL_VAULT`.

---

## 4. The constraint that dictates the demo architecture

Measured live, Sepolia → Creditcoin attestation lag:

```
Sepolia head : 11563554
Attested     : 11563510
Lag          : ~44 blocks  ≈ 8.8 minutes
```

Gluwa's own SDK comment corroborates this: *"In practice this should take about
8 minutes"*, with a 20-minute conservative timeout.

**Consequence: a live end-to-end mint cannot be shown inside a 3-minute demo.**
This is a hard protocol property, not an implementation weakness — and it is the
real reason the live/simulated switch is an architectural requirement rather than
a convenience. See `docs/DESIGN.md` for how MintBound handles this honestly with
three provenance-labelled modes (LIVE / REPLAY / SIMULATED) instead of two.

---

## 5. Peer-reviewed foundations (unchanged from the note, all top-tier)

- Dagher, Bünz, Bonneau, Clark, Boneh. *Provisions: Privacy-Preserving Proofs of
  Solvency for Bitcoin Exchanges.* ACM CCS 2015. DOI `10.1145/2810103.2813674`.
  → MintBound removes Provisions' self-attested proof-of-assets step.
- Ji, Chalkias. *Generalized Proof of Liabilities.* ACM CCS 2021.
  DOI `10.1145/3460120.3484802`. → liabilities are public on-chain `totalSupply`.
- Xie, Zhang, Cheng, Zhang, Zhang, Jia, Boneh, Song. *zkBridge: Trustless
  Cross-Chain Bridges Made Practical.* ACM CCS 2022. DOI `10.1145/3548606.3560652`.
  → same security model, different mechanism.

## 6. Pinned versions

```
@gluwa/usc-contracts  0.2.0     (NOT 0.1.2 — decoder path differs)
@gluwa/usc-sdk        0.18.0
solc                  0.8.30    evm_version = shanghai
@openzeppelin/contracts 5.4.0
```

`evm_version = shanghai` is taken from Gluwa's own `foundry.toml`; Creditcoin's EVM
does not accept newer opcodes, so this must not be bumped to `cancun`.
