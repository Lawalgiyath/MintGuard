import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..", "..");
export const DEPLOYMENTS_DIR = join(ROOT, "deployments");

dotenv.config({ path: join(ROOT, ".env"), quiet: true });

export interface Deployment {
  network: string;
  chainId: number;
  timestamp: string;
  contracts: Record<string, string>;
  config?: Record<string, string | number>;
}

function load(name: string): Deployment {
  const p = join(DEPLOYMENTS_DIR, `${name}.json`);
  if (!existsSync(p)) {
    throw new Error(
      `Missing ${p}.\nDeploy first:\n` +
        `  npx hardhat run scripts/deploy-sepolia.ts --network sepolia\n` +
        `  npx hardhat run scripts/deploy-creditcoin.ts --network creditcoin`,
    );
  }
  return JSON.parse(readFileSync(p, "utf8")) as Deployment;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const sepoliaDeployment = () => load("sepolia");
export const creditcoinDeployment = () => load("creditcoin");

export const cfg = {
  sepoliaRpc: env("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
  creditcoinRpc: env("CREDITCOIN_RPC_URL", "https://rpc.cc3-testnet.creditcoin.network"),
  proofBuilderUrl: env("PROOF_BUILDER_URL", "https://proof-gen-api.cc3-testnet.creditcoin.network"),
  sourceChainKey: Number(env("SOURCE_CHAIN_KEY", "1")),
  snapshotIntervalMs: Number(env("SNAPSHOT_INTERVAL_MS", "300000")),
  pollIntervalMs: Number(env("POLL_INTERVAL_MS", "15000")),
  captureProofs: env("CAPTURE_PROOFS", "true") === "true",
  get workerKey() {
    return env("WORKER_PRIVATE_KEY", process.env.DEPLOYER_PRIVATE_KEY);
  },
};

// Minimal ABIs — hand-written so the worker has no build dependency on the
// contracts package and can be run standalone against a deployed system.
export const VAULT_ABI = [
  "event Locked(address indexed user, address indexed asset, uint256 amount, uint256 nonce)",
  "event ReserveSnapshot(address indexed vault, address indexed asset, uint256 balance, uint256 encumbered, uint256 epoch)",
  "event WithdrawalRequested(address indexed asset, address indexed to, uint256 amount, uint256 eta, bytes32 indexed requestId)",
  "event WithdrawalExecuted(bytes32 indexed requestId, address indexed asset, uint256 amount)",
  "event EmergencyWithdrawal(address indexed asset, address indexed to, uint256 amount)",
  "function encumbered(address) view returns (uint256)",
  "function availableReserve(address asset) view returns (uint256)",
  "function emergencyEnabled() view returns (bool)",
  "function snapshotReserves(address asset) returns (uint256 balance, uint256 encumbered, uint256 newEpoch)",
  "function canSnapshot(address asset) view returns (bool)",
  "function reserveBalance(address asset) view returns (uint256)",
  "function deposit(address asset, uint256 amount) returns (uint256)",
  "function epoch(address) view returns (uint256)",
] as const;

export const ASC_ABI = [
  "function submitReserveSnapshot((uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[]) q) returns (bool)",
  "function mintWithProof((uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[]) q) returns (bool)",
  "function solvencyReport(address sourceAsset) view returns ((uint256 verifiedReserve,uint256 encumberedReserve,uint256 outstandingSupply,uint256 maxMintable,uint32 collateralRatioBps,uint64 attestedAtHeight,uint64 latestAttestedHeight,uint64 stalenessBlocks,uint64 epoch,uint16 haircutBps,uint64 provenAt,uint8 trustedParties,bool fresh,bool solvent,bool mintFrozen))",
  "function isSolvent(address sourceAsset) view returns (bool)",
  "function reserves(address) view returns (uint256 verifiedBalance, uint256 encumbered, uint64 attestedAtHeight, uint64 epoch, bool frozen)",
  "function consumedLocks(bytes32) view returns (bool)",
  "function processedQueries(bytes32) view returns (bool)",
  "event ReserveProven(address indexed sourceAsset, uint256 balance, uint64 indexed atHeight, uint64 indexed epoch, bytes32 queryId)",
  "event Minted(address indexed to, address indexed sourceAsset, uint256 amount, uint256 nonce, bytes32 queryId)",
  "event InvariantChecked(address indexed sourceAsset, uint256 outstandingSupply, uint256 discountedReserve, uint32 ratioBps)",
  "event SolvencyBreach(address indexed sourceAsset, uint256 outstandingSupply, uint256 discountedReserve, uint32 ratioBps)",
] as const;

export const CHAIN_INFO_ADDRESS = "0x0000000000000000000000000000000000000fD3";
export const CHAIN_INFO_ABI = [
  "function get_latest_attestation_height_and_hash(uint64 chainKey) view returns ((uint64 height, bytes32 hash, bool isAttestation, bool exists))",
  "function is_height_attested(uint64 chainKey, uint64 targetHeight) view returns (bool)",
  "function get_supported_chains() view returns ((uint64 chainKey, uint64 chainId, bytes chainName, uint8 chainEncoding)[])",
] as const;
