import { network } from "hardhat";
import { banner, loadDeployment, saveDeployment } from "./lib.js";

const CHAIN_INFO = "0x0000000000000000000000000000000000000fD3";

/**
 * Deploys the Creditcoin half and binds it to the source-chain vault.
 *
 * Before deploying anything it asks the ChainInfo precompile which source chains this
 * network can actually prove against, and refuses to continue if the configured
 * chainKey is not one of them. Deploying an ASC pinned to a chainKey the network cannot
 * attest produces a contract that compiles, deploys, verifies — and can never mint.
 */
async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  banner("MintBound — Creditcoin deployment");
  console.log(`network   : chainId ${net.chainId}`);
  console.log(`deployer  : ${deployer.address}`);
  console.log(`balance   : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} CTC`);

  const src = loadDeployment("sepolia");
  if (!src) throw new Error("No deployments/sepolia.json — run deploy-sepolia.ts first.");

  const vaultAddr = src.contracts.ReserveVault;
  const assetAddr = src.contracts.TestUSD;
  const chainKey = BigInt(process.env.SOURCE_CHAIN_KEY ?? "1");
  const staleness = BigInt(process.env.MAX_STALENESS_BLOCKS ?? "200");
  const haircut = Number(process.env.HAIRCUT_BPS ?? "10000");

  banner("Preflight — is this chainKey actually attested here?");
  const chainInfo = new ethers.Contract(
    CHAIN_INFO,
    [
      "function get_supported_chains() view returns (tuple(uint64 chainKey,uint64 chainId,bytes chainName,uint8 chainEncoding)[])",
      "function get_latest_attestation_height_and_hash(uint64) view returns (tuple(uint64 height,bytes32 hash,bool isAttestation,bool exists))",
    ],
    ethers.provider,
  );

  const chains = await chainInfo.get_supported_chains();
  let matched = false;
  for (const c of chains) {
    const name = ethers.toUtf8String(c.chainName);
    const mark = c.chainKey === chainKey ? "->" : "  ";
    console.log(`${mark} chainKey=${c.chainKey}  chainId=${c.chainId}  ${name}`);
    if (c.chainKey === chainKey) matched = true;
  }
  if (!matched) {
    throw new Error(
      `chainKey ${chainKey} is not attested on this network. Pick one of the keys listed above.`,
    );
  }
  const latest = await chainInfo.get_latest_attestation_height_and_hash(chainKey);
  console.log(`latest attested source height: ${latest.height}`);

  if (src.config?.genesisSnapshotBlock) {
    const g = BigInt(src.config.genesisSnapshotBlock as number);
    const lag = latest.height >= g ? latest.height - g : -1n;
    console.log(
      lag < 0n
        ? `genesis snapshot (block ${g}) is NOT yet attested — the worker will wait.`
        : `genesis snapshot is attested, ${lag} blocks behind the tip.`,
    );
  }

  banner("MintBoundASC");
  const asc = await ethers.deployContract("MintBoundASC", [chainKey, vaultAddr, staleness]);
  await asc.waitForDeployment();
  const ascAddr = await asc.getAddress();
  console.log(`ASC       : ${ascAddr}`);
  console.log(`chainKey  : ${chainKey}`);
  console.log(`vault     : ${vaultAddr}`);
  console.log(`staleness : ${staleness} source blocks`);

  banner("WrappedAsset");
  const wrapped = await ethers.deployContract("WrappedAsset", [
    "MintBound Wrapped Test USD",
    "wmTUSD",
    18,
    ascAddr,
  ]);
  await wrapped.waitForDeployment();
  const wrappedAddr = await wrapped.getAddress();
  console.log(`wrapped   : ${wrappedAddr}  (minter is immutably ${ascAddr})`);

  banner("Registration");
  await (await asc.registerAsset(assetAddr, wrappedAddr, haircut)).wait();
  console.log(`registered ${assetAddr} -> ${wrappedAddr} @ haircut ${haircut} bps`);

  banner("ProvenReserveFeed (Chainlink-compatible)");
  const feed = await ethers.deployContract("ProvenReserveFeed", [
    ascAddr,
    assetAddr,
    18,
    "MintBound Proven Reserve — mTUSD",
  ]);
  await feed.waitForDeployment();
  const feedAddr = await feed.getAddress();
  console.log(`feed      : ${feedAddr}`);
  console.log(`  -> serves AggregatorV3Interface. Any Chainlink Secure Mint integration`);
  console.log(`     can point at this address and keep working, unchanged.`);

  banner("SecureMintReference (unmodified Chainlink pattern, running on our proof)");
  const secureMint = await ethers.deployContract("SecureMintReference", [feedAddr, 3600n]);
  await secureMint.waitForDeployment();
  const secureMintAddr = await secureMint.getAddress();
  console.log(`secureMint: ${secureMintAddr}`);

  banner("ConventionalPoRFeed (divergence demonstration)");
  const conventional = await ethers.deployContract("ConventionalPoRFeed", [
    ascAddr,
    assetAddr,
    18,
    1800n, // 30-minute heartbeat
  ]);
  await conventional.waitForDeployment();
  const conventionalAddr = await conventional.getAddress();
  console.log(`conventional feed: ${conventionalAddr}`);
  console.log(`  -> models report-on-a-heartbeat behaviour (gross, 30 min) for the`);
  console.log(`     dashboard's side-by-side panel. Demonstration only.`);

  banner("SolvencyGatedCredit (integration example)");
  const credit = await ethers.deployContract("SolvencyGatedCredit", [ascAddr, 10_000]);
  await credit.waitForDeployment();
  const creditAddr = await credit.getAddress();
  console.log(`credit    : ${creditAddr}`);

  const path = saveDeployment({
    network: "creditcoin",
    chainId: Number(net.chainId),
    timestamp: new Date().toISOString(),
    contracts: {
      MintBoundASC: ascAddr,
      WrappedAsset: wrappedAddr,
      ProvenReserveFeed: feedAddr,
      ConventionalPoRFeed: conventionalAddr,
      SecureMintReference: secureMintAddr,
      SolvencyGatedCredit: creditAddr,
    },
    config: {
      sourceChainKey: Number(chainKey),
      canonicalVault: vaultAddr,
      sourceAsset: assetAddr,
      maxStalenessBlocks: Number(staleness),
      haircutBps: haircut,
    },
  });

  banner("Done");
  console.log(`written: ${path}`);
  console.log(`explorer: https://creditcoin-testnet.blockscout.com/address/${ascAddr}`);
  console.log(`\nNext:  npm run worker    (then open the dashboard)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
