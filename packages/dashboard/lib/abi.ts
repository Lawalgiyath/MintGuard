/** Hand-written minimal ABIs. Keeping these here rather than importing build artefacts
 *  means the dashboard can be pointed at an already-deployed system without the
 *  contracts package present. */

export const ASC_ABI = [
  {
    type: "function",
    name: "solvencyReport",
    stateMutability: "view",
    inputs: [{ name: "sourceAsset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "verifiedReserve", type: "uint256" },
          { name: "encumberedReserve", type: "uint256" },
          { name: "outstandingSupply", type: "uint256" },
          { name: "maxMintable", type: "uint256" },
          { name: "collateralRatioBps", type: "uint32" },
          { name: "attestedAtHeight", type: "uint64" },
          { name: "latestAttestedHeight", type: "uint64" },
          { name: "stalenessBlocks", type: "uint64" },
          { name: "epoch", type: "uint64" },
          { name: "haircutBps", type: "uint16" },
          { name: "provenAt", type: "uint64" },
          { name: "trustedParties", type: "uint8" },
          { name: "fresh", type: "bool" },
          { name: "solvent", type: "bool" },
          { name: "mintFrozen", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isSolvent",
    stateMutability: "view",
    inputs: [{ name: "sourceAsset", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "maxStalenessBlocks",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "event",
    name: "ReserveProven",
    inputs: [
      { name: "sourceAsset", type: "address", indexed: true },
      { name: "balance", type: "uint256", indexed: false },
      { name: "atHeight", type: "uint64", indexed: true },
      { name: "epoch", type: "uint64", indexed: true },
      { name: "queryId", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Minted",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "sourceAsset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "queryId", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InvariantChecked",
    inputs: [
      { name: "sourceAsset", type: "address", indexed: true },
      { name: "outstandingSupply", type: "uint256", indexed: false },
      { name: "discountedReserve", type: "uint256", indexed: false },
      { name: "ratioBps", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SolvencyBreach",
    inputs: [
      { name: "sourceAsset", type: "address", indexed: true },
      { name: "outstandingSupply", type: "uint256", indexed: false },
      { name: "discountedReserve", type: "uint256", indexed: false },
      { name: "ratioBps", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedeemRequested",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "sourceAsset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "redeemId", type: "bytes32", indexed: true },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const VAULT_ABI = [
  {
    type: "function",
    name: "emergencyEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "WITHDRAWAL_DELAY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "encumbered",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const FEED_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

export const CHAIN_INFO_ABI = [
  {
    type: "function",
    name: "get_latest_attestation_height_and_hash",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "height", type: "uint64" },
          { name: "hash", type: "bytes32" },
          { name: "isAttestation", type: "bool" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const CHAIN_INFO_ADDRESS = "0x0000000000000000000000000000000000000fD3" as const;
