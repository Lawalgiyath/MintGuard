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

You need a free npm account. The package is unscoped, so it needs no organisation.

**On Windows PowerShell**, run each line separately — PowerShell 5.1 does not accept
`&&` as a separator and will fail to parse it. Every multi-line block in this document
is written one command per line for that reason.

Then confirm it works the way a stranger will experience it — from a directory
that is **not** this repository, so nothing local is picked up:

```bash
cd ..
npx mintbound-cli claims
```

Run it from anywhere that is not this repository, so the local `deployments/` files are
not picked up and you see exactly what a stranger sees.

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

One command per line, again for PowerShell.

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
so a judge clicking an unshared one gets a login wall rather than a deck — which is
a single point of failure on a required field.

The deck therefore also lives in this repository at
[`docs/deck.html`](docs/deck.html). That copy is public the moment the repo is, and
needs nothing from anyone.

To produce the PDF the form asks for: open `docs/deck.html` in a browser and print
to PDF. The page carries `@page` rules that lay it out one slide per landscape page
on a white ground, so it prints as a deck rather than as a screenshot of a dark
website.

If you would rather link the artifact directly, share it publicly from the page's
share menu first, then check the link in a private browser window — not in the tab
where you are already signed in, which will always work and tells you nothing.

---

## The check that matters

When all four are done, this should work from a machine that has never seen this
repository:

```bash
npx mintbound-cli claims
```

Eleven claims, each resolved against live chain state, non-zero exit if any fails.
That is the whole argument for this project, and it only lands if the command runs.
