import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Standalone configuration.
 *
 * Everything here has a working default. That is deliberate: the whole point of this
 * CLI is that a stranger can run it against the live deployment without cloning the
 * repo, funding a wallet, or obtaining a key. If you are running inside the repo the
 * deployment files are picked up automatically and override the baked-in addresses.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const RPC = {
  creditcoin: process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",
  sepolia: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
  proofBuilder:
    process.env.PROOF_BUILDER_URL ?? "https://proof-gen-api.cc3-testnet.creditcoin.network",
};

export const EXPLORER = {
  creditcoin: "https://creditcoin-testnet.blockscout.com",
  sepolia: "https://sepolia.etherscan.io",
};

/** The live CC3 deployment, as of the addresses committed to this repo. */
const BAKED = {
  creditcoin: {
    chainId: 102031,
    contracts: {
      MintBoundASC: "0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8",
      WrappedAsset: "0x1f42B80ebac56AF3f023997A4240D3B97476A557",
      ProvenReserveFeed: "0x5578784ddE6c05c0370119FF68c439847CB307D7",
      ConventionalPoRFeed: "0xbAceA461241F5D9D27e2308D279AB1add95B226F",
      SecureMintReference: "0x8f2A246623b000DE0486242f8806b0dDeF2375b9",
      SolvencyGatedCredit: "0x44082286d90ebB087F34EE4Bc6Bd918B205d7156",
      SolvencyContinuity: "0x448292774b807B49025002e256d004378f788d07",
    },
    config: {
      sourceChainKey: 1,
      canonicalVault: "0x1f42B80ebac56AF3f023997A4240D3B97476A557",
      sourceAsset: "0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8",
      maxStalenessBlocks: 200,
      haircutBps: 10000,
    },
  },
  sepolia: {
    chainId: 11155111,
    contracts: {
      TestUSD: "0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8",
      ReserveVault: "0x1f42B80ebac56AF3f023997A4240D3B97476A557",
      SupplyBeacon: "0x448292774b807B49025002e256d004378f788d07",
    },
  },
} as const;

export interface Deployment {
  chainId: number;
  contracts: Record<string, string>;
  config?: Record<string, string | number>;
}

/**
 * Prefer an on-disk deployment record when one exists, so that a fresh redeploy is
 * picked up without editing this file. Fall back to the baked-in addresses otherwise.
 */
function load(name: "creditcoin" | "sepolia"): Deployment {
  for (const root of [join(here, "..", "..", ".."), join(here, "..", "..", "..", "..")]) {
    const p = join(root, "deployments", `${name}.json`);
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")) as Deployment;
      } catch {
        // A malformed local file should not defeat a working default.
      }
    }
  }
  return BAKED[name] as unknown as Deployment;
}

export const creditcoin = () => load("creditcoin");
export const sepolia = () => load("sepolia");

export const CHAIN_INFO_ADDRESS = "0x0000000000000000000000000000000000000fD3";
export const BLOCK_PROVER_ADDRESS = "0x0000000000000000000000000000000000000FD2";
