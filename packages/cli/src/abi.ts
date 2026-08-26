/**
 * Hand-written ABIs. The CLI deliberately has no build dependency on the contracts
 * package — it must be runnable against a deployed system by someone who has never
 * compiled this repo.
 */

export const ASC_ABI = [
  "function submitReserveSnapshot((uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[]) q) returns (bool)",
  "function mintWithProof((uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[]) q) returns (bool)",
  "function solvencyReport(address sourceAsset) view returns ((uint256 verifiedReserve,uint256 encumberedReserve,uint256 outstandingSupply,uint256 maxMintable,uint32 collateralRatioBps,uint64 attestedAtHeight,uint64 latestAttestedHeight,uint64 stalenessBlocks,uint64 epoch,uint16 haircutBps,uint64 provenAt,uint8 trustedParties,bool fresh,bool solvent,bool mintFrozen))",
  "function trustedParties(address sourceAsset) view returns (uint8)",
  "function maxStalenessBlocks() view returns (uint64)",
  "function SOURCE_CHAIN_KEY() view returns (uint64)",
  "function CANONICAL_VAULT() view returns (address)",
  "function remoteChainKeys(address,uint256) view returns (uint64)",
  "function totalLiabilities(address sourceAsset) view returns (uint256)",
] as const;

/**
 * MintBoundASC's custom errors. Without these in the ABI, ethers reports a real,
 * informative revert as "unknown custom error" — which reads like a malfunction when it
 * is in fact the guard answering precisely.
 */
export const ASC_ERRORS = [
  "error WrongChainKey(uint64 got, uint64 expected)",
  "error QueryAlreadyProcessed(bytes32 queryId)",
  "error VerificationFailed()",
  "error SourceTransactionReverted()",
  "error UnsupportedTransactionType(uint8 txType)",
  "error NoMatchingEvent()",
  "error AssetNotRegistered(address sourceAsset)",
  "error StaleEpoch(uint64 got, uint64 have)",
  "error RegressiveHeight(uint64 got, uint64 have)",
  "error LockAlreadyConsumed(bytes32 lockId)",
  "error MintFrozen(address sourceAsset)",
  "error NoReserveProof(address sourceAsset)",
  "error ReserveStale(uint64 staleness, uint64 bound)",
  "error InvariantViolated(uint256 wouldBeSupply, uint256 discountedReserve)",
  "error InvalidHaircut(uint16 bps)",
  "error NotHealthy()",
  "error TimelockPending(uint256 eta)",
  "error NoUnfreezeRequested()",
  "error VelocityCapExceeded(uint256 wouldBeInWindow, uint256 cap)",
  "error InvalidVelocityWindow()",
  "error OracleMintDisabled(address sourceAsset)",
  "error AssetNotOracleBacked(address sourceAsset)",
  "error InvalidOracleFeed()",
  "error RemoteChainNotRegistered(address sourceAsset, uint64 chainKey)",
  "error WrongBeacon(address got, address expected)",
  "error RemoteSupplyStale(uint64 chainKey, uint64 staleness, uint64 bound)",
  "error RemoteSupplyMissing(uint64 chainKey)",
  "error TooManyRemoteChains()",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
] as const;

export const VAULT_ABI = [
  "function reserveBalance(address asset) view returns (uint256)",
  "function encumbered(address) view returns (uint256)",
  "function availableReserve(address asset) view returns (uint256)",
  "function emergencyEnabled() view returns (bool)",
  "function WITHDRAWAL_DELAY() view returns (uint256)",
  "function epoch(address) view returns (uint256)",
] as const;

export const FEED_ABI = [
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
] as const;

export const CHAIN_INFO_ABI = [
  "function get_latest_attestation_height_and_hash(uint64 chainKey) view returns ((uint64 height, bytes32 hash, bool isAttestation, bool exists))",
  "function is_height_attested(uint64 chainKey, uint64 targetHeight) view returns (bool)",
  "function get_supported_chains() view returns ((uint64 chainKey, uint64 chainId, bytes chainName, uint8 chainEncoding)[])",
] as const;

export const CONTINUITY_ABI = [
  "function coveredThrough(address asset) view returns (uint64)",
  "function openClaim(address asset) view returns (bytes32)",
  "function anchorHeight(address asset) view returns (uint64)",
  "function claims(bytes32) view returns (address asset,address asserter,uint64 fromHeight,uint64 toHeight,uint64 settleAfter,uint256 bond,bool settled,bool disproven)",
  "function MIN_BOND() view returns (uint256)",
  "function LIVENESS() view returns (uint64)",
] as const;
