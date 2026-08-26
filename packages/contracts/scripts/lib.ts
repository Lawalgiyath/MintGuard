import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEPLOYMENTS_DIR = join(here, "..", "..", "..", "deployments");

export interface Deployment {
  network: string;
  chainId: number;
  timestamp: string;
  contracts: Record<string, string>;
  config?: Record<string, string | number>;
}

export function loadDeployment(network: string): Deployment | undefined {
  const p = join(DEPLOYMENTS_DIR, `${network}.json`);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf8")) as Deployment;
}

export function saveDeployment(d: Deployment): string {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const p = join(DEPLOYMENTS_DIR, `${d.network}.json`);
  writeFileSync(p, JSON.stringify(d, null, 2) + "\n", "utf8");
  return p;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export function banner(title: string) {
  const line = "─".repeat(Math.max(0, 64 - title.length));
  console.log(`\n── ${title} ${line}`);
}
