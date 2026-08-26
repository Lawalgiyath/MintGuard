"use client";

import { blocksToDuration, formatClock, formatUnits, shortHash } from "@/lib/format";
import type { DashboardSnapshot, LedgerEntry, SolvencyState, TrustStep } from "@/lib/types";

/* ── Stat grid ────────────────────────────────────────────────────────────── */

export function StatGrid({ snap }: { snap: DashboardSnapshot }) {
  const s: SolvencyState = snap.state;

  const freshSignal = s.attestedAtHeight === 0 ? undefined : s.fresh ? "proof" : "stale";

  return (
    <div className="stats">
      <Stat
        label="Verified reserve"
        value={formatUnits(s.verifiedReserve, s.decimals)}
        sub={
          s.attestedAtHeight
            ? `proven at source block ${s.attestedAtHeight.toLocaleString()}`
            : "no reserve proof yet"
        }
        signal={s.attestedAtHeight ? "proof" : undefined}
      />
      <Stat
        label="Outstanding supply"
        value={formatUnits(s.outstandingSupply, s.decimals)}
        sub={`liabilities · ${s.symbol}`}
      />
      {s.encumberedReserve > 0n && (
        <Stat
          label="Announced exits"
          value={formatUnits(s.encumberedReserve, s.decimals)}
          sub="withdrawal announced — already excluded from backing"
          signal="stale"
        />
      )}
      <Stat
        label="Headroom"
        value={formatUnits(s.maxMintable, s.decimals)}
        sub={s.mintFrozen ? "minting frozen" : "mintable before the bound"}
        signal={s.mintFrozen ? "breach" : undefined}
      />
      <Stat
        label="Freshness"
        value={`${s.stalenessBlocks} / ${s.maxStalenessBlocks}`}
        sub={
          s.attestedAtHeight === 0
            ? "awaiting first proof"
            : s.fresh
              ? `${blocksToDuration(s.stalenessBlocks)} old · within window`
              : "outside window · minting halted"
        }
        signal={freshSignal}
      />
      <Stat
        label="Epoch"
        value={`#${s.epoch}`}
        sub="monotonic · blocks stale-snapshot replay"
      />
      <Stat
        label="Attested source height"
        value={s.latestAttestedHeight ? s.latestAttestedHeight.toLocaleString() : "—"}
        sub="read on-chain from ChainInfo 0x0FD3"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  signal,
}: {
  label: string;
  value: string;
  sub: string;
  signal?: "proof" | "breach" | "stale";
}) {
  return (
    <div className="stat" data-signal={signal}>
      <div className="label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

/* ── Trust path ───────────────────────────────────────────────────────────── */

const MARK: Record<TrustStep["status"], string> = {
  proven: "✓",
  enforced: "✓",
  pending: "·",
  failed: "✕",
};

export function TrustPath({ steps, trustedParties }: { steps: TrustStep[]; trustedParties?: number }) {
  // Read from the contract when available, so the headline number is a chain
  // reading rather than a claim baked into the UI.
  const total = trustedParties ?? steps.reduce((n, s) => n + s.trustedParties, 0);

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <div className="label">Nothing taken on trust</div>
          <div style={{ fontSize: 13, marginTop: 5, color: "var(--ink-2)" }}>
            The full mint authorization path
          </div>
        </div>
      </header>

      {steps.map((s) => (
        <div className="trust-row" data-status={s.status} key={s.label}>
          <span className="trust-mark" aria-hidden="true">
            {MARK[s.status]}
          </span>
          <div>
            <div className="trust-label">{s.label}</div>
            <div className="trust-mech">{s.mechanism}</div>
          </div>
          <span className="trust-badge">{s.status.toUpperCase()}</span>
        </div>
      ))}

      <div className="trust-total">
        <div>
          <div className="label">Trusted reporters in this path</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6, maxWidth: "34ch" }}>
            {total === 0
              ? "No DON, no multisig, no relayer, no custodian, no heartbeat."
              : "This asset is oracle-reported. MintBound says so rather than implying it is proven."}
          </div>
        </div>
        <div className="trust-total-value">{total}</div>
      </div>
    </section>
  );
}

/* ── Proof ledger ─────────────────────────────────────────────────────────── */

export function ProofLedger({ entries, mode }: { entries: LedgerEntry[]; mode: string }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <div className="label">Proof ledger</div>
          <div style={{ fontSize: 13, marginTop: 5, color: "var(--ink-2)" }}>
            {mode === "live" ? "Events read from Creditcoin" : "Scripted demo events"}
          </div>
        </div>
        <span className="label">{entries.length} entries</span>
      </header>

      <div className="ledger">
        {entries.length === 0 && (
          <div style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>
            No protocol events yet. Once a reserve is proven or a mint clears, it appears here.
          </div>
        )}

        {entries.map((e) => (
          <div className="ledger-row" data-kind={e.kind} key={e.id}>
            <span className="ledger-time">{formatClock(e.at)}</span>
            <span className="ledger-mark" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="ledger-title">
                {e.title}
                {e.held && <span className="tag held">BOUND HELD</span>}
                <span className="tag" data-p={e.provenance}>
                  {e.provenance.toUpperCase()}
                </span>
              </div>
              <div className="ledger-detail">
                {e.detail}
                {e.explorerUrl && (
                  <>
                    {" · "}
                    <a
                      href={e.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--ink-2)" }}
                    >
                      {shortHash(e.txHash)}
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
