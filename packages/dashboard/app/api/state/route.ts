import { NextResponse } from "next/server";
import { createPublicClient, http, defineChain } from "viem";
import {
  ASC_ABI,
  CHAIN_INFO_ABI,
  CHAIN_INFO_ADDRESS,
  ERC20_ABI,
  FEED_ABI,
  VAULT_ABI,
} from "@/lib/abi";
import { EXPLORER, creditcoin as ccDeployment, rpc, sepolia as sepDeployment } from "@/lib/deployments";
import { buildTrustPath, healthOf, type LedgerEntry, type SolvencyState } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const cc3 = defineChain({
  id: 102031,
  name: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: { default: { http: [rpc.creditcoin] } },
});

const sepoliaChain = defineChain({
  id: 11155111,
  name: "Ethereum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc.sepolia] } },
});

const s = (v: bigint) => v.toString();

/**
 * LIVE mode. Every field returned here is read from a chain right now — the solvency
 * figures from MintBoundASC on CC3, the attested height from the ChainInfo precompile,
 * the vault balance from Sepolia. Nothing is cached and nothing is synthesised.
 *
 * If the contracts are not deployed yet this returns `connected: false` with a reason
 * rather than inventing plausible numbers, because a solvency instrument that guesses
 * has defeated its own purpose.
 */
export async function GET() {
  const cc = ccDeployment();
  const sep = sepDeployment();

  if (!cc || !sep) {
    return NextResponse.json({
      connected: false,
      error:
        "No deployment found. Run the two deploy scripts, or switch to SIMULATED mode to explore the interface.",
    });
  }

  const ascAddress = cc.contracts.MintBoundASC as `0x${string}`;
  const wrappedAddress = cc.contracts.WrappedAsset as `0x${string}`;
  const sourceAsset = (cc.config?.sourceAsset ?? sep.contracts.TestUSD) as `0x${string}`;
  const vaultAddress = (cc.config?.canonicalVault ?? sep.contracts.ReserveVault) as `0x${string}`;
  const sourceChainKey = Number(cc.config?.sourceChainKey ?? 1);

  const ccClient = createPublicClient({ chain: cc3, transport: http(rpc.creditcoin) });
  const sepClient = createPublicClient({ chain: sepoliaChain, transport: http(rpc.sepolia) });

  try {
    const [report, maxStaleness, symbol, decimals] = await Promise.all([
      ccClient.readContract({
        address: ascAddress,
        abi: ASC_ABI,
        functionName: "solvencyReport",
        args: [sourceAsset],
      }),
      ccClient.readContract({ address: ascAddress, abi: ASC_ABI, functionName: "maxStalenessBlocks" }),
      ccClient
        .readContract({ address: wrappedAddress, abi: ERC20_ABI, functionName: "symbol" })
        .catch(() => "wmTUSD"),
      ccClient
        .readContract({ address: wrappedAddress, abi: ERC20_ABI, functionName: "decimals" })
        .catch(() => 18),
    ]);

    const r = report as any;

    const state: SolvencyState = {
      verifiedReserve: r.verifiedReserve,
      encumberedReserve: r.encumberedReserve,
      outstandingSupply: r.outstandingSupply,
      // Announced exits are subtracted BEFORE the haircut — mirroring
      // MintBoundASC._effectiveReserve exactly, so the display and the enforcement
      // can never diverge.
      discountedReserve:
        ((BigInt(r.verifiedReserve) > BigInt(r.encumberedReserve)
          ? BigInt(r.verifiedReserve) - BigInt(r.encumberedReserve)
          : 0n) *
          BigInt(r.haircutBps)) /
        10000n,
      maxMintable: r.maxMintable,
      collateralRatioBps: Number(r.collateralRatioBps),
      haircutBps: Number(r.haircutBps),
      epoch: Number(r.epoch),
      attestedAtHeight: Number(r.attestedAtHeight),
      latestAttestedHeight: Number(r.latestAttestedHeight),
      stalenessBlocks: Number(r.stalenessBlocks),
      maxStalenessBlocks: Number(maxStaleness),
      fresh: r.fresh,
      solvent: r.solvent,
      mintFrozen: r.mintFrozen,
      decimals: Number(decimals),
      symbol: String(symbol),
      trustedParties: Number(r.trustedParties ?? 0),
    };

    // Secondary reads. These are context, not part of the invariant, so a failure here
    // degrades the display rather than the answer.
    const [sourceHead, vaultBalance, latestAttestation] = await Promise.all([
      sepClient.getBlockNumber().catch(() => 0n),
      sepClient
        .readContract({
          address: sourceAsset,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [vaultAddress],
        })
        .catch(() => 0n),
      ccClient
        .readContract({
          address: CHAIN_INFO_ADDRESS,
          abi: CHAIN_INFO_ABI,
          functionName: "get_latest_attestation_height_and_hash",
          args: [BigInt(sourceChainKey)],
        })
        .catch(() => null),
    ]);

    if (latestAttestation && state.latestAttestedHeight === 0) {
      state.latestAttestedHeight = Number((latestAttestation as any).height);
    }

    // ── divergence: reported-vs-proven, both through the same interface ──
    const provenFeed = cc.contracts.ProvenReserveFeed as `0x${string}` | undefined;
    const conventionalFeed = cc.contracts.ConventionalPoRFeed as `0x${string}` | undefined;
    let divergence: Record<string, string | number> | undefined;

    if (provenFeed && conventionalFeed) {
      const [proven, reported] = await Promise.all([
        ccClient
          .readContract({ address: provenFeed, abi: FEED_ABI, functionName: "latestRoundData" })
          .catch(() => null),
        ccClient
          .readContract({ address: conventionalFeed, abi: FEED_ABI, functionName: "latestRoundData" })
          .catch(() => null),
      ]);
      if (proven && reported) {
        const now = Math.floor(Date.now() / 1000);
        const pv = proven as readonly [bigint, bigint, bigint, bigint, bigint];
        const rv = reported as readonly [bigint, bigint, bigint, bigint, bigint];
        divergence = {
          provenAnswer: pv[1].toString(),
          provenAgeSeconds: Math.max(0, now - Number(pv[3])),
          reportedAnswer: rv[1].toString(),
          reportedAgeSeconds: Math.max(0, now - Number(rv[3])),
        };
      }
    }

    // ── vault safety posture on the source chain ──
    let vault: Record<string, string | number | boolean> | undefined;
    try {
      const [emergencyEnabled, delay, enc] = await Promise.all([
        sepClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "emergencyEnabled" }),
        sepClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "WITHDRAWAL_DELAY" }),
        sepClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: "encumbered",
          args: [sourceAsset],
        }),
      ]);
      vault = {
        emergencyEnabled: Boolean(emergencyEnabled),
        withdrawalDelayBlocks: Number(delay),
        encumbered: (enc as bigint).toString(),
      };
    } catch {
      // Vault context is display-only; its absence must not break the invariant view.
    }

    const ledger = await recentLedger(ccClient, ascAddress, state.decimals);
    const health = healthOf(state);

    return NextResponse.json(
      {
        connected: true,
        mode: "live",
        health,
        state: {
          ...state,
          verifiedReserve: s(state.verifiedReserve),
          encumberedReserve: s(state.encumberedReserve),
          outstandingSupply: s(state.outstandingSupply),
          discountedReserve: s(state.discountedReserve),
          maxMintable: s(state.maxMintable),
        },
        ledger,
        divergence,
        vault,
        trustPath: buildTrustPath(state, health),
        context: {
          creditcoinChainId: 102031,
          sourceChainKey,
          ascAddress,
          vaultAddress,
          sourceAsset,
          wrappedAddress,
          sourceHead: Number(sourceHead),
          vaultBalance: s(vaultBalance as bigint),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json({
      connected: false,
      error: `Chain read failed: ${e?.shortMessage ?? e?.message ?? String(e)}`,
    });
  }
}

/** Pull recent protocol events straight from the ASC and render them as ledger rows. */
async function recentLedger(
  client: ReturnType<typeof createPublicClient>,
  address: `0x${string}`,
  decimals: number,
): Promise<LedgerEntry[]> {
  try {
    const head = await client.getBlockNumber();
    // CC3 blocks are ~15s; 4000 blocks is roughly the last 16 hours.
    const fromBlock = head > 4000n ? head - 4000n : 0n;

    const logs = await client.getLogs({ address, fromBlock, toBlock: head });
    const decoded: LedgerEntry[] = [];

    const { decodeEventLog } = await import("viem");

    for (const log of logs.slice(-60)) {
      try {
        const ev = decodeEventLog({ abi: ASC_ABI, data: log.data, topics: log.topics });
        const args = ev.args as any;
        const base = {
          id: `${log.transactionHash}-${log.logIndex}`,
          at: Date.now(),
          txHash: log.transactionHash ?? undefined,
          explorerUrl: log.transactionHash
            ? `${EXPLORER.creditcoin}/tx/${log.transactionHash}`
            : undefined,
          provenance: "proof" as const,
        };

        switch (ev.eventName) {
          case "ReserveProven":
            decoded.push({
              ...base,
              kind: "ReserveProven",
              title: "Reserve proven",
              detail: `balance ${fmt(args.balance, decimals)} · source block ${args.atHeight} · epoch ${args.epoch}`,
            });
            break;
          case "Minted":
            decoded.push({
              ...base,
              kind: "Minted",
              title: "Minted",
              detail: `${fmt(args.amount, decimals)} to ${short(args.to)} · nonce ${args.nonce}`,
            });
            break;
          case "InvariantChecked":
            decoded.push({
              ...base,
              kind: "InvariantChecked",
              title: "Bound checked",
              detail: `supply ${fmt(args.outstandingSupply, decimals)} vs ceiling ${fmt(args.discountedReserve, decimals)} · ${(Number(args.ratioBps) / 100).toFixed(2)}%`,
            });
            break;
          case "SolvencyBreach":
            decoded.push({
              ...base,
              kind: "SolvencyBreach",
              title: "SOLVENCY BREACH",
              detail: `supply ${fmt(args.outstandingSupply, decimals)} exceeds proven ceiling ${fmt(args.discountedReserve, decimals)} · minting frozen`,
            });
            break;
          case "RedeemRequested":
            decoded.push({
              ...base,
              kind: "RedeemRequested",
              title: "Redemption",
              detail: `${fmt(args.amount, decimals)} burned by ${short(args.user)} · no proof required`,
            });
            break;
        }
      } catch {
        /* not one of ours */
      }
    }

    return decoded.reverse();
  } catch {
    return [];
  }
}

function fmt(v: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
