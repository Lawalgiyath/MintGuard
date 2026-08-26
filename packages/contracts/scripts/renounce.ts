import { network } from "hardhat";
import { banner, loadDeployment } from "./lib.js";

/**
 * Permanently destroys the vault's unannounced-withdrawal path.
 *
 *   npx hardhat run scripts/renounce.ts --network sepolia
 *
 * After this transaction there is NO function on ReserveVault that moves reserves
 * without first announcing the intent and waiting out WITHDRAWAL_DELAY. Not for the
 * owner, not for anyone. There is no setter that turns it back on — the guarantee is
 * enforced by the absence of code, not by a promise.
 *
 * This is the single most important transaction in the deployment, because it converts
 * "the custodian has agreed not to rug" into "the custodian cannot rug without giving
 * roughly thirty minutes of cryptographically provable public warning." A reviewer can
 * verify it from the chain: `emergencyEnabled()` returns false, forever.
 *
 * It is deliberately a separate, explicit script rather than part of deployment, so the
 * before/after can be demonstrated on a real chain.
 */
async function main() {
  const { ethers } = await network.connect();
  const [signer] = await ethers.getSigners();

  const src = loadDeployment("sepolia");
  if (!src) throw new Error("No deployments/sepolia.json — deploy first.");

  const vaultAddr = src.contracts.ReserveVault;
  const vault = await ethers.getContractAt("ReserveVault", vaultAddr);

  banner("MintBound — renounce the escape hatch");
  console.log(`vault    : ${vaultAddr}`);
  console.log(`signer   : ${signer.address}`);

  const before = await vault.emergencyEnabled();
  const delay = await vault.WITHDRAWAL_DELAY();
  console.log(`\nemergencyEnabled (before) : ${before}`);
  console.log(`withdrawal delay          : ${delay} blocks (~${(Number(delay) * 12) / 60} min)`);

  if (!before) {
    console.log("\nAlready renounced. There is no unannounced withdrawal path. Nothing to do.");
    return;
  }

  console.log("\nThis is irreversible. After it lands:");
  console.log("  - emergencyWithdraw() reverts permanently with EmergencyDisabled()");
  console.log("  - every outflow must be announced and timelocked");
  console.log("  - no owner action can restore the unannounced path\n");

  const tx = await vault.renounceEmergencyWithdrawal();
  console.log(`submitted: ${tx.hash}`);
  const rcpt = await tx.wait();

  const after = await vault.emergencyEnabled();
  banner("Done");
  console.log(`emergencyEnabled (after)  : ${after}`);
  console.log(`block                     : ${rcpt?.blockNumber}`);
  console.log(`etherscan                 : https://sepolia.etherscan.io/tx/${tx.hash}`);

  if (after) {
    console.error("\nRenounce did not take effect. Investigate before presenting this.");
    process.exitCode = 1;
  } else {
    console.log("\nThe rug function no longer exists. Reserves cannot move without warning.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
