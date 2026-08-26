import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable } from "hardhat/config";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env", quiet: true });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CREDITCOIN_RPC_URL = process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";
const PK = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = PK ? [PK] : [];

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // The Query struct + proof decoding exceeds the legacy pipeline's stack budget.
      // viaIR resolves it and is required for this codebase to build at all.
      viaIR: true,
      // Pinned to shanghai: Creditcoin's EVM does not accept cancun opcodes.
      // This mirrors Gluwa's own foundry.toml. Do not bump.
      evmVersion: "shanghai",
    },
  },
  networks: {
    hardhat: { type: "edr-simulated", chainType: "l1" },
    sepolia: { type: "http", chainType: "l1", url: SEPOLIA_RPC_URL, accounts, chainId: 11155111 },
    creditcoin: { type: "http", chainType: "l1", url: CREDITCOIN_RPC_URL, accounts, chainId: 102031 },
  },
};

export default config;
