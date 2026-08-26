"use client";

import { useState } from "react";

interface Step {
  id: string;
  label: string;
  detail: string;
  status: "ok" | "fail" | "info";
  data?: Record<string, string | number | boolean>;
}

const MARK = { ok: "✓", fail: "✕", info: "·" } as const;

/**
 * Prove any Sepolia transaction, live, against the real precompile.
 *
 * The persuasive property is that the transaction is chosen by the viewer, not by us.
 * Anyone can paste a hash they picked themselves off Etherscan and watch Creditcoin's
 * native code confirm it — and then watch it refuse the same proof with one byte
 * changed. No wallet, no gas, nothing of ours deployed.
 */
export function Verifier() {
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!hash.trim() || busy) return;
    setBusy(true);
    setSteps(null);
    setError(null);
    setVerified(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash.trim() }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setSteps(json.steps ?? []);
        setVerified(json.verified ?? false);
      }
    } catch (err: any) {
      setError(err?.message ?? "Verification request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell" style={{ paddingBottom: 80 }}>
      <section className="hero" style={{ paddingBottom: 24 }}>
        <div className="label" style={{ marginBottom: 14 }}>Live proof verifier</div>
        <h1>
          Pick any Sepolia transaction. <em>Watch Creditcoin prove it.</em>
        </h1>
        <p>
          Not one of ours — one of yours. Paste any transaction hash from Ethereum Sepolia and
          this page will generate a real inclusion proof and hand it to the Block Prover
          precompile at <span className="mono">0x0FD2</span> for verification. Then it alters
          one field and shows the precompile refusing it.
          <br />
          <br />
          No wallet. No gas. Nothing of ours deployed. The Proof Builder is a read API and
          the precompile&apos;s <span className="mono">verify()</span> is a view function, so
          this is the entire trust argument, executable, by a stranger.
        </p>
      </section>

      <form onSubmit={run} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
        <input
          className="mono"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          placeholder="0x… Sepolia transaction hash"
          spellCheck={false}
          style={{
            flex: "1 1 440px",
            minWidth: 0,
            padding: "12px 14px",
            fontSize: 12.5,
            background: "var(--bg-sunken)",
            border: "1px solid var(--rule-strong)",
            borderRadius: "var(--radius)",
            color: "var(--ink)",
          }}
        />
        <button className="btn" data-variant="primary" disabled={busy || !hash.trim()}>
          {busy ? "PROVING…" : "PROVE IT"}
        </button>
      </form>

      {busy && (
        <div className="notice" role="status">
          Generating a real proof and calling the precompile. This takes a few seconds.
        </div>
      )}

      {error && (
        <div className="notice" role="alert" style={{ borderColor: "var(--breach-dim)" }}>
          <b style={{ color: "var(--breach)" }}>Cannot verify.</b> {error}
        </div>
      )}

      {steps && (
        <>
          <section
            className="bound"
            data-health={verified ? "proven" : "breached"}
            style={{ marginTop: 0 }}
          >
            <div className="bound-top" style={{ marginBottom: 0 }}>
              <div>
                <div className="label">Result</div>
                <div className="bound-ratio" style={{ fontSize: 34 }}>
                  {verified ? "PROVEN" : "NOT PROVEN"}
                </div>
                <div className="stat-sub" style={{ marginTop: 8, maxWidth: "60ch" }}>
                  {verified
                    ? "Native Creditcoin code confirmed this transaction was included in an attested Sepolia block — and refused the same proof once a single field was altered."
                    : "This transaction could not be proven right now. The steps below say exactly where it stopped."}
                </div>
              </div>
              {verified && (
                <div className="held">
                  <span aria-hidden="true">◆</span> ZERO TRUSTED REPORTERS
                </div>
              )}
            </div>
          </section>

          <section className="panel" style={{ marginTop: 20 }}>
            <header className="panel-head">
              <div className="label">Verification path</div>
              <a
                className="label"
                href={`https://sepolia.etherscan.io/tx/${hash.trim()}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--ink-2)" }}
              >
                VIEW ON ETHERSCAN →
              </a>
            </header>

            {steps.map((s) => (
              <div
                className="trust-row"
                data-status={s.status === "ok" ? "proven" : s.status === "fail" ? "failed" : "pending"}
                key={s.id}
              >
                <span className="trust-mark" aria-hidden="true">
                  {MARK[s.status]}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="trust-label">{s.label}</div>
                  <div className="trust-mech" style={{ marginTop: 5, lineHeight: 1.55 }}>
                    {s.detail}
                  </div>
                  {s.data && (
                    <div
                      className="mono"
                      style={{
                        marginTop: 8,
                        fontSize: 10,
                        color: "var(--ink-3)",
                        display: "grid",
                        gap: 3,
                      }}
                    >
                      {Object.entries(s.data).map(([k, v]) => (
                        <div key={k} style={{ overflowWrap: "anywhere" }}>
                          <span style={{ color: "var(--ink-3)" }}>{k}</span>{" "}
                          <span style={{ color: "var(--ink-2)" }}>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span className="trust-badge">{s.status.toUpperCase()}</span>
              </div>
            ))}
          </section>
        </>
      )}

      <footer className="foot">
        <div>
          <a href="/">← Back to the instrument</a>
        </div>
        <div style={{ textAlign: "right" }}>
          Block Prover 0x0FD2 · ChainInfo 0x0FD3 · chainKey 1 (Sepolia)
        </div>
      </footer>
    </main>
  );
}
