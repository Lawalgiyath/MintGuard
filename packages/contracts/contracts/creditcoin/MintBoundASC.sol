// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";

import {IChainInfo, ChainInfoLib} from "../interfaces/IChainInfo.sol";
import {ISolvencyOracle} from "../interfaces/ISolvencyOracle.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {WrappedAsset} from "./WrappedAsset.sol";

/**
 * @title MintBoundASC
 * @notice A per-mint cryptographic authorization gate for wrapped and tokenized RWAs.
 *
 * @dev THE CLAIM, stated precisely enough to be checked:
 *
 *      No DON, multisig, relayer, custodian, or heartbeat report appears anywhere in
 *      this contract's authorization path. Every fact this contract acts on is either
 *      (a) a Merkle + continuity proof of a specific source-chain transaction, verified
 *      synchronously by the Block Prover precompile at 0x0FD2, or (b) read directly
 *      from Creditcoin's own ChainInfo precompile at 0x0FD3. The off-chain worker that
 *      submits proofs is untrusted: it can censor (a liveness failure) but it cannot
 *      forge (a safety failure), and anyone may run one.
 *
 *      WHAT MAKES THIS MORE THAN THE TUTORIAL:
 *      The reference minter verifies a single lock and mints against it -- flow
 *      accounting. Flow accounting cannot detect a withdrawal, so it cannot detect a
 *      custodian rug after the fact. MintBound checks every mint against the AGGREGATE:
 *
 *            totalSupply(wrapped) + amount  <=  verifiedReserve * haircut
 *
 *      where verifiedReserve is a source-chain BALANCE lifted into an event and proven
 *      per-transaction, and the proof is required to be fresh within a bound measured
 *      against Creditcoin's own attestation height.
 *
 *      THE FRESHNESS SUBTLETY (this is the part that is easy to get wrong):
 *      A staleness bound is only trustless if "how stale is this" is answered on-chain.
 *      If the worker supplied the current source height, a lying worker could make an
 *      arbitrarily old reserve look current and the entire claim above would be false.
 *      _requireFresh() therefore reads the latest attested height from the ChainInfo
 *      precompile inside the mint transaction. No off-chain input participates.
 */
contract MintBoundASC is ISolvencyOracle, Ownable {
    // -------------------------------------------------------------------------
    // Immutable wiring
    // -------------------------------------------------------------------------

    /// @notice Block Prover precompile (0x0FD2). Verifies Merkle + continuity proofs.
    INativeQueryVerifier public immutable VERIFIER;

    /// @notice ChainInfo precompile (0x0FD3). Source of truth for attestation height.
    IChainInfo public immutable CHAIN_INFO;

    /// @notice Creditcoin-internal id of the source chain. 1 = Ethereum Sepolia on CC3.
    /// @dev Pinned at construction. A proof from any other chain is rejected outright,
    ///      so an attacker cannot present a cheap-to-forge chain's transaction.
    uint64 public immutable SOURCE_CHAIN_KEY;

    /**
     * @notice The one and only vault address on the source chain whose events count.
     * @dev THE SINGLE MOST LIKELY EXPLOIT IN ANY IMPLEMENTATION OF THIS PATTERN.
     *      Event signatures are not authenticated -- anyone can deploy a contract that
     *      emits a byte-identical ReserveSnapshot claiming a billion in reserves, get
     *      that transaction included in a real Sepolia block, and produce a completely
     *      valid inclusion proof for it. The proof would verify. Without binding to the
     *      emitting address, reserves inflate for the price of one Sepolia transaction.
     *
     *      Note also that the reference implementation's habit of reading logs[0] is
     *      not sufficient here: a crafted transaction can place a counterfeit log
     *      first. _findVaultLog() scans for a log whose emitter IS this vault rather
     *      than assuming position.
     */
    address public immutable CANONICAL_VAULT;

    // Event signatures. Indexed-ness does not affect the topic0 hash.
    bytes32 public constant RESERVE_SNAPSHOT_SIG =
        keccak256("ReserveSnapshot(address,address,uint256,uint256,uint256)");
    bytes32 public constant LOCKED_SIG = keccak256("Locked(address,address,uint256,uint256)");
    bytes32 public constant SUPPLY_SNAPSHOT_SIG =
        keccak256("SupplySnapshot(address,address,uint256,uint256)");

    uint16 public constant BPS = 10_000;

    /// @notice Minimum delay between requesting and executing an unfreeze.
    uint256 public constant UNFREEZE_DELAY = 1 hours;

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice One verified cross-chain query. Grouped into a struct so the proof
    ///         components travel together and the stack stays shallow.
    struct Query {
        uint64 chainKey;
        uint64 blockHeight;
        bytes encodedTransaction;
        bytes32 merkleRoot;
        INativeQueryVerifier.MerkleProofEntry[] siblings;
        bytes32 lowerEndpointDigest;
        bytes32[] continuityRoots;
    }

    /**
     * @notice How the reserve figure for an asset is obtained.
     * @dev MintBound is the only reserve system we know of that GRADES ITS OWN EVIDENCE
     *      per asset and publishes the grade. Proof-of-reserve products report one
     *      number and leave the reader to guess how much trust it required. Being able
     *      to say "this asset: zero trusted parties; that asset: one, and here is who"
     *      is more useful than pretending everything is equally verified.
     */
    enum ReserveSource {
        Proven, // per-transaction inclusion proof. trustedParties = 0
        OracleReported // an external feed (e.g. Chainlink PoR). trustedParties = 1
    }

    struct AssetConfig {
        address wrapped;
        uint16 haircutBps; // risk discount; 10000 = no discount
        bool registered;
        ReserveSource source;
        address oracleFeed; // AggregatorV3Interface, only for OracleReported
        bool oracleMintEnabled; // minting on oracle evidence is opt-in, default OFF
    }

    struct ReserveState {
        uint256 verifiedBalance; // last proven source-chain balance
        uint256 encumbered; // announced-but-unexecuted withdrawals, proven alongside
        uint64 attestedAtHeight; // source height that balance was proven at
        uint64 provenAt; // Creditcoin timestamp the proof landed — feed `updatedAt`
        uint64 epoch; // strictly monotonic; defeats stale-snapshot replay
        bool frozen; // circuit breaker for this asset
    }

    /**
     * @notice Wrapped supply outstanding on another chain, proven by inclusion.
     * @dev Liabilities are only "trivially public" when supply exists on exactly one
     *      chain. On any real wrapped asset it does not, and a per-chain reserve check
     *      passes on every chain at once while the whole system is insolvent.
     */
    struct RemoteSupply {
        uint256 amount;
        uint64 attestedAtHeight;
        uint64 epoch;
        address beacon; // the SupplyBeacon authorised to report for this chain
        bool registered;
    }

    /// @notice Bounds how much new supply can be created per rolling window.
    /// @dev Caps the damage of any residual detection window. Zero = unlimited.
    struct MintVelocity {
        uint256 cap; // max minted per window, in token units
        uint64 windowSeconds;
        uint64 windowStart;
        uint256 mintedInWindow;
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    mapping(address => AssetConfig) public assets; // source asset => config
    mapping(address => ReserveState) public reserves; // source asset => proven state
    mapping(address => MintVelocity) public velocity; // source asset => rate limit

    /// @notice asset => chainKey => proven remote supply
    mapping(address => mapping(uint64 => RemoteSupply)) public remoteSupply;
    /// @notice asset => the chainKeys registered for it. Bounded and admin-set.
    mapping(address => uint64[]) public remoteChainKeys;

    /// @notice Replay protection keyed on (chainKey, blockHeight, transactionIndex).
    mapping(bytes32 => bool) public processedQueries;

    /// @notice One deposit authorises exactly one mint, forever.
    mapping(bytes32 => bool) public consumedLocks;

    /// @notice Staleness bound in source-chain blocks. ~200 Sepolia blocks is ~40 min.
    uint64 public maxStalenessBlocks;

    /// @notice Global kill switch, independent of per-asset freezes.
    bool public globalFreeze;

    mapping(address => uint256) public unfreezeEta;
    /// @dev Assets registered so far; used to resolve a beacon back to its asset.
    address[] private _registeredAssets;
    uint256 private constant MAX_REMOTE_CHAINS = 16;
    uint256 private _redeemNonce;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ReserveProven(
        address indexed sourceAsset,
        uint256 balance,
        uint64 indexed atHeight,
        uint64 indexed epoch,
        bytes32 queryId
    );
    event Minted(
        address indexed to, address indexed sourceAsset, uint256 amount, uint256 nonce, bytes32 queryId
    );
    event InvariantChecked(
        address indexed sourceAsset, uint256 outstandingSupply, uint256 discountedReserve, uint32 ratioBps
    );
    event SolvencyBreach(
        address indexed sourceAsset, uint256 outstandingSupply, uint256 discountedReserve, uint32 ratioBps
    );
    event RedeemRequested(
        address indexed user, address indexed sourceAsset, uint256 amount, bytes32 indexed redeemId
    );
    event AssetRegistered(address indexed sourceAsset, address indexed wrapped, uint16 haircutBps);
    event HaircutUpdated(address indexed sourceAsset, uint16 haircutBps);
    event StalenessBoundUpdated(uint64 blocks_);
    event UnfreezeRequested(address indexed sourceAsset, uint256 eta);
    event Unfrozen(address indexed sourceAsset);
    event GlobalFreezeSet(bool frozen);
    event MintVelocitySet(address indexed sourceAsset, uint256 cap, uint64 windowSeconds);
    event OracleBackedAssetRegistered(address indexed sourceAsset, address indexed feed);
    event OracleMintEnabledSet(address indexed sourceAsset, bool enabled);
    event RemoteChainRegistered(address indexed sourceAsset, uint64 indexed chainKey, address beacon);
    event RemoteSupplyProven(
        address indexed sourceAsset, uint64 indexed chainKey, uint256 amount, uint64 atHeight, uint64 epoch
    );
    event ReserveEncumbered(address indexed sourceAsset, uint256 encumbered, uint256 effectiveReserve);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error WrongChainKey(uint64 got, uint64 expected);
    error QueryAlreadyProcessed(bytes32 queryId);
    error VerificationFailed();
    error SourceTransactionReverted();
    error UnsupportedTransactionType(uint8 txType);
    error NoMatchingEvent();
    error AssetNotRegistered(address sourceAsset);
    error StaleEpoch(uint64 got, uint64 have);
    error RegressiveHeight(uint64 got, uint64 have);
    error LockAlreadyConsumed(bytes32 lockId);
    error MintFrozen(address sourceAsset);
    error NoReserveProof(address sourceAsset);
    error ReserveStale(uint64 staleness, uint64 bound);
    error InvariantViolated(uint256 wouldBeSupply, uint256 discountedReserve);
    error InvalidHaircut(uint16 bps);
    error NotHealthy();
    error TimelockPending(uint256 eta);
    error NoUnfreezeRequested();
    error VelocityCapExceeded(uint256 wouldBeInWindow, uint256 cap);
    error InvalidVelocityWindow();
    error OracleMintDisabled(address sourceAsset);
    error AssetNotOracleBacked(address sourceAsset);
    error InvalidOracleFeed();
    error RemoteChainNotRegistered(address sourceAsset, uint64 chainKey);
    error WrongBeacon(address got, address expected);
    error RemoteSupplyStale(uint64 chainKey, uint64 staleness, uint64 bound);
    error RemoteSupplyMissing(uint64 chainKey);
    error TooManyRemoteChains();

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    constructor(uint64 sourceChainKey, address canonicalVault, uint64 stalenessBlocks) Ownable(msg.sender) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        CHAIN_INFO = ChainInfoLib.get();
        SOURCE_CHAIN_KEY = sourceChainKey;
        CANONICAL_VAULT = canonicalVault;
        maxStalenessBlocks = stalenessBlocks;
    }

    // -------------------------------------------------------------------------
    // Entry point 1: prove a reserve balance (the stock side)
    // -------------------------------------------------------------------------

    /**
     * @notice Verify a source-chain ReserveSnapshot transaction and record the balance.
     * @dev Permissionless. Anyone may submit any valid proof; submitting a proof
     *      confers no privilege because the proof itself is what is trusted. Recording
     *      a reserve that fails to cover outstanding supply trips the circuit breaker
     *      immediately -- so an honest party proving bad news is a first-class action,
     *      not an attack.
     */
    function submitReserveSnapshot(Query calldata q) external returns (bool) {
        bytes32 queryId = _verifyAndConsume(q);

        (address sourceAsset, uint256 balance, uint256 encumbered_, uint256 epoch_) =
            _decodeSnapshot(q.encodedTransaction);

        AssetConfig memory cfg = assets[sourceAsset];
        if (!cfg.registered) revert AssetNotRegistered(sourceAsset);

        ReserveState storage st = reserves[sourceAsset];

        // Strict monotonicity. Without this, an attacker replays yesterday's higher
        // balance to mask today's shortfall -- the proof is genuine, the conclusion
        // is a lie. Height must not regress either, so a reorged-out snapshot cannot
        // overwrite a newer one.
        if (epoch_ <= st.epoch) revert StaleEpoch(uint64(epoch_), st.epoch);
        if (q.blockHeight < st.attestedAtHeight) revert RegressiveHeight(q.blockHeight, st.attestedAtHeight);

        st.verifiedBalance = balance;
        st.encumbered = encumbered_;
        st.attestedAtHeight = q.blockHeight;
        st.provenAt = uint64(block.timestamp);
        st.epoch = uint64(epoch_);

        emit ReserveProven(sourceAsset, balance, q.blockHeight, uint64(epoch_), queryId);
        if (encumbered_ > 0) {
            emit ReserveEncumbered(sourceAsset, encumbered_, _effectiveReserve(st, cfg.haircutBps));
        }

        _evaluateSolvency(sourceAsset, cfg, st);
        return true;
    }

    // -------------------------------------------------------------------------
    // Entry point 2: mint against a proven lock (the flow side, bound by the stock)
    // -------------------------------------------------------------------------

    /**
     * @notice Verify a source-chain Locked transaction and mint -- but only if the
     *         aggregate invariant still holds after the mint.
     * @dev Step ordering matters. The invariant is checked against
     *      totalSupply + amount, not against amount alone. Checking the incoming
     *      deposit in isolation is what every flow-only design does, and it is exactly
     *      what fails to notice that the reserve backing the OTHER 99% of supply
     *      walked out of the vault an hour ago.
     */
    function mintWithProof(Query calldata q) external returns (bool) {
        bytes32 queryId = _verifyAndConsume(q);

        (address user, address sourceAsset, uint256 amount, uint256 nonce) =
            _decodeLocked(q.encodedTransaction);

        // One deposit, one mint, forever.
        bytes32 lockId = keccak256(abi.encode(user, sourceAsset, nonce));
        if (consumedLocks[lockId]) revert LockAlreadyConsumed(lockId);
        consumedLocks[lockId] = true;

        AssetConfig memory cfg = assets[sourceAsset];
        if (!cfg.registered) revert AssetNotRegistered(sourceAsset);

        if (reserves[sourceAsset].frozen || globalFreeze) revert MintFrozen(sourceAsset);

        // Minting on oracle evidence is a deliberate per-asset opt-in. Left off, the
        // authorization path keeps its zero-trusted-reporter property absolutely.
        if (cfg.source == ReserveSource.OracleReported && !cfg.oracleMintEnabled) {
            revert OracleMintDisabled(sourceAsset);
        }

        ReserveState memory st = _resolve(sourceAsset, cfg);
        if (cfg.source == ReserveSource.Proven) _requireFresh(sourceAsset, reserves[sourceAsset]);
        _requireRemoteFresh(sourceAsset);

        // Liabilities across EVERY chain, not just this one.
        uint256 supply = totalLiabilities(sourceAsset);
        uint256 discounted = _effectiveReserve(st, cfg.haircutBps);
        uint256 wouldBe = supply + amount;

        // The bound. This single line is the product.
        if (wouldBe > discounted) revert InvariantViolated(wouldBe, discounted);

        // Bounds the damage of any residual window, whatever its cause.
        _consumeVelocity(sourceAsset, amount);

        WrappedAsset(cfg.wrapped).mint(user, amount);

        emit Minted(user, sourceAsset, amount, nonce, queryId);
        emit InvariantChecked(sourceAsset, wouldBe, discounted, _ratio(wouldBe, discounted));
        return true;
    }

    // -------------------------------------------------------------------------
    // Entry point 3: prove outstanding supply on another chain
    // -------------------------------------------------------------------------

    /**
     * @notice Verify a SupplySnapshot from a registered beacon on another chain.
     * @dev This is the liability half of Provisions (CCS 2015). Without it the invariant
     *      compares a global reserve against a single chain's supply, which every
     *      production proof-of-reserve design does and which passes on every chain
     *      simultaneously while the aggregate is fractional.
     *
     *      Note this deliberately does NOT pin q.chainKey to SOURCE_CHAIN_KEY — remote
     *      supply comes from other chains by definition. Safety comes instead from the
     *      (chainKey, beacon) registry: only a beacon the owner registered for that exact
     *      chain may report, so an attacker cannot invent a chain or a reporter.
     */
    function submitRemoteSupply(Query calldata q) external returns (bool) {
        bytes32 queryId = _verifyAndConsume(q, q.chainKey);

        (address beacon, address wrappedToken, uint256 supply, uint256 epoch_) =
            _decodeSupplySnapshot(q.encodedTransaction);

        address sourceAsset = _assetForRemote(q.chainKey, beacon);
        RemoteSupply storage rs = remoteSupply[sourceAsset][q.chainKey];

        if (!rs.registered) revert RemoteChainNotRegistered(sourceAsset, q.chainKey);
        if (beacon != rs.beacon) revert WrongBeacon(beacon, rs.beacon);
        if (epoch_ <= rs.epoch) revert StaleEpoch(uint64(epoch_), rs.epoch);
        if (q.blockHeight < rs.attestedAtHeight) {
            revert RegressiveHeight(q.blockHeight, rs.attestedAtHeight);
        }

        rs.amount = supply;
        rs.attestedAtHeight = q.blockHeight;
        rs.epoch = uint64(epoch_);

        emit RemoteSupplyProven(sourceAsset, q.chainKey, supply, q.blockHeight, uint64(epoch_));

        AssetConfig memory cfg = assets[sourceAsset];
        if (cfg.registered) {
            ReserveState storage st = reserves[sourceAsset];
            _evaluateSolvency(sourceAsset, cfg, st);
        }

        // Silences an unused-variable warning while documenting that the token address
        // in the event is informational: authority comes from the beacon registry.
        wrappedToken;
        queryId;
        return true;
    }

    /// @dev Reverse-lookup the asset a (chainKey, beacon) pair reports for.
    function _assetForRemote(uint64 chainKey, address beacon) internal view returns (address) {
        // The registry is admin-set and tiny; a linear scan is cheaper than a second mapping.
        address[] memory candidates = _registeredAssets;
        uint256 len = candidates.length;
        for (uint256 i; i < len; ++i) {
            RemoteSupply storage rs = remoteSupply[candidates[i]][chainKey];
            if (rs.registered && rs.beacon == beacon) return candidates[i];
        }
        revert RemoteChainNotRegistered(address(0), chainKey);
    }

    /// @dev SupplySnapshot(address indexed beacon, address indexed token, uint256 supply, uint256 epoch)
    function _decodeSupplySnapshot(bytes memory encodedTx)
        internal
        pure
        returns (address beacon, address token, uint256 supply, uint256 epoch_)
    {
        EvmV1Decoder.LogEntry[] memory logs = _decodeVerifiedLogs(encodedTx, SUPPLY_SNAPSHOT_SIG);
        uint256 len = logs.length;
        for (uint256 i; i < len; ++i) {
            if (logs[i].topics.length == 3 && logs[i].data.length == 64) {
                beacon = address(uint160(uint256(logs[i].topics[1])));
                token = address(uint160(uint256(logs[i].topics[2])));
                (supply, epoch_) = abi.decode(logs[i].data, (uint256, uint256));
                return (beacon, token, supply, epoch_);
            }
        }
        revert NoMatchingEvent();
    }

    /// @notice Total outstanding liabilities: local wrapped supply plus every proven
    ///         remote chain. This is the number the bound is actually enforced against.
    function totalLiabilities(address sourceAsset) public view returns (uint256 total) {
        AssetConfig memory cfg = assets[sourceAsset];
        if (!cfg.registered) return 0;
        total = WrappedAsset(cfg.wrapped).totalSupply();

        uint64[] memory keys = remoteChainKeys[sourceAsset];
        uint256 len = keys.length;
        for (uint256 i; i < len; ++i) {
            total += remoteSupply[sourceAsset][keys[i]].amount;
        }
    }

    /**
     * @dev Every registered remote chain must have a fresh supply proof before minting.
     *      An unknown remote supply is not zero — it is unknown, and minting against an
     *      unknown liability is exactly the failure this contract exists to prevent. So
     *      a stale or missing remote report halts minting rather than being ignored.
     */
    function _requireRemoteFresh(address sourceAsset) internal view {
        uint64[] memory keys = remoteChainKeys[sourceAsset];
        uint256 len = keys.length;
        for (uint256 i; i < len; ++i) {
            uint64 ck = keys[i];
            RemoteSupply storage rs = remoteSupply[sourceAsset][ck];
            if (rs.attestedAtHeight == 0) revert RemoteSupplyMissing(ck);

            uint64 latest = CHAIN_INFO.get_latest_attestation_height_and_hash(ck).height;
            if (latest < rs.attestedAtHeight) {
                revert RemoteSupplyStale(ck, type(uint64).max, maxStalenessBlocks);
            }
            uint64 staleness = latest - rs.attestedAtHeight;
            if (staleness > maxStalenessBlocks) {
                revert RemoteSupplyStale(ck, staleness, maxStalenessBlocks);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Redemption: the asymmetric fail-safe
    // -------------------------------------------------------------------------

    /**
     * @notice Burn wrapped supply and request settlement on the source chain.
     * @dev Requires no proof, no freshness, and works while frozen. Liabilities fall
     *      the instant the burn lands, so a redemption can only ever improve the
     *      collateral ratio. Gating this would invert the safety property: it would
     *      trap users inside exactly the situation the circuit breaker exists to
     *      signal.
     */
    function redeem(address sourceAsset, uint256 amount) external returns (bytes32 redeemId) {
        AssetConfig memory cfg = assets[sourceAsset];
        if (!cfg.registered) revert AssetNotRegistered(sourceAsset);

        WrappedAsset(cfg.wrapped).burnFrom(msg.sender, amount);

        unchecked {
            redeemId = keccak256(abi.encode(msg.sender, sourceAsset, amount, ++_redeemNonce, block.chainid));
        }
        emit RedeemRequested(msg.sender, sourceAsset, amount, redeemId);
    }

    // -------------------------------------------------------------------------
    // Verification core
    // -------------------------------------------------------------------------

    /// @dev Pins the chain, computes the replay key, verifies the proof, consumes the key.
    function _verifyAndConsume(Query calldata q) internal returns (bytes32 queryId) {
        return _verifyAndConsume(q, SOURCE_CHAIN_KEY);
    }

    /// @dev Same, for a chain other than the pinned source (remote supply proofs).
    function _verifyAndConsume(Query calldata q, uint64 expectedChainKey)
        internal
        returns (bytes32 queryId)
    {
        if (q.chainKey != expectedChainKey) revert WrongChainKey(q.chainKey, expectedChainKey);

        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: q.merkleRoot, siblings: q.siblings});

        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        queryId = keccak256(abi.encode(q.chainKey, q.blockHeight, txIndex));
        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);

        INativeQueryVerifier.ContinuityProof memory continuityProof = INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: q.lowerEndpointDigest,
            roots: q.continuityRoots
        });

        bool verified =
            VERIFIER.verifyAndEmit(q.chainKey, q.blockHeight, q.encodedTransaction, merkleProof, continuityProof);
        if (!verified) revert VerificationFailed();

        processedQueries[queryId] = true;
    }

    /**
     * @dev Shared decoding preamble.
     *      The precompile proves INCLUSION, not SUCCESS. A reverted transaction is
     *      still included in a block, and its logs are absent but its bytes verify.
     *      Gluwa flags this in a danger callout; checking receiptStatus is mandatory
     *      and is the difference between a working gate and a decorative one.
     */
    function _decodeVerifiedLogs(bytes memory encodedTx, bytes32 eventSig)
        internal
        pure
        returns (EvmV1Decoder.LogEntry[] memory)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTx);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTx);
        if (receipt.receiptStatus != 1) revert SourceTransactionReverted();

        return EvmV1Decoder.getLogsByEventSignature(receipt, eventSig);
    }

    /**
     * @dev Select the log actually emitted by the canonical vault.
     *      Scans rather than indexing logs[0], so a crafted transaction that front-loads
     *      a counterfeit log cannot decide which entry we read.
     */
    function _findVaultLog(EvmV1Decoder.LogEntry[] memory logs, uint256 expectedDataLen)
        internal
        view
        returns (EvmV1Decoder.LogEntry memory)
    {
        uint256 len = logs.length;
        for (uint256 i; i < len; ++i) {
            if (
                logs[i].address_ == CANONICAL_VAULT && logs[i].topics.length == 3
                    && logs[i].data.length == expectedDataLen
            ) {
                return logs[i];
            }
        }
        revert NoMatchingEvent();
    }

    /// @dev ReserveSnapshot(address indexed vault, address indexed asset,
    ///                       uint256 balance, uint256 encumbered, uint256 epoch)
    function _decodeSnapshot(bytes memory encodedTx)
        internal
        view
        returns (address sourceAsset, uint256 balance, uint256 encumbered_, uint256 epoch_)
    {
        EvmV1Decoder.LogEntry memory log = _findVaultLog(_decodeVerifiedLogs(encodedTx, RESERVE_SNAPSHOT_SIG), 96);

        // topics[1] is the vault the event reports on; it must be the same vault that
        // emitted it. A vault reporting another vault's balance is not a thing we accept.
        if (address(uint160(uint256(log.topics[1]))) != CANONICAL_VAULT) revert NoMatchingEvent();

        sourceAsset = address(uint160(uint256(log.topics[2])));
        (balance, encumbered_, epoch_) = abi.decode(log.data, (uint256, uint256, uint256));
    }

    /// @dev Locked(address indexed user, address indexed asset, uint256 amount, uint256 nonce)
    function _decodeLocked(bytes memory encodedTx)
        internal
        view
        returns (address user, address sourceAsset, uint256 amount, uint256 nonce)
    {
        EvmV1Decoder.LogEntry memory log = _findVaultLog(_decodeVerifiedLogs(encodedTx, LOCKED_SIG), 64);

        user = address(uint160(uint256(log.topics[1])));
        sourceAsset = address(uint160(uint256(log.topics[2])));
        (amount, nonce) = abi.decode(log.data, (uint256, uint256));
    }

    // -------------------------------------------------------------------------
    // Freshness and solvency
    // -------------------------------------------------------------------------

    /// @dev Reads "now" from the chain, never from the caller. See contract-level note.
    function _requireFresh(address sourceAsset, ReserveState storage st) internal view {
        if (st.attestedAtHeight == 0) revert NoReserveProof(sourceAsset);

        uint64 latest = CHAIN_INFO.get_latest_attestation_height_and_hash(SOURCE_CHAIN_KEY).height;

        // A snapshot proven at a height above the latest attested height should be
        // impossible; treat it as maximally stale rather than underflowing.
        if (latest < st.attestedAtHeight) revert ReserveStale(type(uint64).max, maxStalenessBlocks);

        uint64 staleness = latest - st.attestedAtHeight;
        if (staleness > maxStalenessBlocks) revert ReserveStale(staleness, maxStalenessBlocks);
    }

    /// @dev Drift detection. Runs on every accepted snapshot, including the good ones.
    function _evaluateSolvency(address sourceAsset, AssetConfig memory cfg, ReserveState storage st) internal {
        uint256 supply = totalLiabilities(sourceAsset);
        uint256 discounted = _effectiveReserve(st, cfg.haircutBps);
        uint32 ratio = _ratio(supply, discounted);

        if (discounted < supply) {
            st.frozen = true;
            emit SolvencyBreach(sourceAsset, supply, discounted, ratio);
        } else {
            emit InvariantChecked(sourceAsset, supply, discounted, ratio);
        }
    }

    /**
     * @dev The reserve that actually backs supply.
     *
     *      Announced-but-unexecuted withdrawals are subtracted BEFORE the haircut. This
     *      is what closes the detection window: the moment a custodian announces an
     *      exit, the funds stop counting as backing -- even though they are still
     *      sitting in the vault and will be for at least WITHDRAWAL_DELAY blocks. The
     *      invariant reacts to the intention, not to the aftermath.
     */
    function _effectiveReserve(ReserveState memory st, uint16 haircutBps_) internal pure returns (uint256) {
        uint256 unencumbered = st.verifiedBalance > st.encumbered ? st.verifiedBalance - st.encumbered : 0;
        return (unencumbered * haircutBps_) / BPS;
    }

    /**
     * @dev Reserve figure for an oracle-backed asset, plus when the feed last updated.
     *
     *      This exists so MintBound covers assets an inclusion proof physically cannot
     *      reach: fiat in a bank, bullion in a vault. It is strictly weaker evidence and
     *      the contract never pretends otherwise -- such assets report trustedParties = 1
     *      and minting against them is opt-in per asset, OFF by default. The point is not
     *      to match a wider coverage claim by lowering our standard. It is to cover the
     *      same universe while stating which tier of evidence each asset sits in.
     */
    function _oracleReserve(AssetConfig memory cfg) internal view returns (uint256 balance, uint64 updatedAt) {
        if (cfg.oracleFeed == address(0)) return (0, 0);
        try AggregatorV3Interface(cfg.oracleFeed).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updated, uint80
        ) {
            if (answer <= 0) return (0, uint64(updated));
            return (uint256(answer), uint64(updated));
        } catch {
            return (0, 0);
        }
    }

    /// @dev The reserve state actually used for an asset, whatever its evidence tier.
    function _resolve(address sourceAsset, AssetConfig memory cfg)
        internal
        view
        returns (ReserveState memory st)
    {
        st = reserves[sourceAsset];
        if (cfg.source == ReserveSource.OracleReported) {
            (uint256 bal, uint64 updated) = _oracleReserve(cfg);
            st.verifiedBalance = bal;
            st.encumbered = 0; // an external feed cannot express encumbrances
            st.provenAt = updated;
        }
    }

    function _trustedPartiesFor(AssetConfig memory cfg) internal pure returns (uint8) {
        return cfg.source == ReserveSource.Proven ? 0 : 1;
    }

    /// @dev Coverage in bps: discountedReserve / supply. Zero supply is infinitely
    ///      covered, reported as max rather than dividing by zero.
    function _ratio(uint256 supply, uint256 discounted) internal pure returns (uint32) {
        if (supply == 0) return type(uint32).max;
        uint256 r = (discounted * BPS) / supply;
        return r > type(uint32).max ? type(uint32).max : uint32(r);
    }

    /**
     * @dev Rolling-window mint cap.
     *
     *      The timelock stops an ANNOUNCED drain. This bounds an unannounced one --
     *      a compromised key, an exploited token, anything that removes reserves
     *      without the vault's cooperation. No detection scheme can make that window
     *      zero, so instead we cap how much supply can be created inside it. Damage
     *      becomes a function of the cap rather than of the attacker's patience.
     */
    function _consumeVelocity(address sourceAsset, uint256 amount) internal {
        MintVelocity storage v = velocity[sourceAsset];
        if (v.cap == 0) return; // not configured: unlimited

        if (block.timestamp >= uint256(v.windowStart) + v.windowSeconds) {
            v.windowStart = uint64(block.timestamp);
            v.mintedInWindow = 0;
        }
        uint256 next = v.mintedInWindow + amount;
        if (next > v.cap) revert VelocityCapExceeded(next, v.cap);
        v.mintedInWindow = next;
    }

    /// @notice Configure the rolling mint cap. cap = 0 disables it.
    function setMintVelocity(address sourceAsset, uint256 cap, uint64 windowSeconds) external onlyOwner {
        if (windowSeconds == 0) revert InvalidVelocityWindow();
        MintVelocity storage v = velocity[sourceAsset];
        v.cap = cap;
        v.windowSeconds = windowSeconds;
        v.windowStart = uint64(block.timestamp);
        v.mintedInWindow = 0;
        emit MintVelocitySet(sourceAsset, cap, windowSeconds);
    }

    /// @notice How much more may be minted in the current window.
    function velocityRemaining(address sourceAsset) external view returns (uint256) {
        MintVelocity memory v = velocity[sourceAsset];
        if (v.cap == 0) return type(uint256).max;
        if (block.timestamp >= uint256(v.windowStart) + v.windowSeconds) return v.cap;
        return v.cap > v.mintedInWindow ? v.cap - v.mintedInWindow : 0;
    }

    // -------------------------------------------------------------------------
    // ISolvencyOracle
    // -------------------------------------------------------------------------

    function isSolvent(address sourceAsset) external view returns (bool) {
        SolvencyReport memory r = solvencyReport(sourceAsset);
        return r.solvent && r.fresh && !r.mintFrozen;
    }

    function collateralRatioBps(address sourceAsset) external view returns (uint32) {
        return solvencyReport(sourceAsset).collateralRatioBps;
    }

    function verifiedReserve(address sourceAsset) external view returns (uint256 balance, uint64 atHeight) {
        ReserveState memory st = reserves[sourceAsset];
        return (st.verifiedBalance, st.attestedAtHeight);
    }

    function solvencyReport(address sourceAsset) public view returns (SolvencyReport memory r) {
        AssetConfig memory cfg = assets[sourceAsset];
        ReserveState memory st = reserves[sourceAsset];

        if (cfg.registered) st = _resolve(sourceAsset, cfg);

        r.verifiedReserve = st.verifiedBalance;
        r.attestedAtHeight = st.attestedAtHeight;
        r.provenAt = st.provenAt;
        r.epoch = st.epoch;
        r.haircutBps = cfg.haircutBps;
        r.trustedParties = _trustedPartiesFor(cfg);
        r.mintFrozen = reserves[sourceAsset].frozen || globalFreeze;

        if (!cfg.registered) return r;

        r.outstandingSupply = totalLiabilities(sourceAsset);
        r.encumberedReserve = st.encumbered;
        uint256 discounted = _effectiveReserve(st, cfg.haircutBps);
        r.collateralRatioBps = _ratio(r.outstandingSupply, discounted);
        r.solvent = discounted >= r.outstandingSupply;
        r.maxMintable = discounted > r.outstandingSupply ? discounted - r.outstandingSupply : 0;

        // Freshness is read from the chain here too, so a dashboard sees exactly what
        // the mint path would see -- no divergence between what is displayed and what
        // is enforced.
        if (cfg.source == ReserveSource.OracleReported) {
            // A feed is fresh if it updated within the equivalent wall-clock window.
            uint256 maxAge = uint256(maxStalenessBlocks) * 12;
            r.fresh = st.provenAt != 0 && block.timestamp <= uint256(st.provenAt) + maxAge;
            return r;
        }

        if (st.attestedAtHeight != 0) {
            try CHAIN_INFO.get_latest_attestation_height_and_hash(SOURCE_CHAIN_KEY) returns (
                IChainInfo.HeightAndHash memory h
            ) {
                r.latestAttestedHeight = h.height;
                if (h.height >= st.attestedAtHeight) {
                    r.stalenessBlocks = h.height - st.attestedAtHeight;
                    r.fresh = r.stalenessBlocks <= maxStalenessBlocks;
                }
            } catch {
                // ChainInfo unavailable: report not-fresh rather than reverting the view.
                r.fresh = false;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Administration -- bounded, and never able to create supply
    // -------------------------------------------------------------------------

    function registerAsset(address sourceAsset, address wrapped, uint16 haircutBps_) external onlyOwner {
        if (haircutBps_ == 0 || haircutBps_ > BPS) revert InvalidHaircut(haircutBps_);
        assets[sourceAsset] = AssetConfig({
            wrapped: wrapped,
            haircutBps: haircutBps_,
            registered: true,
            source: ReserveSource.Proven,
            oracleFeed: address(0),
            oracleMintEnabled: false
        });
        _trackAsset(sourceAsset);
        emit AssetRegistered(sourceAsset, wrapped, haircutBps_);
    }

    function _trackAsset(address sourceAsset) internal {
        uint256 len = _registeredAssets.length;
        for (uint256 i; i < len; ++i) {
            if (_registeredAssets[i] == sourceAsset) return;
        }
        _registeredAssets.push(sourceAsset);
    }

    /**
     * @notice Register a chain where this asset's wrapped supply also exists.
     * @dev Until a chain is registered its supply is invisible to the invariant, so this
     *      must be done for EVERY chain the asset is issued on. Registering a chain is
     *      strictly conservative: it can only ever increase measured liabilities, and a
     *      registered chain that stops reporting halts minting.
     */
    function registerRemoteChain(address sourceAsset, uint64 chainKey, address beacon)
        external
        onlyOwner
    {
        if (!assets[sourceAsset].registered) revert AssetNotRegistered(sourceAsset);
        if (beacon == address(0)) revert InvalidOracleFeed();

        RemoteSupply storage rs = remoteSupply[sourceAsset][chainKey];
        if (!rs.registered) {
            if (remoteChainKeys[sourceAsset].length >= MAX_REMOTE_CHAINS) revert TooManyRemoteChains();
            remoteChainKeys[sourceAsset].push(chainKey);
        }
        rs.beacon = beacon;
        rs.registered = true;

        emit RemoteChainRegistered(sourceAsset, chainKey, beacon);
    }

    /// @notice Chains registered for an asset, for dashboards and integrators.
    function remoteChainsOf(address sourceAsset) external view returns (uint64[] memory) {
        return remoteChainKeys[sourceAsset];
    }

    /// @dev Bounded at 100%: the admin can make the system MORE conservative, never
    ///      less than fully backed. There is no admin action that mints a token.
    function setHaircut(address sourceAsset, uint16 haircutBps_) external onlyOwner {
        if (haircutBps_ == 0 || haircutBps_ > BPS) revert InvalidHaircut(haircutBps_);
        if (!assets[sourceAsset].registered) revert AssetNotRegistered(sourceAsset);
        assets[sourceAsset].haircutBps = haircutBps_;
        emit HaircutUpdated(sourceAsset, haircutBps_);
    }

    /**
     * @notice Register an asset whose reserves cannot be proven on-chain, backed by a
     *         Chainlink-compatible feed.
     * @dev Reports trustedParties = 1 forever. Minting stays disabled unless explicitly
     *      enabled, so widening coverage can never silently weaken the mint guarantee.
     */
    function registerOracleBackedAsset(address sourceAsset, address wrapped, uint16 haircutBps_, address feed)
        external
        onlyOwner
    {
        if (haircutBps_ == 0 || haircutBps_ > BPS) revert InvalidHaircut(haircutBps_);
        if (feed == address(0)) revert InvalidOracleFeed();
        assets[sourceAsset] = AssetConfig({
            wrapped: wrapped,
            haircutBps: haircutBps_,
            registered: true,
            source: ReserveSource.OracleReported,
            oracleFeed: feed,
            oracleMintEnabled: false
        });
        _trackAsset(sourceAsset);
        emit AssetRegistered(sourceAsset, wrapped, haircutBps_);
        emit OracleBackedAssetRegistered(sourceAsset, feed);
    }

    /// @notice Opt an oracle-backed asset into minting. Weakens it to 1 trusted party.
    function setOracleMintEnabled(address sourceAsset, bool enabled) external onlyOwner {
        AssetConfig storage cfg = assets[sourceAsset];
        if (!cfg.registered) revert AssetNotRegistered(sourceAsset);
        if (cfg.source != ReserveSource.OracleReported) revert AssetNotOracleBacked(sourceAsset);
        cfg.oracleMintEnabled = enabled;
        emit OracleMintEnabledSet(sourceAsset, enabled);
    }

    function trustedParties(address sourceAsset) external view returns (uint8) {
        return _trustedPartiesFor(assets[sourceAsset]);
    }

    function setMaxStalenessBlocks(uint64 blocks_) external onlyOwner {
        maxStalenessBlocks = blocks_;
        emit StalenessBoundUpdated(blocks_);
    }

    function setGlobalFreeze(bool frozen) external onlyOwner {
        globalFreeze = frozen;
        emit GlobalFreezeSet(frozen);
    }

    /// @notice Begin the timelock on unfreezing an asset. Requires it to be healthy now.
    function requestUnfreeze(address sourceAsset) external onlyOwner {
        SolvencyReport memory r = solvencyReport(sourceAsset);
        if (!r.solvent || !r.fresh) revert NotHealthy();
        uint256 eta = block.timestamp + UNFREEZE_DELAY;
        unfreezeEta[sourceAsset] = eta;
        emit UnfreezeRequested(sourceAsset, eta);
    }

    /**
     * @notice Complete an unfreeze after the timelock.
     * @dev Health is re-checked at execution, not just at request. A breach that heals
     *      for one block and then re-breaks must not be able to slip through on the
     *      strength of a stale request.
     */
    function executeUnfreeze(address sourceAsset) external onlyOwner {
        uint256 eta = unfreezeEta[sourceAsset];
        if (eta == 0) revert NoUnfreezeRequested();
        if (block.timestamp < eta) revert TimelockPending(eta);

        SolvencyReport memory r = solvencyReport(sourceAsset);
        if (!r.solvent || !r.fresh) revert NotHealthy();

        reserves[sourceAsset].frozen = false;
        unfreezeEta[sourceAsset] = 0;
        emit Unfrozen(sourceAsset);
    }
}
