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

  // Creditcoin CC3 is not in Hardhat's built-in chain registry, so the explorer has to
  // be described before `hardhat verify` can reach it. Endpoint confirmed live against
  // module=contract&action=getsourcecode.
  chainDescriptors: {
    102031: {
      name: "Creditcoin CC3 Testnet",
      blockExplorers: {
        blockscout: {
          name: "Blockscout",
          url: "https://creditcoin-testnet.blockscout.com",
          apiUrl: "https://creditcoin-testnet.blockscout.com/api",
        },
      },
    },
  },

  // Publishing source is not cosmetic here. This project's entire claim is that you do
  // not have to trust us — and an unverified contract is a claim you cannot check. A
  // judge clicking through to raw bytecode has been handed an assertion, not evidence.
  verify: {
    blockscout: { enabled: true },
    etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "", enabled: true },
    // Sourcify needs no API key, which matters: anyone cloning this repo can republish
    // source for their own Sepolia deployment without first obtaining credentials.
    sourcify: { enabled: true },
  },
};

export default config;
