import { AbiCoder, keccak256, toUtf8Bytes, zeroPadValue, getAddress } from "ethers";

/**
 * Builders for the `txBytes` payload that Creditcoin's Proof Builder returns and that
 * `EvmV1Decoder` consumes.
 *
 * The layout was read directly out of EvmV1Decoder.sol rather than inferred from docs:
 *
 *   txBytes   = abi.encode(uint8 txType, bytes[] chunks)
 *   chunks[0] = abi.encode(uint64 nonce, uint64 gasLimit, address from,
 *                          bool toIsNull, address to, uint256 value, bytes data)
 *   chunks[1] = type-specific fields
 *   chunks[2] = abi.encode(uint8 receiptStatus, uint64 receiptGasUsed,
 *                          LogEntryTuple[] logs, bytes logsBloom)   // txType <= 2
 *
 * Getting this byte-exact matters: it means the tests drive the real decoder over
 * realistically-shaped bytes, so a decoding regression fails a test instead of
 * surfacing on testnet.
 */

const abi = AbiCoder.defaultAbiCoder();

export const RESERVE_SNAPSHOT_SIG = keccak256(
  toUtf8Bytes("ReserveSnapshot(address,address,uint256,uint256,uint256)"),
);
export const LOCKED_SIG = keccak256(toUtf8Bytes("Locked(address,address,uint256,uint256)"));
export const SUPPLY_SNAPSHOT_SIG = keccak256(
  toUtf8Bytes("SupplySnapshot(address,address,uint256,uint256)"),
);

export const BLOCK_PROVER = "0x0000000000000000000000000000000000000FD2";
export const CHAIN_INFO = "0x0000000000000000000000000000000000000fD3";

export interface LogEntry {
  address_: string;
  topics: string[];
  data: string;
}

export const addrTopic = (a: string) => zeroPadValue(getAddress(a), 32);

/**
 * A ReserveSnapshot log as ReserveVault emits it.
 * `encumbered` is the total of announced-but-unexecuted withdrawals — the field that
 * lets MintBound de-rate the reserve before any money actually moves.
 */
export function snapshotLog(
  vault: string,
  asset: string,
  balance: bigint,
  epoch: bigint,
  encumbered: bigint = 0n,
): LogEntry {
  return {
    address_: vault,
    topics: [RESERVE_SNAPSHOT_SIG, addrTopic(vault), addrTopic(asset)],
    data: abi.encode(["uint256", "uint256", "uint256"], [balance, encumbered, epoch]),
  };
}

/** A Locked log as ReserveVault emits it. */
export function lockedLog(
  vault: string,
  user: string,
  asset: string,
  amount: bigint,
  nonce: bigint,
): LogEntry {
  return {
    address_: vault,
    topics: [LOCKED_SIG, addrTopic(user), addrTopic(asset)],
    data: abi.encode(["uint256", "uint256"], [amount, nonce]),
  };
}

/**
 * A SupplySnapshot log as SupplyBeacon emits it on a remote chain.
 * This is the liability half of the invariant — outstanding wrapped supply that exists
 * somewhere other than Creditcoin.
 */
export function supplyLog(
  beacon: string,
  token: string,
  supply: bigint,
  epoch: bigint,
): LogEntry {
  return {
    address_: beacon,
    topics: [SUPPLY_SNAPSHOT_SIG, addrTopic(beacon), addrTopic(token)],
    data: abi.encode(["uint256", "uint256"], [supply, epoch]),
  };
}

export interface EncodeTxOpts {
  logs: LogEntry[];
  receiptStatus?: number;
  from?: string;
  to?: string;
  txType?: number;
}

/** Build a full `txBytes` payload for an EIP-1559 (type 2) transaction. */
export function encodeTx(opts: EncodeTxOpts): string {
  const {
    logs,
    receiptStatus = 1,
    from = "0x1111111111111111111111111111111111111111",
    to = "0x2222222222222222222222222222222222222222",
    txType = 2,
  } = opts;

  const commonChunk = abi.encode(
    ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
    [1n, 500_000n, from, false, to, 0n, "0x"],
  );

  const typeChunk = abi.encode(
    ["uint64", "uint128", "uint128", "tuple(address,bytes32[])[]", "uint8", "bytes32", "bytes32"],
    [11155111n, 1_000_000_000n, 2_000_000_000n, [], 0, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`],
  );

  const receiptChunk = abi.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [
      receiptStatus,
      100_000n,
      logs.map((l) => [l.address_, l.topics, l.data]),
      "0x" + "00".repeat(256),
    ],
  );

  return abi.encode(["uint8", "bytes[]"], [txType, [commonChunk, typeChunk, receiptChunk]]);
}

export interface QueryOpts {
  chainKey?: bigint;
  blockHeight: bigint;
  encodedTransaction: string;
  merkleRoot?: string;
  /** Sibling side-flags; the mock derives a distinct tx index from these, so varying
   *  them is how a test produces two DIFFERENT queries at the same block height. */
  siblingFlags?: boolean[];
}

/** Build the Query tuple MintBoundASC accepts. */
export function makeQuery(o: QueryOpts) {
  const flags = o.siblingFlags ?? [false, false];
  return {
    chainKey: o.chainKey ?? 1n,
    blockHeight: o.blockHeight,
    encodedTransaction: o.encodedTransaction,
    merkleRoot: o.merkleRoot ?? `0x${"ab".repeat(32)}`,
    siblings: flags.map((isLeft, i) => ({
      hash: keccak256(toUtf8Bytes(`sib-${i}`)),
      isLeft,
    })),
    lowerEndpointDigest: `0x${"cd".repeat(32)}`,
    continuityRoots: [`0x${"ef".repeat(32)}`],
  };
}
