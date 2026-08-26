import { network } from "hardhat";
import { banner, loadDeployment, saveDeployment } from "./lib.js";

/**
 * Deploys the two modules added after the original scripts were written:
 *
 *   SupplyBeacon        (source chain)  — publishes remote wrapped supply for the
 *                                         cross-chain liability half of the invariant
 *   SolvencyContinuity  (Creditcoin)    — bonded interval attestation, so reserve
 *                                         continuity is proven between snapshots
 *
 * Run once per chain:
 *   npx hardhat run scripts/deploy-modules.ts --network sepolia
 *   npx hardhat run scripts/deploy-modules.ts --network creditcoin
 */
async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const sep = loadDeployment("sepolia");
  const cc = loadDeployment("creditcoin");
  if (!sep) throw new Error("Deploy the Sepolia half first.");

  if (chainId === 11155111) {
    banner("SupplyBeacon (Sepolia)");
    if (!cc) throw new Error("Deploy the Creditcoin half first — the beacon reports its supply.");

    // On testnet the beacon watches the wrapped token as a stand-in for a second
    // issuance chain. In production one beacon is deployed per chain the asset lives on.
    const beacon = await ethers.deployContract("SupplyBeacon", [cc.contracts.WrappedAsset, 5n]);
    await beacon.waitForDeployment();
    const addr = await beacon.getAddress();
    console.log(`beacon  : ${addr}`);
    console.log(`watching: ${cc.contracts.WrappedAsset}`);

    saveDeployment({
      ...sep,
      timestamp: new Date().toISOString(),
      contracts: { ...sep.contracts, SupplyBeacon: addr },
    });
    console.log("\nrecorded in deployments/sepolia.json");
    return;
  }

  if (chainId === 102031) {
    banner("SolvencyContinuity (Creditcoin)");
    if (!cc) throw new Error("Deploy the Creditcoin half first.");

    const minBond = ethers.parseEther(process.env.CONTINUITY_MIN_BOND ?? "1");
    const liveness = BigInt(process.env.CONTINUITY_LIVENESS ?? "3600"); // 1 hour floor

    const cont = await ethers.deployContract("SolvencyContinuity", [
      cc.contracts.MintBoundASC,
      BigInt(cc.config?.sourceChainKey ?? 1),
      cc.config?.canonicalVault ?? sep.contracts.ReserveVault,
      minBond,
      liveness,
    ]);
    await cont.waitForDeployment();
    const addr = await cont.getAddress();

    console.log(`continuity: ${addr}`);
    console.log(`min bond  : ${ethers.formatEther(minBond)} CTC`);
    console.log(`liveness  : ${liveness}s`);
    console.log(`  -> a bonded claim that no reserve left the vault across a height range,`);
    console.log(`     refutable by anyone with one inclusion proof. Bond pays the refuter.`);

    saveDeployment({
      ...cc,
      timestamp: new Date().toISOString(),
      contracts: { ...cc.contracts, SolvencyContinuity: addr },
    });
    console.log("\nrecorded in deployments/creditcoin.json");
    console.log(`explorer: https://creditcoin-testnet.blockscout.com/address/${addr}`);
    return;
  }

  throw new Error(`Unexpected chainId ${chainId}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
