import { Contract, JsonRpcProvider } from "ethers";
import { ASC_ABI, ASC_ERRORS, CHAIN_INFO_ABI, CONTINUITY_ABI, ERC20_ABI, VAULT_ABI } from "./abi.js";
import { CHAIN_INFO_ADDRESS, RPC, creditcoin, sepolia } from "./config.js";
import type { AssuranceInput } from "./assurance.js";

export interface LiveState {
  asc: string;
  vault: string;
  sourceAsset: string;
  wrapped: string;
  sourceChainKey: number;
  symbol: string;
  decimals: number;

  verifiedReserve: bigint;
  encumberedReserve: bigint;
  outstandingSupply: bigint;
  discountedReserve: bigint;
  maxMintable: bigint;
  collateralRatioBps: number;
  haircutBps: number;
  epoch: number;
  attestedAtHeight: number;
  latestAttestedHeight: number;
  stalenessBlocks: number;
  maxStalenessBlocks: number;
  trustedParties: number;
  fresh: boolean;
  solvent: boolean;
  mintFrozen: boolean;

  sourceHead: number;
  vaultBalance: bigint;
  vaultEncumbered: bigint;
  emergencyEnabled: boolean;
  withdrawalDelayBlocks: number;

  coveredThrough: number;
  anchorHeight: number;
  registeredChains: number;
  reportingChains: number;
}

export function providers() {
  return {
    cc: new JsonRpcProvider(RPC.creditcoin, undefined, { staticNetwork: true }),
    sep: new JsonRpcProvider(RPC.sepolia, undefined, { staticNetwork: true }),
  };
}

/** Any read that is context rather than part of the invariant may fail softly. */
async function soft<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function readLive(): Promise<LiveState> {
  const cc = creditcoin();
  const sep = sepolia();
  const { cc: ccProvider, sep: sepProvider } = providers();

  const ascAddr = cc.contracts.MintBoundASC;
  const wrapped = cc.contracts.WrappedAsset;
  const sourceAsset = String(cc.config?.sourceAsset ?? sep.contracts.TestUSD);
  const vaultAddr = String(cc.config?.canonicalVault ?? sep.contracts.ReserveVault);
  const sourceChainKey = Number(cc.config?.sourceChainKey ?? 1);

  const asc = new Contract(ascAddr, [...ASC_ABI, ...ASC_ERRORS] as unknown as string[], ccProvider);
  const vault = new Contract(vaultAddr, VAULT_ABI as unknown as string[], sepProvider);
  const asset = new Contract(sourceAsset, ERC20_ABI as unknown as string[], sepProvider);
  const wrapper = new Contract(wrapped, ERC20_ABI as unknown as string[], ccProvider);
  const info = new Contract(CHAIN_INFO_ADDRESS, CHAIN_INFO_ABI as unknown as string[], ccProvider);

  const r: any = await asc.solvencyReport!(sourceAsset);
  const maxStaleness = Number(await asc.maxStalenessBlocks!());

  const [symbol, decimals] = await Promise.all([
    soft(wrapper.symbol!() as Promise<string>, "wmTUSD"),
    soft(wrapper.decimals!().then(Number) as Promise<number>, 18),
  ]);

  const [sourceHead, vaultBalance, vaultEncumbered, emergencyEnabled, delay] = await Promise.all([
    soft(sepProvider.getBlockNumber(), 0),
    soft(asset.balanceOf!(vaultAddr) as Promise<bigint>, 0n),
    soft(vault.encumbered!(sourceAsset) as Promise<bigint>, 0n),
    soft(vault.emergencyEnabled!() as Promise<boolean>, true),
    soft(vault.WITHDRAWAL_DELAY!().then(Number) as Promise<number>, 0),
  ]);

  // Continuity is an optional module; a deployment without it simply scores zero on
  // that obligation rather than failing the whole read.
  let coveredThrough = 0;
  let anchorHeight = 0;
  if (cc.contracts.SolvencyContinuity) {
    const cont = new Contract(
      cc.contracts.SolvencyContinuity,
      CONTINUITY_ABI as unknown as string[],
      ccProvider,
    );
    coveredThrough = await soft(cont.coveredThrough!(sourceAsset).then(Number) as Promise<number>, 0);
    anchorHeight = await soft(cont.anchorHeight!(sourceAsset).then(Number) as Promise<number>, 0);
  }

  // remoteChainKeys is an unbounded public array getter; probe until it reverts.
  let registeredChains = 0;
  for (let i = 0; i < 32; i++) {
    try {
      await asc.remoteChainKeys!(sourceAsset, i);
      registeredChains++;
    } catch {
      break;
    }
  }

  // A registered chain counts as reporting when its proven supply contributes to the
  // aggregate. If totalLiabilities reverts the aggregate cannot be formed at all, which
  // is exactly the freeze condition, so report zero coverage rather than guessing.
  const liabilities = await soft(asc.totalLiabilities!(sourceAsset) as Promise<bigint>, -1n);
  const reportingChains = liabilities >= 0n ? registeredChains : 0;

  const verifiedReserve = BigInt(r.verifiedReserve);
  const encumberedReserve = BigInt(r.encumberedReserve);
  const haircutBps = Number(r.haircutBps);
  const unencumbered =
    verifiedReserve > encumberedReserve ? verifiedReserve - encumberedReserve : 0n;

  const latestAttested = Number(r.latestAttestedHeight);

  return {
    asc: ascAddr,
    vault: vaultAddr,
    sourceAsset,
    wrapped,
    sourceChainKey,
    symbol,
    decimals,

    verifiedReserve,
    encumberedReserve,
    outstandingSupply: BigInt(r.outstandingSupply),
    // Mirrors MintBoundASC._effectiveReserve exactly: announced exits come off BEFORE
    // the haircut. Displaying it any other way would let the readout and the
    // enforcement disagree.
    discountedReserve: (unencumbered * BigInt(haircutBps)) / 10000n,
    maxMintable: BigInt(r.maxMintable),
    collateralRatioBps: Number(r.collateralRatioBps),
    haircutBps,
    epoch: Number(r.epoch),
    attestedAtHeight: Number(r.attestedAtHeight),
    latestAttestedHeight: latestAttested,
    stalenessBlocks: Number(r.stalenessBlocks),
    maxStalenessBlocks: maxStaleness,
    trustedParties: Number(r.trustedParties),
    fresh: Boolean(r.fresh),
    solvent: Boolean(r.solvent),
    mintFrozen: Boolean(r.mintFrozen),

    sourceHead,
    vaultBalance,
    vaultEncumbered,
    emergencyEnabled,
    withdrawalDelayBlocks: delay,

    coveredThrough,
    anchorHeight,
    registeredChains,
    reportingChains,
  };
}

export function toAssuranceInput(s: LiveState): AssuranceInput {
  return {
    trustedParties: s.trustedParties,
    fresh: s.fresh,
    stalenessBlocks: s.stalenessBlocks,
    maxStalenessBlocks: s.maxStalenessBlocks,
    withdrawalDelayBlocks: s.withdrawalDelayBlocks,
    // Detection latency is the live gap between the source tip and what Creditcoin has
    // attested. Measured, not assumed — it moves, and the margin has to hold against
    // whatever it actually is right now.
    detectionLatencyBlocks: Math.max(s.sourceHead - s.latestAttestedHeight, 0),
    registeredChains: s.registeredChains,
    reportingChains: s.reportingChains,
    coveredThrough: s.coveredThrough,
    anchorHeight: s.anchorHeight,
    emergencyRenounced: !s.emergencyEnabled,
  };
}
