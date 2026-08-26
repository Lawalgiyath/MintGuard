import { network } from "hardhat";
import { banner, saveDeployment } from "./lib.js";

/**
 * Deploys the source-chain half: the test asset and the ReserveVault.
 *
 * MIN_SNAPSHOT_GAP defaults to 5 Sepolia blocks (~1 minute). That is only anti-spam;
 * it is not the security parameter. The security parameter is maxStalenessBlocks on the
 * Creditcoin side, and it must comfortably exceed attestation latency (~44 blocks) or
 * minting will be frozen permanently through no fault of anyone.
 */
async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  banner("MintBound — source chain deployment");
  console.log(`network   : ${net.name} (chainId ${net.chainId})`);
  console.log(`deployer  : ${deployer.address}`);
  console.log(`balance   : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  const minSnapshotGap = BigInt(process.env.MIN_SNAPSHOT_GAP ?? "5");
  const withdrawalDelay = BigInt(process.env.WITHDRAWAL_DELAY_BLOCKS ?? "150");

  // The security inequality, enforced at deploy time rather than left to judgement:
  // an announced withdrawal must be provable on Creditcoin before it becomes movable.
  // Measured detection latency is ~57 blocks worst case (44 attestation + 5 snapshot
  // gap + 8 finality margin); we demand 2x that.
  const DETECTION_LATENCY = 57n;
  if (withdrawalDelay < DETECTION_LATENCY * 2n) {
    throw new Error(
      `WITHDRAWAL_DELAY_BLOCKS=${withdrawalDelay} is unsafe. It must exceed 2x detection ` +
        `latency (${DETECTION_LATENCY * 2n} blocks) or a custodian could execute an exit ` +
        `before Creditcoin can prove it was announced.`,
    );
  }

  banner("TestUSD");
  const asset = await ethers.deployContract("TestUSD", ["MintBound Test USD", "mTUSD", 18]);
  await asset.waitForDeployment();
  const assetAddr = await asset.getAddress();
  console.log(`TestUSD   : ${assetAddr}`);

  banner("ReserveVault");
  const vault = await ethers.deployContract("ReserveVault", [minSnapshotGap, withdrawalDelay]);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`Vault     : ${vaultAddr}`);
  console.log(`snapshot gap    : ${minSnapshotGap} blocks`);
  console.log(`withdrawal delay: ${withdrawalDelay} blocks (~${Number(withdrawalDelay) * 12 / 60} min)`);
  console.log(`  -> reserves cannot move without ~${Number(withdrawalDelay) * 12 / 60} min of public warning`);

  banner("Wiring");
  await (await vault.setSupportedAsset(assetAddr, true)).wait();
  console.log("asset registered as supported");

  // Seed the vault and take the genesis snapshot so the Creditcoin side has something
  // to prove immediately after it is deployed.
  const seed = ethers.parseUnits(process.env.SEED_AMOUNT ?? "1000000", 18);
  await (await asset.mint(deployer.address, seed * 2n)).wait();
  await (await asset.approve(vaultAddr, seed)).wait();
  const depositTx = await vault.deposit(assetAddr, seed);
  await depositTx.wait();
  console.log(`seeded vault with ${ethers.formatUnits(seed, 18)} mTUSD (tx ${depositTx.hash})`);

  const snapTx = await vault.snapshotReserves(assetAddr);
  const snapRcpt = await snapTx.wait();
  console.log(`genesis snapshot tx: ${snapTx.hash} (block ${snapRcpt?.blockNumber})`);

  const path = saveDeployment({
    network: "sepolia",
    chainId: Number(net.chainId),
    timestamp: new Date().toISOString(),
    contracts: { TestUSD: assetAddr, ReserveVault: vaultAddr },
    config: {
      minSnapshotGap: Number(minSnapshotGap),
      withdrawalDelayBlocks: Number(withdrawalDelay),
      genesisSnapshotTx: snapTx.hash,
      genesisSnapshotBlock: snapRcpt?.blockNumber ?? 0,
    },
  });

  banner("Done");
  console.log(`written: ${path}`);
  console.log(`\nNext:  npx hardhat run scripts/deploy-creditcoin.ts --network creditcoin`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
