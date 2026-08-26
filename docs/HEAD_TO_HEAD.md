# Head-to-head: MintBound vs every submission

**Refreshed 2026-08-26. 15 Creditcoin submissions found** (IDs 47700–48800).

*Method caveat, and it matters for every row below:* DoraHacks renders BUIDL bodies
client-side, so this compares **authors' own one-line descriptions**, not their code. It
cannot see how complete anyone is, how good their engineering is, or what they have
deployed. Where a rival's advantage is listed, assume it is their *claimed* strength.

---

## The universal advantages every rival has over us

Before any per-project detail, three things are true of all fifteen:

1. **They submitted. We have not.** No amount of engineering outranks a live entry.
2. **They are simpler to explain.** Each has a one-sentence pitch that lands immediately.
   MintBound now has eight mechanisms, three modules and eight documents.
3. **They are on Creditcoin's core thesis.** Creditcoin is a credit chain. Nine of the
   fifteen are credit products. We are reserve infrastructure — adjacent, not central.

---

## Project by project

### 47813 · ProofYield — *RWA yield vault, coupon cashflows*
| | |
|---|---|
| **We beat them on** | They verify coupon *events*; we verify the *balance*. They cannot detect the vault emptying between coupons. No aggregate invariant, no encumbrance, no freshness read on-chain. |
| **They beat us on** | ERC-4626 is a standard with existing composability — their vault plugs into DeFi infrastructure that already exists. It is a *product that earns yield*, which is easier to want than a primitive. |
| **Net** | Ours, technically and decisively. Theirs on immediate product clarity. |

### 47990 · Oracle-Free Council — *AI agent decisions attested*
| | |
|---|---|
| **We beat them on** | Depth of protocol use, adversarial testing, formal invariants, an actual security property. Their attestation is a record of a decision, not a verified fact about the world. |
| **They beat us on** | Track positioning. The AI track is far less crowded than credit, and agent verifiability is the 2026 zeitgeist. |
| **Net** | Ours on substance. Theirs may take an AI track prize we are not competing for. |

### 48000 · VeriSettle — *escrow on delivery receipt*
| | |
|---|---|
| **We beat them on** | Everything technical: stock vs flow, aggregate, encumbrance, continuity, two precompiles. |
| **They beat us on** | Instant comprehensibility. "Escrow releases when delivery is proven" needs no explanation. |
| **Net** | Ours. |

### 48015 · Emberline — *private milestone funding, quorum attestations*
| | |
|---|---|
| **We beat them on** | Rigour, aggregate accounting, adversarial suite, protocol depth. |
| **They beat us on** | **PRIVACY — and this is the one genuine capability we lack.** They keep sensitive evidence private while still proving a quorum. MintBound publishes everything: exact reserve balances, encumbrances, per-chain supply, in cleartext, forever. For an institutional RWA issuer that is frequently a hard blocker. Worse, our own anchor paper — **Provisions (CCS 2015) — is a *privacy-preserving* proof of solvency, and we implemented only the non-private half.** |
| **Net** | **Theirs, on this axis, unambiguously.** It is the only place in the field where a competitor does something we structurally cannot. |

### 48016 · BORROWIQ — *AI credit scoring*
| | |
|---|---|
| **We beat them on** | Depth of Attestcoin use — their description barely ties to the protocol, and depth is an explicit scoring criterion. |
| **They beat us on** | Nothing identifiable from the description. |
| **Net** | Ours, clearly. |

### 48023 · AttestGuard — *AI agent trade-finance advances, policy-bounded*
| | |
|---|---|
| **We beat them on** | Stock vs flow; they verify delivery happened, not that funds remain. Our policy bounds are on-chain invariants, not a "hardcoded contract policy". |
| **They beat us on** | Two tracks at once (AI + RWA/DeFi) and a very concrete money story. "Agent proposes, policy disposes" is a good frame. |
| **Net** | Ours on substance. |

### 48033 · BountyOps — *agent job gating*
| | |
|---|---|
| **We beat them on** | All technical axes. |
| **They beat us on** | Clean narrative for agentic AI. |
| **Net** | Ours. |

### 48049 · AttestDesk — *trade credit on proven invoice payment*
| | |
|---|---|
| **We beat them on** | An invoice being paid says nothing about whether the money is still there. No aggregate, no continuity, one precompile. |
| **They beat us on** | **Market size and thesis fit.** Trade finance is a multi-trillion-dollar market with a real financing gap, and it is squarely what Creditcoin exists for. |
| **Net** | Ours technically; theirs on market narrative. Close on overall impression. |

### 48059 · Spark — *"2.5 billion people cannot access credit"*
| | |
|---|---|
| **We beat them on** | Every technical axis, and it is not close. |
| **They beat us on** | **Narrative and CEIP fit — the single biggest threat in the field.** CEIP explicitly prioritises financial inclusion and emerging markets. Their opening line *is* the programme's mandate. Ours is a second-order inclusion argument (proof matters most where audit and recourse are weakest), and second-order arguments lose to first-order ones in a three-minute pitch. |
| **Net** | **Theirs for the grand prize on narrative. Ours on engineering.** This is the actual fight. |

### 48073 · LedgerLine — *on-chain credit bureau*
| | |
|---|---|
| **We beat them on** | Depth, rigour, both-sides verification. |
| **They beat us on** | A credit bureau is an understandable, large, obviously-valuable business, and it is core Creditcoin. |
| **Net** | Close. Ours technically. |

### 48080 · Cr3dX — *credit state portability*
| | |
|---|---|
| **We beat them on** | All technical axes. |
| **They beat us on** | Cleanest one-line articulation in the field. |
| **Net** | Ours. |

### 48082 · Sovereign Attest Agent — *RWA without oracles, automated fuses*
| | |
|---|---|
| **We beat them on** | We have the same "fuses" (circuit breaker, freeze, velocity cap) **plus** proofs of both sides of the balance sheet, encumbrance, interval continuity and a second precompile. "TRIZ causality" is a methodology label, not a security property. |
| **They beat us on** | **They are in our exact lane** — RWA, no centralised oracles, bad-debt prevention — with an autonomous-agent framing that reads more modern. Closest competitor by domain. |
| **Net** | Ours, but this is the one whose *positioning* most overlaps ours. |

### 48097 · Credit Reputation Agent — *points awarded only after native-precompile proof*
| | |
|---|---|
| **We beat them on** | They verify an event and increment a counter. No invariant, no aggregate, no adversarial testing. |
| **They beat us on** | Nothing identifiable. |
| **Net** | Ours, clearly. |

### 48099 · SpaceFinance — *lock ETH on Sepolia, borrow on Creditcoin*
| | |
|---|---|
| **We beat them on** | Closest in *mechanism* — genuinely collateral-backed issuance — but it verifies the lock *event* per position, not the vault *balance* in aggregate. It cannot see collateral leave. No encumbrance, no continuity. |
| **They beat us on** | **A real, identifiable user base.** Spacecoin node operators are actual people with actual capital locked in hardware. That implies distribution and possibly a partner ecosystem. Also DePIN is an uncrowded track. |
| **Net** | Ours technically. **Theirs on go-to-market**, which is the axis we are weakest on. |

### 48101 · CreditPass — *cross-chain credit passport*
| | |
|---|---|
| **We beat them on** | All technical axes. |
| **They beat us on** | Consumer-facing clarity. |
| **Net** | Ours. |

---

## What actually outweighs us

Stripping out everything where we win, exactly **four** things beat MintBound — and only
one of them is technical.

### 1. Deployment — universal, and decisive
Fifteen entries are live. We are not. This outweighs every technical advantage in this
document combined, because a judge cannot verify what is not deployed. **Fixable today.**

### 2. Emberline's privacy — the only real capability gap
MintBound publishes exact reserve balances, encumbrances and per-chain supply in
cleartext, permanently. Many institutional issuers cannot accept that. This is genuinely
awkward given we cite Provisions as our foundation and Provisions is *privacy-preserving*
— we implemented the half that does not need cryptography and skipped the half that does.
**Not fixable quickly.** Doing it properly needs Pedersen commitments and range proofs.

### 3. Spark's narrative fit with CEIP — for the grand prize
Financial inclusion is CEIP's stated priority. Spark's opening line is the mandate
verbatim. **Fixable by framing**, not by code — and it is worth doing, because our
inclusion argument is real (trust substitutes for institutions precisely where enforcement
is weak — Xu, *Finance Research Letters* 35, 2020) but currently buried in a document
nobody will read.

### 4. Simplicity — a risk we created ourselves
Fifteen rivals have one idea each. MintBound now has eight mechanisms, three modules,
eighty tests and eight documents. **Breadth can read as lack of focus**, and a judge with
ten minutes may never reach the good part. This is the cost of the last week's work and
it should be managed in the pitch: lead with *one* mechanism, keep the rest as depth to
be discovered.

---

## The honest scoreboard

| Axis | Before | After the work below |
|---|---|---|
| Technical depth | MintBound | **MintBound** |
| Protocol utilisation *(explicitly scored)* | MintBound | **MintBound** — only entry using two precompiles |
| Adversarial rigour | MintBound | **MintBound** — only entry testing its own failure |
| Privacy | Emberline | **Contested — see below.** Not a gap on the data class we handle |
| Narrative / CEIP fit | Spark | **Contested.** Inclusion now leads, with peer-reviewed evidence |
| Simplicity of pitch | Anyone but us | **Fixed.** `PITCH.md` — one page, one idea |
| Go-to-market / real users | SpaceFinance | **Contested.** 40+ PoR feeds + 14 rivals are candidate integrators |
| Market size story | AttestDesk | AttestDesk — trade finance is genuinely larger |
| **Shipped** | **All fifteen. Not us.** | **Still not us. Blocked on funding.** |

### Privacy, resolved on the merits

MintBound's reserves are ERC-20 balances on a public chain — **anyone can already read
them with `balanceOf()`**, verified live. Encrypting a number whose plaintext sits on
Sepolia conceals nothing. And the vault address *must* be public, because emitter binding
is what stops the counterfeit-vault attack: you cannot have "anyone can verify the emitter
is legitimate" and "nobody knows which address it is" at once.

Emberline's privacy protects **off-chain delivery documents**. Ours would protect
**off-chain reserve amounts** — a different data class, and the one place privacy is real.
Creditcoin's bn128 precompiles (`0x06`, `0x07`, verified available) make Pedersen
commitments practical there; the blocker is the range proof needed to compare a committed
reserve against supply. Scoped, not built, and stated as roadmap. Full analysis:
[`PRIVACY.md`](PRIVACY.md).

### Narrative, fixed

The inclusion argument is now the **first thing in the README**, with the evidence behind
it: one in five unbanked adults cite distrust of institutions, and inclusion tracks trust
most strongly where legal enforcement is weakest (Xu 2020, *Finance Research Letters*).
Spark's claim is that people lack *history*. The literature says a fifth of them lack
*trust*. Both are true — and **Spark's own product needs ours**, because a credit score is
worthless if the collateral behind the loan is not there.

### Go-to-market, reframed

SpaceFinance has an identifiable user base; that is a real advantage. But MintBound serves
`AggregatorV3Interface`, so **every integration already built against Proof of Reserve —
40+ feeds, 56 projects — is a candidate by changing one address.** More directly: four of
the fifteen submissions in this very hackathon need collateral they can trust, and
integration is two lines. Being the layer *under* the field beats being the sixteenth
entry in it.

**Read plainly:** every axis except one is now either won or genuinely contested on the
merits. The exception is the only one that was never an engineering problem —
**nothing is deployed.** Fifteen entries are live and ours is not, and no argument in this
document outranks that.
