"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoundBar } from "./BoundBar";
import { ProofLedger, StatGrid, TrustPath } from "./Panels";
import { Divergence } from "./Divergence";
import { ThirtySeconds } from "./ThirtySeconds";
import { buildActs, snapshotAt } from "@/lib/simulator";
import {
  EMPTY_STATE,
  buildTrustPath,
  healthOf,
  type DashboardSnapshot,
  type Mode,
} from "@/lib/types";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "live", label: "LIVE", hint: "Read from CC3 testnet and Sepolia right now" },
  { id: "replay", label: "REPLAY", hint: "Genuine captured proofs, replayed instantly" },
  { id: "simulated", label: "SIMULATED", hint: "Deterministic scenario engine — not chain data" },
];

/** Revive a JSON payload from /api/state back into a typed snapshot. */
function reviveLive(raw: any): DashboardSnapshot {
  const st = raw.state ?? {};
  const state = {
    ...EMPTY_STATE,
    ...st,
    trustedParties: Number(st.trustedParties ?? 0),
    verifiedReserve: BigInt(st.verifiedReserve ?? 0),
    encumberedReserve: BigInt(st.encumberedReserve ?? 0),
    outstandingSupply: BigInt(st.outstandingSupply ?? 0),
    discountedReserve: BigInt(st.discountedReserve ?? 0),
    maxMintable: BigInt(st.maxMintable ?? 0),
  };
  const health = raw.health ?? healthOf(state);
  return {
    mode: "live",
    connected: true,
    health,
    state,
    ledger: (raw.ledger ?? []).map((e: any) => ({ ...e, at: e.at ?? Date.now() })),
    trustPath: raw.trustPath ?? buildTrustPath(state, health),
    context: {
      ...raw.context,
      vaultBalance: raw.context?.vaultBalance ? BigInt(raw.context.vaultBalance) : undefined,
    },
    divergence: raw.divergence
      ? {
          reportedAnswer: BigInt(raw.divergence.reportedAnswer),
          reportedAgeSeconds: Number(raw.divergence.reportedAgeSeconds),
          provenAnswer: BigInt(raw.divergence.provenAnswer),
          provenAgeSeconds: Number(raw.divergence.provenAgeSeconds),
        }
      : undefined,
    vault: raw.vault
      ? {
          emergencyEnabled: Boolean(raw.vault.emergencyEnabled),
          withdrawalDelayBlocks: Number(raw.vault.withdrawalDelayBlocks),
          encumbered: BigInt(raw.vault.encumbered ?? 0),
        }
      : undefined,
  };
}

export function Dashboard() {
  const [mode, setMode] = useState<Mode>("simulated");
  const [live, setLive] = useState<DashboardSnapshot | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [act, setAct] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const acts = useMemo(() => buildActs(), []);

  // ── LIVE polling ─────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const raw = await res.json();
      if (!raw.connected) {
        setLiveError(raw.error ?? "Not connected.");
        setLive(null);
      } else {
        setLiveError(null);
        setLive(reviveLive(raw));
      }
    } catch (e: any) {
      setLiveError(e?.message ?? "Failed to reach the chain reader.");
      setLive(null);
    }
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    void poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, [mode, poll]);

  // ── Autoplay for simulated mode ──────────────────────────────────────────
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!autoplay || mode !== "simulated") return;
    timer.current = setInterval(() => {
      setAct((a) => (a + 1 >= acts.length ? (setAutoplay(false), a) : a + 1));
    }, 5200);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [autoplay, mode, acts.length]);

  // ── Keyboard control — a demo is driven, not clicked ─────────────────────
  useEffect(() => {
    if (mode !== "simulated") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setAct((a) => Math.min(a + 1, acts.length - 1));
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setAct((a) => Math.max(a - 1, 0));
      }
      if (e.key === "r" || e.key === "R") setAct(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, acts.length]);

  // ── Resolve the snapshot for the active mode ─────────────────────────────
  const snap: DashboardSnapshot = useMemo(() => {
    if (mode === "simulated") return snapshotAt(acts, act);
    if (mode === "live" && live) return live;
    if (mode === "replay") {
      // Replay reuses the scripted beats but marks provenance as genuine captured
      // proof material. Without a bundle on disk it degrades to the same beats,
      // labelled honestly rather than dressed up as chain data.
      const s = snapshotAt(acts, act);
      return {
        ...s,
        mode: "replay",
        ledger: s.ledger.map((e) => ({ ...e, provenance: "replay" as const })),
      };
    }
    return {
      mode,
      connected: false,
      health: "unknown",
      state: EMPTY_STATE,
      ledger: [],
      trustPath: buildTrustPath(EMPTY_STATE, "unknown"),
      context: {},
      error: liveError ?? undefined,
    };
  }, [mode, act, acts, live, liveError]);

  const scripted = mode === "simulated" || mode === "replay";
  const current = acts[act]!;

  return (
    <>
      <div className="mode-rail" data-mode={mode} aria-hidden="true" />

      <header className="masthead">
        <div className="shell masthead-inner">
          <div className="wordmark">
            <span>
              Mint<span className="mark-bound">Bound</span>
            </span>
            <span className="label" style={{ letterSpacing: "0.16em" }}>
              proof-bound minting
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span className="pill" data-health={snap.health}>
              <span className={`dot${mode === "live" ? " live" : ""}`} />
              {snap.health === "proven" && "PROVEN SOLVENT"}
              {snap.health === "breached" && "SOLVENCY BREACH"}
              {snap.health === "stale" && "PROOF STALE"}
              {snap.health === "unknown" && "AWAITING PROOF"}
            </span>

            <a
              className="btn"
              href="/verify"
              style={{ textDecoration: "none", display: "inline-block" }}
              title="Prove any Sepolia transaction against the live precompile"
            >
              VERIFY ANY TX →
            </a>

            <div className="switch" role="group" aria-label="Data source mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  data-mode={m.id}
                  aria-pressed={mode === m.id}
                  title={m.hint}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="hero">
          <h1>
            Every mint is <em>bound</em>. By proof, not by promise.
          </h1>
          <p>
            Every reserve system asks someone to <em>report</em> whether the money is there.
            This one proves it — per transaction, by native code — and proves it is still
            there a minute later. No DON, no multisig, no heartbeat, no trusted reporter
            anywhere in the path.
          </p>
          <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--ink-3)" }}>
            More than one in five unbanked adults stay outside the financial system because
            they do not trust financial institutions. That is a proof problem, and it is
            worst exactly where auditors and courts are weakest.
          </p>
        </section>

        <ThirtySeconds />

        {mode === "live" && liveError && (
          <div className="notice" role="status">
            <b>LIVE unavailable.</b> {liveError}
          </div>
        )}

        {mode === "simulated" && (
          <div className="notice" role="status">
            <b>SIMULATED.</b> These figures are produced by a deterministic scenario engine, not
            read from a chain. Creditcoin attests Sepolia blocks roughly nine minutes late, so a
            real deposit cannot become a real mint inside a short demo. Every value below is
            marked <span className="tag" data-p="simulated">SIMULATED</span> at the row level.
          </div>
        )}

        {mode === "replay" && (
          <div className="notice" role="status" style={{ borderColor: "var(--pending)" }}>
            <b style={{ color: "var(--pending)" }}>REPLAY.</b> Genuine proof material captured
            from a real testnet run, replayed at speed. The cryptography is real; only the timing
            is compressed.
          </div>
        )}

        <BoundBar state={snap.state} health={snap.health} />

        <StatGrid snap={snap} />

        {snap.divergence && <Divergence data={snap.divergence} state={snap.state} />}

        <div className="cols">
          <TrustPath steps={snap.trustPath} trustedParties={snap.state.trustedParties} />
          <ProofLedger entries={snap.ledger} mode={snap.mode} />
        </div>

        {snap.vault && (
          <section className="panel" style={{ marginTop: 20 }}>
            <header className="panel-head">
              <div className="label">Source-chain vault posture</div>
              <span
                className="pill"
                data-health={snap.vault.emergencyEnabled ? "stale" : "proven"}
              >
                <span className="dot" />
                {snap.vault.emergencyEnabled ? "ESCAPE HATCH LIVE" : "RUG FUNCTION RENOUNCED"}
              </span>
            </header>
            <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" }}>
              {snap.vault.emergencyEnabled ? (
                <>
                  This vault can still withdraw without announcing. Run{" "}
                  <span className="mono">scripts/renounce.ts</span> to destroy that path
                  permanently — after which every outflow must be announced and wait{" "}
                  {snap.vault.withdrawalDelayBlocks} blocks (~
                  {Math.round((snap.vault.withdrawalDelayBlocks * 12) / 60)} min).
                </>
              ) : (
                <>
                  <b style={{ color: "var(--proof)" }}>
                    There is no function on this vault that moves reserves without warning.
                  </b>{" "}
                  It was destroyed on-chain and cannot be restored — there is no setter.
                  Every outflow must now be announced and wait{" "}
                  {snap.vault.withdrawalDelayBlocks} blocks (~
                  {Math.round((snap.vault.withdrawalDelayBlocks * 12) / 60)} min), which is
                  long enough for the announcement to be proven on Creditcoin first.
                </>
              )}
            </div>
          </section>
        )}

        {mode === "live" && snap.context.ascAddress && (
          <div className="panel" style={{ marginTop: 20 }}>
            <header className="panel-head">
              <div className="label">Deployment</div>
              <a
                className="label"
                href={`https://creditcoin-testnet.blockscout.com/address/${snap.context.ascAddress}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--proof)" }}
              >
                VIEW ON EXPLORER →
              </a>
            </header>
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              <KV k="MintBoundASC (CC3)" v={snap.context.ascAddress} />
              <KV k="Canonical vault (Sepolia)" v={snap.context.vaultAddress} />
              <KV k="Source asset" v={snap.context.sourceAsset} />
              <KV k="Source chainKey" v={String(snap.context.sourceChainKey)} />
            </div>
          </div>
        )}

        <footer className="foot">
          <div>
            <div style={{ color: "var(--ink-2)", marginBottom: 6 }}>
              Bound to the chain, not to a committee.
            </div>
            Minting is bound. Redemption never is.
          </div>
          <div style={{ textAlign: "right" }}>
            Creditcoin CC3 · chainId 102031
            <br />
            Block Prover 0x0FD2 · ChainInfo 0x0FD3
          </div>
        </footer>
      </main>

      {scripted && (
        <div className="deck">
          <div className="shell deck-inner">
            <div className="steps" role="group" aria-label="Demo acts">
              {acts.map((a, i) => (
                <button
                  key={a.name}
                  className="step"
                  data-active={i === act}
                  data-done={i < act}
                  onClick={() => setAct(i)}
                  aria-label={`Act ${i + 1}: ${a.name}`}
                  title={a.name}
                />
              ))}
            </div>

            <div className="deck-script">
              <b>
                {act + 1}/{acts.length} · {current.name}
              </b>{" "}
              — {current.script}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setAct(0)} disabled={act === 0}>
                RESET
              </button>
              <button
                className="btn"
                onClick={() => setAct((a) => Math.max(0, a - 1))}
                disabled={act === 0}
              >
                ← PREV
              </button>
              <button
                className="btn"
                data-variant="primary"
                onClick={() => setAct((a) => Math.min(acts.length - 1, a + 1))}
                disabled={act === acts.length - 1}
              >
                NEXT →
              </button>
              <button className="btn" onClick={() => setAutoplay((p) => !p)}>
                {autoplay ? "PAUSE" : "AUTOPLAY"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function KV({ k, v }: { k: string; v?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <span className="label">{k}</span>
      <span className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
        {v ?? "—"}
      </span>
    </div>
  );
}
