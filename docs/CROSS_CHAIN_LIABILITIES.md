# Cross-chain liabilities — the failure every per-chain check misses

*Research note. Hypothesis, evidence, mechanism, experiment, result.*

---

## Hypothesis, and its correction

**First attempt (wrong, kept deliberately):**

> Nobody aggregates wrapped supply across chains, so a per-chain reserve check can pass
> everywhere at once while the aggregate is fractional.

**That claim does not survive contact with the evidence.** Cross-chain supply
conservation is a solved and widely deployed problem:

- **LayerZero OFT** debits on the source chain (burn or lock) and credits on the
  destination (mint or unlock), "preserving a single unified global supply across all
  connected networks."
- **Chainlink CCIP's Cross-Chain Token (CCT) standard** burns on source and mints 1:1 on
  destination, "which keeps the total supply of the token constant across blockchains,"
  with per-lane rate limits on top.

Anyone pitching "we invented cross-chain supply accounting" gets destroyed by a judge who
has heard of either. So here is the claim that actually survives.

**Corrected hypothesis:**

> Cross-chain supply conservation is *preventive through construction* — the bridge's own
> logic burns before it mints, and the guarantee holds exactly as long as that logic and
> its messaging layer do. It is the bridge reporting on its own supply.
>
> MintBound instead *measures* each chain's supply independently, by cryptographic
> inclusion proof of that chain's actual `totalSupply()`, and enforces the reserve bound
> against the measurement. It is **detective through verification** rather than preventive
> through construction, and the measurement does not come from the system being measured.

Chainlink's own documentation draws exactly this line: the CCT security model is
"preventive through construction rather than detective through verification."

## Why the distinction is load-bearing, not semantic

Construction-based conservation fails precisely when the construction fails — and when it
does, **the bridge's own accounting still reports supply as conserved**, because that
accounting is derived from the bridge's own messages. A compromised mint authority, a
subverted messaging layer or a faulty pool creates supply that the system's self-report
cannot see, by definition.

This is the ordinary audit principle that the entity under examination should not also
produce the examination. It is also the same argument MintBound makes everywhere else:
do not trust a report about a fact, verify the fact. Applying it to the liability side is
consistency, not a new idea.

Two situations make it concrete:

1. **Compromised issuance.** Supply minted outside the bridge's intended path is invisible
   to the bridge's ledger and visible to an independent `totalSupply()` measurement.
2. **Heterogeneous issuance.** One reserve can back supply issued through a CCT pool, a
   separate custom bridge, and an OFT deployment at once. No single bridge's accounting
   spans the others. A per-chain measurement of actual supply does, because it does not
   care how the supply got there.

## Evidence the reserve-side gap is real

**1. The incumbent's own guidance covers the single-chain case.**
Chainlink's published builder's guide to Proof of Reserve for wrapped tokens addresses
the source-chain-to-destination-chain bridge scenario. It does not address multi-chain
supply aggregation, per-chain supply methodology, or the risk of one reserve backing
supply on several chains. Chainlink PoR is excellent production infrastructure; this is
an observation about scope, not quality.

**2. Reference integrations check local supply.**
BGD Labs' integration of Chainlink PoR into Aave on Avalanche checks whether the feed
value is greater than or equal to the total supply **of the asset on that deployment**.
That is the correct check for that contract and an incomplete one for the asset.

**3. The failure shape has already cost over a hundred million dollars.**
Multichain (July 2023) ran wrapped assets across Fantom, Moonriver, Dogechain, Arbitrum,
Polygon, Optimism, Avalanche, BNB Chain, Moonbeam and Ethereum against custodied
reserves. It held roughly **$1.26B** and lost approximately **$126–130M** when
centralised control failed. Whatever the proximate cause, the structure is the one this
note is about: many chains of liabilities, one pool of reserves, and no aggregate check.

**4. The distinction is already recognised informally.** Industry analysis of bridge risk
notes that a bridge can be *solvent* — every wrapped token backed by an asset somewhere —
while being *illiquid* on the chain where redemption is requested. Aggregate accounting is
what separates those two states, and nothing measures it on-chain today.

## Why the theory says this matters

Provisions (Dagher, Bünz, Bonneau, Clark, Boneh — ACM CCS 2015) defines solvency as a
proof of assets **and** a proof of liabilities, evaluated against the same commitment
moment. MintBound's earlier position was that the liability side was trivially public:
`totalSupply` of an ERC-20 on Creditcoin is readable by anyone, so no cryptographic
bridge was needed for it.

**That reasoning holds only while supply exists on exactly one chain.** The moment the
wrapped asset is issued anywhere else, `totalSupply` on Creditcoin stops being the
liability and becomes *a* liability. The proof of liabilities was incomplete, and the
paper's framing is what makes that visible.

## Mechanism

The fix is the same trick MintBound already uses for assets, pointed the other way.

`SupplyBeacon` is deployed on each chain where the wrapped asset is issued. It writes
that chain's outstanding supply into a log, which turns state into a fact about a
transaction — exactly the shape the Block Prover can verify:

```solidity
event SupplySnapshot(address indexed beacon, address indexed token, uint256 totalSupply, uint256 epoch);
```

`MintBoundASC.submitRemoteSupply()` verifies that log by inclusion proof and records it.
The invariant then reads:

```
Σ supply(every registered chain)  ≤  (verifiedReserve − encumbered) × haircut
```

Four properties make this safe rather than decorative:

| Property | Why |
|---|---|
| Only a registered `(chainKey, beacon)` pair may report | An attacker cannot invent a chain or a reporter. `submitRemoteSupply` deliberately does not pin to `SOURCE_CHAIN_KEY` — remote supply comes from elsewhere by definition — so the registry carries the authority instead |
| A registered chain that has never reported **halts minting** | An unknown liability is not a zero liability. Minting against an unknown liability is precisely the failure being prevented |
| A stale remote report **halts minting** | Each chain's freshness is measured against *its own* attested height, read from ChainInfo `0x0FD3` |
| Remote epochs are strictly monotonic | Replaying an older, smaller supply figure would understate liabilities — the mirror image of replaying an older, larger reserve |

Snapshotting is permissionless on both sides, for symmetric reasons: if only the issuer
could publish supply, the issuer could hide supply by staying quiet.

## The experiment

`packages/contracts/test/MintBound.test.ts` → *"cross-chain liabilities — the failure
every per-chain check misses"*.

```
Setup     reserve = 1,000 proven on Sepolia
Step 1    mint 1,000 on Creditcoin
          → local supply 1,000, ratio 10000 bps, isSolvent() = true
          → a per-chain PoR check, wired exactly as Aave wires one, reads 100% backed
Step 2    register chainKey 3 and prove its SupplyBeacon reporting 1,000
          → aggregate supply 2,000 against a 1,000 reserve
```

**Result:**

```
outstandingSupply    2,000    (aggregate, not local)
collateralRatioBps   5,000    (50% — genuinely insolvent)
solvent              false
mintFrozen           true
wrapped.totalSupply  1,000    ← unchanged. This is why per-chain checks cannot see it.
```

The last line is the whole point. Local supply never moved. Every per-chain instrument
still reports perfect health. Only the aggregate reveals the shortfall.

Six further tests cover the supporting guarantees: remote supply counted against headroom
before minting, unreported chains halting mints, stale remote reports halting mints,
unregistered beacons rejected, replayed older reports rejected, and the registered chain
set exposed for integrators.

## Honest limits

- **Registration is an admin action.** A chain nobody registers stays invisible. This is
  bounded in the safe direction — registering a chain can only ever *increase* measured
  liabilities and can only ever make minting harder — but it is not automatic discovery,
  and it should not be described as such.
- **Only chains Creditcoin attests can be proven.** Today that is Ethereum Sepolia
  (`chainKey 1`) and Ethereum mainnet (`chainKey 3`). Coverage grows with the attestor set,
  not with our code.
- **`MAX_REMOTE_CHAINS` is 16**, because `totalLiabilities()` and the freshness check both
  loop. That is ample for real wrapped assets and keeps the mint path's gas bounded.
- **Prior art is substantial and must be acknowledged first.** OFT and CCT already
  conserve global supply. Leading with novelty here rather than with the
  independent-measurement distinction is a losing move.
- **This detects, it does not prevent.** If supply was already over-issued on another
  chain, MintBound freezes minting and reports insolvency. It cannot burn someone else's
  tokens.

## What is and is not novel here

**Not novel:** cross-chain supply conservation. OFT and CCT do this at scale, and they do
it well. Do not claim otherwise.

**Not novel:** the idea of a global supply invariant. It is the stated design goal of both
standards.

**Defensible:** measuring each chain's supply by cryptographic inclusion proof of its real
`totalSupply()` and enforcing a reserve bound against that measurement — independent of,
and orthogonal to, whatever bridge produced the supply. Detective rather than preventive;
independent rather than self-reported.

**Defensible:** doing it on the same commitment moment as the asset side, which is what
Provisions (CCS 2015) actually asks for and what our earlier "liabilities are trivially
public" position quietly failed to deliver once supply existed on more than one chain.

**Within this hackathon:** all twelve surveyed submissions gate on a source-chain *event*.
MintBound was already the only one attesting a *balance*. With this it is the only one
attesting **both sides of the balance sheet**.

Stated for a judge in one sentence — carefully:

> Bridges keep supply consistent by construction and report it themselves. MintBound
> measures supply on every chain independently, by proof, and holds the reserve bound
> against that measurement rather than against the bridge's own bookkeeping.
