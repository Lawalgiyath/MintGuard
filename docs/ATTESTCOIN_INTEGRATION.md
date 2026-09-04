# Attestcoin Protocol integration

*Submission requirement: "Technical documentation detailing your setup and explaining how
the project uses the Attestcoin Protocol."*

This document covers both. Section 1 is setup. Sections 2–3 are the integration itself.
Section 4 records four things we found that the published documentation does not say —
included because they cost real time to discover and would cost the next team the same.

---

## 1. Setup

### Environments

| | |
|---|---|
| Target chain | Creditcoin CC3 testnet, chainId **102031** |
| Source chain | Ethereum Sepolia, chainId 11155111 |
| Attestcoin `chainKey` for Sepolia | **1** *(a Creditcoin-internal id, not an EVM chainId — chainKey 3 is Ethereum mainnet)* |
| Creditcoin RPC | `https://rpc.cc3-testnet.creditcoin.network` |
| Proof Builder API | `https://proof-gen-api.cc3-testnet.creditcoin.network` |

### Protocol components used

| Component | Address / version | Used for |
|---|---|---|
| Block Prover precompile | `0x0000000000000000000000000000000000000FD2` | Verifying Merkle + continuity proofs on-chain |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fD3` | Reading attested source height on-chain |
| `@gluwa/usc-contracts` | `0.2.0` | `INativeQueryVerifier`, `EvmV1Decoder` |
| `@gluwa/usc-sdk` | `0.18.0` | `proofProvider.service.ProofBuilder`, `chainInfo.PrecompileChainInfoProvider` |

Both precompiles are obtained through the library helpers rather than hardcoded:

```solidity
VERIFIER   = NativeQueryVerifierLib.getVerifier();   // 0x0FD2
CHAIN_INFO = ChainInfoLib.get();                     // 0x0FD3
```

### Running it

```bash
npm install
cp .env.example .env          # DEPLOYER_PRIVATE_KEY, WORKER_PRIVATE_KEY

npm run test:contracts        # 124 unit tests
npm run test:invariant        # 7 stateful invariants, 256 randomised runs each
npm run verify:live           # 13 checks against live CC3 infrastructure — needs no funds

cd packages/contracts
npx hardhat run scripts/deploy-sepolia.ts    --network sepolia
npx hardhat run scripts/deploy-creditcoin.ts --network creditcoin
npx hardhat run scripts/deploy-modules.ts    --network sepolia      # SupplyBeacon
npx hardhat run scripts/deploy-modules.ts    --network creditcoin   # SolvencyContinuity
npx hardhat run scripts/verify-source.ts     --network creditcoin   # publish source
npx hardhat run scripts/attack.ts            --network creditcoin

npm run worker                # untrusted relay
npm run dashboard             # http://localhost:3000
```

**Budget ~10 minutes for the first live proof.** Creditcoin attests Sepolia blocks roughly
nine minutes behind the tip. That is a protocol property, measured, not a defect in this
code — and mechanism 4 below is what makes it survivable rather than fatal.

To check the live deployment without cloning anything:

```bash
npx mintbound-cli status
npx mintbound-cli attack
npx mintbound-cli verify --source-tx 0x...
```

---

## 2. How the protocol is used — six integration points

The protocol is not a checkpoint in this project. Remove either precompile and there is no
product: the guard's only source of truth about the source chain *is* Attestcoin.

### 2.1 State-to-event lifting — the enabling trick

**The problem.** The Block Prover proves that a *transaction* occurred. Reserve solvency is
a question about *state* — an account balance. Balances are not transactions, so a balance
cannot be proven directly by this primitive.

**The solution.** `ReserveVault.snapshotReserves()` is permissionless and writes the vault's
own balance into a log:

```solidity
emit ReserveSnapshot(address(this), asset, balance, encumberedAmount, newEpoch);
```

The balance is now a fact *about a transaction*, and therefore provable. `MintBoundASC`
decodes that log out of proven transaction bytes and treats it as the reserve figure.

This generalises beyond us. **It turns a transaction oracle into a state oracle for any
dApp on Creditcoin** — any contract wanting to prove foreign *state* can have that state
emitted and then proven. It is the most reusable thing in this repository.

*Code:* `contracts/sepolia/ReserveVault.sol` · `MintBoundASC._reserveFromProof`

### 2.2 Per-mint proof verification via `0x0FD2`

Every mint carries a `Query` — chainKey, header number, encoded transaction, Merkle root
and siblings, continuity lower-endpoint digest and roots — verified inside the minting
transaction:

```solidity
INativeQueryVerifier.MerkleProof memory merkleProof =
    INativeQueryVerifier.MerkleProof({root: q.merkleRoot, siblings: q.siblings});
```

There is no reporter anywhere in the mint path. `trustedParties(asset)` returns `0`.

*Code:* `MintBoundASC.submitReserveSnapshot`, `MintBoundASC.mintWithProof`

### 2.3 Freshness read on-chain via `0x0FD3`

A proof of a balance is worthless without knowing how old it is — and asking an off-chain
party how stale a proof is reintroduces exactly the trust the proof removed. So the
contract asks Creditcoin itself:

```solidity
uint64 latest = CHAIN_INFO.get_latest_attestation_height_and_hash(ck).height;
```

If `latest - attestedAtHeight > maxStalenessBlocks`, minting reverts. No off-chain actor
can lie about freshness, because no off-chain actor is asked.

*Code:* `MintBoundASC._requireFresh`

### 2.4 Encumbrance — closing the attestation window

Attestation lag means an adversarial custodian would otherwise have a window in which the
money has left but no proof can yet show it. So withdrawals must be *announced* and are
timelocked, and an announced exit stops counting as backing from the moment of
announcement rather than execution:

```solidity
uint256 unencumbered = st.verifiedBalance > st.encumbered
    ? st.verifiedBalance - st.encumbered : 0;
return (unencumbered * haircutBps_) / BPS;
```

`ReserveVault`'s constructor refuses a delay below `MIN_WITHDRAWAL_DELAY` (120 blocks);
the deploy script sets 150 against a measured detection latency of roughly 40–57 blocks.
Encumbrances are subtracted **before** the haircut — applying the haircut first would
credit the protocol with a discounted share of money already announced as leaving.

*Code:* `ReserveVault.requestWithdrawal` · `MintBoundASC._effectiveReserve`

### 2.5 Cross-chain liability aggregation

Reserves are only half a balance sheet. `SupplyBeacon` emits a wrapped `totalSupply()` on
each remote chain; those are proven the same way and summed:

```solidity
function totalLiabilities(address sourceAsset) public view returns (uint256 total) {
    total = WrappedAsset(cfg.wrapped).totalSupply();
    uint64[] memory keys = remoteChainKeys[sourceAsset];
    for (uint256 i; i < len; ++i) total += remoteSupply[sourceAsset][keys[i]].amount;
}
```

A registered chain that stops reporting reverts with `RemoteSupplyMissing` and freezes
minting. Unknown liability is not treated as zero liability.

*Code:* `contracts/sepolia/SupplyBeacon.sol` · `MintBoundASC.totalLiabilities`

### 2.6 Optimistic interval continuity

A proof establishes a balance at an instant. The gap between proofs is asserted rather than
proven — but note the asymmetry: proving "no funds left over this interval" is expensive,
while *refuting* it takes a single inclusion proof. So the negative is asserted under bond
and refuted cryptographically.

```solidity
function assertNoOutflow(address asset, uint64 fromHeight, uint64 toHeight)
    external payable returns (bytes32 claimId);
function disprove(bytes32 claimId, Query calldata q) external returns (bool);
```

A successful `disprove` pays the challenger from the claimant's bond. This is optimistic,
not absolute, and [INVARIANTS.md](INVARIANTS.md) says so under "What is not invariant".

*Code:* `contracts/creditcoin/SolvencyContinuity.sol`

---

## 3. What it all enforces

One rule, evaluated inside the minting transaction:

> Total liabilities across all chains, plus this mint, must not exceed the proven reserve
> minus announced exits, after haircut.

Formal statements and the tests that check them: [INVARIANTS.md](INVARIANTS.md).

**Measured on live CC3:**

| Operation | Gas |
|---|---|
| `submitReserveSnapshot` | 368,592 |
| `mintWithProof` | 382,578 |

Under 400k for cross-chain proof verification plus the full aggregate invariant plus the
mint.

---

## 4. Four things the published docs do not say

Recorded because each cost hours to find, and each would cost the next team the same.

**4.1 The SDK API in the tutorials no longer exists.** The docs describe
`proofGenerator.api.ProverAPIProofGenerator`. In `@gluwa/usc-sdk@0.18.0` the path is
`proofProvider.service.ProofBuilder`. We built against the shipped SDK, not the docs.

**4.2 Attestation does not imply the proof is servable.** The Proof Builder returned
HTTP 422 for a transaction that was *already attested*, then served the same transaction
successfully minutes later — its block cache is eventually consistent. Treating the first
failure as fatal strands mints that are perfectly valid. We retry with backoff
(20s/40s/60s/80s/100s).

**4.3 Gas estimation fails against the precompiles.** `pallet-evm` does not reliably
propagate revert reasons in estimation mode, so `estimateGas` fails even when the call
would succeed. The worker falls back to a size-derived limit keyed off continuity proof
length, which is what actually drives verification cost.

**4.4 `0x0FD3` has no published Solidity interface.** `IChainInfo` in this repo is
reconstructed from the SDK's ABI. Note the selectors are **snake_case**
(`get_latest_attestation_height_and_hash`), which is unusual for Solidity and easy to get
wrong.

One more, for anyone writing tests: **the real precompile reverts, it does not return
`false`.** A forged proof produces `execution reverted: "Merkle proof validation failed"`.
Our first mock returned `false` and the resulting tests passed against behaviour the live
chain does not have. `MockBlockProver` now reverts by default, and
`npm run verify:live` asserts the mock's `txIndex` derivation matches the real
precompile's.

---

## 5. Verify any of this

Nothing above needs to be taken on trust. The Proof Builder is a read API and the guard's
entry points are reachable by `eth_call`, so all of it is checkable with no key and no
funds:

```bash
npx mintbound-cli verify --source-tx 0xc42a211e02ee86e5d92bb0bee2cef1679fbd358e474a044bdfe1e7ff7c9efa9c
```

Deployed addresses and key transaction hashes: [EVIDENCE.md](EVIDENCE.md).
