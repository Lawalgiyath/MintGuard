# Documentation

Start with the deck or the pitch. Everything else is here to be checked rather than read
end to end.

## Start here

| | |
|---|---|
| [`deck.html`](deck.html) | The submission deck. 13 slides, prints to PDF. |
| [`PITCH.md`](PITCH.md) | One page, one idea. |

## For the Attestcoin integration requirement

| | |
|---|---|
| [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md) | Setup, environments, pinned versions, and all six integration points with code references. Also records four protocol behaviours the published documentation does not mention. |

## Verifying the claims

| | |
|---|---|
| [`EVIDENCE.md`](EVIDENCE.md) | Every security claim mapped to a runnable artifact: a test, a live command, or a transaction hash. |
| [`INVARIANTS.md`](INVARIANTS.md) | The safety properties as formal propositions, with the fuzzed test that checks each one. |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | Threats mapped to the mechanism that answers them. |

Fastest route:

```bash
npx mintbound-cli claims
```

Eleven claims, resolved against live chain state, non-zero exit if any fails.

## How the mechanisms work

| | |
|---|---|
| [`CROSS_CHAIN_LIABILITIES.md`](CROSS_CHAIN_LIABILITIES.md) | Both sides of the balance sheet, across chains. |
| [`CONTINUITY.md`](CONTINUITY.md) | Proof of reserve over an interval rather than at an instant. |
| [`RESEARCH.md`](RESEARCH.md) | Verified protocol ground truth, measured on live infrastructure. |

## Product and design

| | |
|---|---|
| [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md) | Who pays, why adoption is a one-address change, and what it returns to Creditcoin. |
| [`WHY_BACK_THIS.md`](WHY_BACK_THIS.md) | The investment case. |
| [`DESIGN.md`](DESIGN.md) | The design system behind the dashboard, and why it looks like an instrument. |
