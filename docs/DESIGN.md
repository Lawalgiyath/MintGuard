# MintBound — Design System

## The thesis

**In an instrument, colour is data.**

This is not a marketing site with a dashboard bolted on. It is an instrument that
reports a cryptographic measurement, and it is designed the way instruments are
designed: nothing decorative, nothing that moves without meaning, no colour that does
not encode state. If a judge sees green, the bound holds. If they see red, it does not.
There is no third reason for either colour to appear anywhere on the page.

That constraint is the design. It is also what makes the thing feel expensive — the
restraint reads as confidence, and it is the same restraint the protocol argues for:
say only what you can prove.

## Lineage

Drawn deliberately, and only, from work that has actually won:

| Source | What is taken |
|---|---|
| **Swiss / International Typographic Style** (Müller-Brockmann) | Strict grid, hairline rules, type as structure rather than ornament |
| **Linear** (Awwwards SOTD; Webby) | Near-black canvas, restrained accent, precision spacing, keyboard affordances |
| **Stripe** (multiple Awwwards, Webby) | Editorial clarity applied to dense financial data; explanation as first-class UI |
| **Vercel / Geist** (Awwwards) | Monospace numerics, tabular alignment, geometric calm |
| **Bloomberg terminal** | Density as an aesthetic — information rate is the luxury |
| **Braun / Dieter Rams, Teenage Engineering** | Labelled panels, honest function, "as little design as possible" |
| **OFF+BRAND — Lando Norris** (Awwwards Site of the Year 2025) | Decisive full-bleed hero, one idea per viewport |
| **By-Kin** (SOTD + Developer Award) | Micro-interaction discipline; motion that reports rather than performs |

What is deliberately *not* taken: WebGL scenes, scroll-jacking, cursor followers,
parallax. Those win awards on portfolio sites and destroy credibility on a solvency
instrument. The award being chased here is the one for making something dense
legible — not the one for making something simple elaborate.

## Palette — semantic only

Every colour is a state. There are no brand colours used for decoration.

```
--proof    hsl(157 62% 52%)   the bound holds; a fact is cryptographically proven
--breach   hsl(  4 74% 62%)   the bound is broken; coverage has failed
--stale    hsl( 38 92% 55%)   proof is outside the freshness window; not proven false, just old
--pending  hsl(212 90% 62%)   verification in flight
```

Neutrals carry everything else. Dark is the default because the instrument is meant to
be read in a dim room during a live demo; light mode is a full peer, not an afterthought.

The accent green doubles as the product's own wordplay — MintBound mints, and the
signal colour is mint.

## Type

- **Display / UI:** Inter Tight — tight grotesk, set at negative tracking for headings.
- **Numerics and hashes:** JetBrains Mono, `font-variant-numeric: tabular-nums`.

Tabular numerals are load-bearing, not taste. Live figures update several times a
minute; without fixed-width digits the layout jitters on every tick and the whole thing
reads as unstable — the exact opposite of the impression a solvency instrument needs
to make.

## The signature element: THE BOUND

The invariant is `totalSupply ≤ verifiedReserve × haircut`. Rendered as a physical
constraint you can watch strain:

```
├──────────────────────────────────────────┼─────────────┤
   outstanding supply (filled)              headroom      ↑ the bound
```

- The **track** is the proven reserve.
- The **fill** is outstanding supply.
- A hard tick marks the haircut boundary.
- As supply approaches the bound, the fill tightens toward the tick.
- On breach the fill crosses the tick and the whole component switches to `--breach`.

The abstract inequality becomes something an audience feels before they read it. This
is the one moment of the design allowed to be dramatic, because it is the moment the
product is about.

## Motion

Instruments settle; they do not bounce.

- Numbers interpolate to their new value over 420ms with a linear-out curve. No spring.
- The bound bar transitions its width; it never pulses for attention.
- State changes are decisive: healthy → breach is a single 180ms cut, not a fade.
- `prefers-reduced-motion` removes all of it and loses no information.

## Honesty as an interface requirement

The dashboard runs in three modes, and **every rendered value carries its provenance**.

| Mode | What the data is | Why it exists |
|---|---|---|
| **LIVE** | Read from CC3 testnet and Sepolia right now | The real thing |
| **REPLAY** | Genuine captured proofs from a real run, replayed instantly | Attestation takes ~9 minutes (`docs/RESEARCH.md` §4). A 3-minute demo cannot wait. The cryptography is real; only the timing is compressed |
| **SIMULATED** | A deterministic scenario engine | Rehearsal, offline demos, and showing failure modes on demand |

A persistent mode rail runs down the left edge of the viewport, and simulated data is
additionally marked at the value level. **Simulated data must never be able to pass as
live.** This is an integrity requirement first — a solvency instrument that can lie
about its own provenance has argued against itself — and it happens to also be the
detail that makes the build feel considered.

## Wordplay

The name carries the mechanism, so the copy does too. Every line below is tied to
something the contract actually does:

- **"Every mint is bound. By proof, not by promise."** — the hero.
- **"THE BOUND"** — the invariant bar.
- **"THE BOUND HELD."** — shown when an attack is rejected. The reverts are the product;
  this is the line that says so.
- **"Nothing taken on trust."** — heads the trust-path panel, which terminates in the
  readout `TRUSTED REPORTERS IN THIS PATH: 0`.
- **"Minting is bound. Redemption never is."** — the asymmetric fail-safe, stated as a
  rule rather than explained as a feature.
- **"Bound to the chain, not to a committee."** — footer.

## Accessibility

- All state is encoded redundantly: colour **plus** label **plus** icon. A red/green
  colour-blind viewer loses nothing, which matters more than usual here because the
  entire interface is a two-state signal.
- Contrast meets WCAG AA against both canvases.
- Full keyboard operation of the scenario deck; visible focus rings.
- Live regions announce state transitions.
