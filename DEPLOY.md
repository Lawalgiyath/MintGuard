# Making it reachable

Two things in this repository were built to be checked by a stranger, and until
they are published a stranger cannot reach either of them. A premortem on this
submission put both at the top of the list of ways it fails, so they get their own
document.

Neither needs anything from anyone else. Both take under ten minutes.

---

## 1. Publish the CLI

Everything in the README, the deck and the submission tells a reader to run
`npx mintbound-cli claims`. Until the package is published, that command answers
`404 Not Found` — which is worse than never having made the claim, because the one
thing this project asks to be judged on is that its claims can be checked.

```bash
npm login
npm run publish:cli
```

Then confirm it works the way a stranger will experience it — from a directory
that is **not** this repository, so nothing local is picked up:

```bash
cd /tmp && npx mintbound-cli claims
```

Notes:

- The package is **unscoped** (`mintbound-cli`, not `@mintbound/cli`) on purpose.
  A scoped name needs the `@mintbound` npm organisation to exist and to be yours,
  which is one more thing that can block you the night before judging.
- `prepublishOnly` runs the TypeScript build, so `dist/` is always current.
- Only `dist/` and the README ship. No source, no `.env`, nothing else.

---

## 2. Deploy the dashboard

The thirty-second explainer exists to solve the one problem engineering cannot:
that this project takes five minutes to understand and a judge gives it thirty
seconds. On `localhost:3000` it solves that problem for nobody.

```bash
npm i -g vercel
cd packages/dashboard
vercel --prod
```

`vercel.json` is already configured. Set these in the Vercel project's environment
variables — both are public RPC endpoints, and neither is a secret:

| Variable | Value |
|---|---|
| `CREDITCOIN_RPC_URL` | `https://rpc.cc3-testnet.creditcoin.network` |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |

`/api/state` is marked `no-store`, so the deployed dashboard reads the chain on
every request rather than serving a cached balance sheet — which for a solvency
instrument would be worse than serving nothing.

Once it is live, put the URL in the DoraHacks submission and in `README.md`.

---

## 3. Keep the worker running through judging

A judge running `npx mintbound-cli status` against a stalled deployment sees
`minting FROZEN`. That is the safety property working correctly — no fresh proof,
no new liabilities — and both the CLI and the dashboard say so in those words. But
it invites the reading that the system is broken, and you will not be in the room
to explain.

```bash
npm run worker
```

It submits a reserve snapshot every five minutes. Leave it running from the day you
submit until winners are announced.

To confirm the deployment is presentable right now:

```bash
npm run claims
```

Look for `minting PERMITTED` on the status line above the claims. If it says
`FROZEN`, the worker is not running or has not yet landed its first proof — the
first one takes about nine minutes, because Creditcoin attests finalized Sepolia
blocks and that wait is the cost of not trusting a reporter.

---

## 4. Share the deck as a PDF

The submission form asks for a **PDF URL**. An artifact link is private by default,
so a judge clicking an unshared one gets a login wall rather than a deck.

Open the deck, print to PDF (the page has `@page` rules that lay it out one slide
per landscape page on a white ground), and upload that file wherever the form wants
it. If you would rather link the artifact directly, share it publicly from the
page's share menu first, and check the link in a private browser window.

---

## The check that matters

When all four are done, this should work from a machine that has never seen this
repository:

```bash
npx mintbound-cli claims
```

Eleven claims, each resolved against live chain state, non-zero exit if any fails.
That is the whole argument for this project, and it only lands if the command runs.
