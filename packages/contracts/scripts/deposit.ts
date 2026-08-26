import { network } from "hardhat";
import { banner, loadDeployment } from "./lib.js";

/**
 * Lock reserve on the source chain, authorising exactly one mint on Creditcoin.
 *
 *   npx hardhat run scripts/deposit.ts --network sepolia
 *
 * The running worker sees the resulting `Locked` event, waits for attestation, generates
 * an inclusion proof and calls mintWithProof. Nothing here grants any authority — the
 * deposit is only an authorisation, and the mint still has to clear the aggregate bound
 * against a fresh reserve proof.
 */
async function main() {
  const { ethers } = await network.connect();
  const [signer] = await ethers.getSigners();

  const sep = loadDeployment("sepolia");
  if (!sep) throw new Error("Deploy the Sepolia half first.");

  const assetAddr = sep.contracts.TestUSD;
  const vaultAddr = sep.contracts.ReserveVault;
  const amount = ethers.parseUnits(process.env.DEPOSIT_AMOUNT ?? "25000", 18);

  const asset = await ethers.getContractAt("TestUSD", assetAddr);
  const vault = await ethers.getContractAt("ReserveVault", vaultAddr);

  banner("MintBound — deposit");
  console.log(`depositor : ${signer.address}`);
  console.log(`amount    : ${ethers.formatUnits(amount, 18)} mTUSD`);
  console.log(`vault     : ${vaultAddr}`);

  const bal = await asset.balanceOf(signer.address);
  if (bal < amount) {
    console.log(`\nminting ${ethers.formatUnits(amount - bal, 18)} test tokens first…`);
    await (await asset.mint(signer.address, amount - bal)).wait();
  }

  await (await asset.approve(vaultAddr, amount)).wait();

  const tx = await vault.deposit(assetAddr, amount);
  const rcpt = await tx.wait();

  const ev = rcpt?.logs.find((l: any) => l.fragment?.name === "Locked") as any;

  banner("Locked");
  console.log(`tx        : ${tx.hash}`);
  console.log(`block     : ${rcpt?.blockNumber}`);
  console.log(`gas       : ${rcpt?.gasUsed}`);
  if (ev) console.log(`nonce     : ${ev.args.nonce}`);
  console.log(`vault now : ${ethers.formatUnits(await asset.balanceOf(vaultAddr), 18)} mTUSD`);
  console.log(`\netherscan : https://sepolia.etherscan.io/tx/${tx.hash}`);
  console.log("\nThe worker will prove this once Creditcoin attests the block (~9 min).");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
