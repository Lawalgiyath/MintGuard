# Demo video — shooting script

Three minutes. Five shots. Everything in it is live; nothing is mocked.

**The one rule:** show something working in the first fifteen seconds. A judge decides
whether to keep watching long before you finish explaining what a wrapped token is.

---

## Before you press record

Run these. If any is wrong, fix it before recording — a frozen system on camera is
worse than no video.

```powershell
.\scripts\worker-service.ps1 -Status
```
Expect: `Launcher installed : True`, at least one worker process.

```powershell
npx mintbound-cli claims
```
Expect the top line to read **`minting PERMITTED`**. If it says `FROZEN`, the worker
is not landing proofs — wait for the next snapshot (~5 min) and check again.

```powershell
cd packages\dashboard
```
```powershell
npm start
```
Dashboard on **http://localhost:3000**.

**Screen setup**
- Browser: one clean window, no extensions, no bookmarks bar, notifications off.
  Tab 1 `localhost:3000` · Tab 2 the Blockscout contract page.
- Terminal: dark, font size ~18pt so it reads at 1080p. Window about half the screen.
- Record at 1920×1080. Do not resize anything mid-take.
- Pre-type nothing except long addresses; typing the short commands live is fine and
  looks honest.

---

## Shot 1 · The hook — 0:00–0:20

**Screen:** `localhost:3000`, scrolled to the thirty-second panel. Both columns read
$400,000 / $100,000 — before the click.

> "A vault holds a million dollars. Six hundred thousand of tokens have been issued
> against it. Two systems are watching that vault."

**Click "Announce a $300,000 withdrawal."** Let the red and green land. Say nothing
for a full second.

> "The owner announces they're taking three hundred thousand out. It hasn't moved
> yet — but it's spoken for."
>
> "The ordinary check still counts it. MintBound stopped the moment it was announced.
> That three-hundred-thousand gap is exactly the withdrawal — and it's how token
> holders find out their token was backed by nothing."

---

## Shot 2 · What it is — 0:20–0:45

**Screen:** scroll up to the hero and the live bound bar. Ratio reading, THE BOUND
HOLDS badge visible.

> "MintBound holds mint authority over a wrapped asset, and refuses to use it unless
> Creditcoin's Block Prover precompile has cryptographically verified — inside the
> minting transaction — that the backing is there."
>
> "Not an oracle report. A Merkle proof of a specific Ethereum transaction, checked
> by native code, per mint."

Point at the numbers on screen: proven reserve, outstanding supply, headroom.

> "This is live on CC3 right now. Every figure is read from the chain."

---

## Shot 3 · Prove it yourself — 0:45–1:35

**Screen:** cut to the terminal. Type it live:

```
npx mintbound-cli claims
```

> "You don't have to believe any of that. This audits our own pitch."

Let it run. Scroll slowly through the ticks.

> "Every claim in the submission, with the live check that settles it. No trusted
> parties. Freshness read from the precompile, not reported to us. The bound holding.
> The operator's emergency exit irreversibly renounced. Gas measured from the real
> receipt — three hundred eighty-two thousand, five hundred seventy-eight."

Land on the tally.

> "Eleven of eleven, against live chain state. No key, no clone, no setup — that's
> npx, from an empty directory. Anyone can run it."

---

## Shot 4 · Attack it — 1:35–2:25

Still in the terminal:

```
npx mintbound-cli attack
```

> "Now I attack it. These are real calls against the live contract."

As the reverts appear:

> "Forged inclusion proof — rejected. A counterfeit vault emitting an identical
> event — rejected. A reverted source transaction. A proof from the wrong chain.
> A mint with nothing authorising it."

Land on the summary.

> "Six of six. Five stopped by the Block Prover precompile, one by the guard's
> chain-key pin before it even got that far. There is no path around the precompile."

---

## Shot 5 · Close — 2:25–3:00

**Screen:** Blockscout, `MintBoundASC` contract page, **Code** tab, source visible.

> "All ten contracts publish verified source. You can read every line behind every
> address."

Back to the dashboard for the final frame.

> "One rule underneath all of it: increasing liabilities requires a fresh proof.
> Decreasing them requires nothing. Every failure mode lands on the same side —
> minting stops, redeeming never does."
>
> "MintBound. Proof, not promise."

---

## What to say if asked about the nine minutes

Creditcoin attests finalized Sepolia blocks about nine minutes behind the tip, so a
deposit cannot become a mint inside a three-minute video. Do not fake it. If you want
to show proof material moving, use **REPLAY** mode — the proof ledger there is 171
genuine captured proofs with real block heights and Merkle roots, every hash checkable
on Etherscan, and the notice on screen says exactly that.

## If something goes wrong mid-take

- **`minting FROZEN`** — the worker stopped. It is not a bug, it is the staleness bound
  biting. Stop, restart the worker, wait for a proof, retake.
- **A claim shows `?`** — the block explorer timed out. That is the unknown state, not a
  failure. Retake; it is intermittent.
- **Attack suite slow** — each attempt is a live `eth_call` against CC3. Let it breathe;
  the pauses read as real, which they are.

## Editing

- Cut every gap longer than a second.
- On-screen labels for each shot: *The problem · What it is · Verify it · Attack it ·
  Verified source*.
- No music, or something very quiet. The terminal output is the content.
- Export 1080p, upload unlisted to YouTube, put that URL in the DoraHacks form.
