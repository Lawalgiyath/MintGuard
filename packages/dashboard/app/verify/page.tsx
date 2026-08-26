import { Verifier } from "@/components/Verifier";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "MintBound — live proof verifier",
  description:
    "Paste any Ethereum Sepolia transaction and watch Creditcoin's native precompile prove it. No wallet, no gas.",
};

export default function Page() {
  return (
    <>
      <div className="mode-rail" data-mode="live" aria-hidden="true" />
      <header className="masthead">
        <div className="shell masthead-inner">
          <div className="wordmark">
            <a href="/" style={{ color: "inherit", textDecoration: "none" }}>
              Mint<span className="mark-bound">Bound</span>
            </a>
            <span className="label" style={{ letterSpacing: "0.16em" }}>live proof verifier</span>
          </div>
          <span className="pill" data-health="proven">
            <span className="dot live" />
            CC3 · 0x0FD2
          </span>
        </div>
      </header>
      <Verifier />
    </>
  );
}
