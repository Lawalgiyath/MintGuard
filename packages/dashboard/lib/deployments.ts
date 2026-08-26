import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-side access to deployment artefacts.
 *
 * Read at request time rather than imported at build time, so redeploying the contracts
 * does not require rebuilding the dashboard — during a hackathon the contracts move far
 * more often than the UI does.
 */

export interface Deployment {
  network: string;
  chainId: number;
  timestamp: string;
  contracts: Record<string, string>;
  config?: Record<string, string | number>;
}

const ROOT = join(process.cwd(), "..", "..");
const DEPLOYMENTS_DIR = process.env.DEPLOYMENTS_DIR ?? join(ROOT, "deployments");

function read(name: string): Deployment | undefined {
  const p = join(DEPLOYMENTS_DIR, `${name}.json`);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Deployment;
  } catch {
    return undefined;
  }
}

export const sepolia = () => read("sepolia");
export const creditcoin = () => read("creditcoin");

export function replayBundle(): unknown[] {
  const p = join(DEPLOYMENTS_DIR, "replay-bundle.json");
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as unknown[];
  } catch {
    return [];
  }
}

export const rpc = {
  creditcoin: process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",
  sepolia: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
};

export const EXPLORER = {
  creditcoin: "https://creditcoin-testnet.blockscout.com",
  sepolia: "https://sepolia.etherscan.io",
};
