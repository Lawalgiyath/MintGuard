// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";

import {IChainInfo, ChainInfoLib} from "../interfaces/IChainInfo.sol";

interface IReserveHeight {
    function reserves(address sourceAsset)
        external
        view
        returns (
            uint256 verifiedBalance,
            uint256 encumbered,
            uint64 attestedAtHeight,
            uint64 provenAt,
            uint64 epoch,
            bool frozen
        );
}

/**
 * @title SolvencyContinuity
 * @notice Turns point-in-time proof of reserve into proof of reserve over an INTERVAL.
 *
 * @dev THE PROBLEM, WHICH THE INDUSTRY NAMES AND HAS NOT SOLVED.
 *
 *      Every proof of reserve — ours included, until this contract — is a snapshot. It
 *      says the reserve was X at height H. It says nothing whatsoever about height H+1.
 *      The gap between snapshots is where reserves drift, are re-pledged, or disappear,
 *      and it is the structural criticism of the entire category. Continuous proof of
 *      reserve is widely described as the goal and, as of 2026, is not implemented
 *      anywhere at scale because proving a balance held over time appears to require
 *      either constant snapshotting or heavy cryptography.
 *
 *      THE ASYMMETRY THIS EXPLOITS.
 *
 *      You cannot cheaply prove a negative — "no funds left this vault" would require
 *      enumerating every transaction in the interval. But you CAN cheaply prove the
 *      positive that refutes it: a single inclusion proof of one outbound transfer.
 *
 *      So the negative is asserted optimistically under bond, and refuted
 *      cryptographically. One outbound transfer, proven once, destroys the claim.
 *
 *      WHY THIS IS DIFFERENT FROM THE OPTIMISTIC SYSTEMS IT RESEMBLES.
 *
 *      Bonded assertions with challenge windows are not new — UMA's Optimistic Oracle
 *      and optimistic rollups both work this way, and this contract borrows their shape
 *      without apology. The difference is what happens when someone disputes.
 *
 *        UMA          escalates to a token-holder VOTE. A 65% majority of staked UMA
 *                     decides what was true. Dispute resolution is social.
 *        Rollups      re-execute their own state transition. Deterministic, but only
 *                     ever about the rollup's own chain.
 *        This         verifies a Merkle + continuity proof of a FOREIGN chain's
 *                     transaction, in native code, in the disputing transaction.
 *                     No vote. No committee. No re-execution. No subjectivity.
 *
 *      That is only possible because Creditcoin can natively verify another chain's
 *      transactions. On Ethereum an optimistic claim about Ethereum's own state can be
 *      re-executed; an optimistic claim about a foreign chain has to fall back to a
 *      committee. Attestcoin removes the committee, which is what makes an optimistic
 *      construction acceptable for a solvency guarantee rather than merely convenient.
 *
 *      THE SOUNDNESS ARGUMENT.
 *
 *      An ERC-20 balance decreases only through a Transfer event with `from` set to the
 *      holder. Therefore:
 *
 *          balance(V) = X at height A                       (proven by snapshot)
 *        ∧ no Transfer(from = V) in (A, B]                  (asserted, disprovable)
 *        ⟹ balance(V) ≥ X for every height in [A, B]
 *
 *      Not interpolated between two points. Established across the whole interval.
 *      Deposits only add, so the bound holds in the safe direction throughout.
 *
 *      Coverage is contiguous by construction: an assertion must begin exactly where
 *      coverage currently ends. Gaps cannot be skipped over, because a claim about a
 *      disconnected interval would prove nothing about the reserve backing supply now.
 */
contract SolvencyContinuity {
    INativeQueryVerifier public immutable VERIFIER;
    IChainInfo public immutable CHAIN_INFO;
    IReserveHeight public immutable ASC;

    uint64 public immutable SOURCE_CHAIN_KEY;
    address public immutable CANONICAL_VAULT;

    /// @notice Minimum bond an assertion must post.
    uint256 public immutable MIN_BOND;

    /// @notice Seconds a claim stays open to disproof.
    uint64 public immutable LIVENESS;

    /// @dev Long enough that a challenger can notice, fetch a proof and submit it.
    uint64 public constant MIN_LIVENESS = 1 hours;

    /// @dev keccak256("Transfer(address,address,uint256)")
    bytes32 public constant TRANSFER_SIG =
        0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    struct Claim {
        address asset;
        address asserter;
        uint64 fromHeight;
        uint64 toHeight;
        uint64 settleAfter;
        uint256 bond;
        bool settled;
        bool disproven;
    }

    /// @notice Open and historical no-outflow claims.
    mapping(bytes32 => Claim) public claims;

    /// @notice Highest source height with contiguous, unrefuted no-outflow coverage.
    mapping(address => uint64) public coveredThrough;

    /// @notice A claim currently open for this asset, if any. One at a time keeps
    ///         coverage strictly contiguous and makes the state trivial to reason about.
    mapping(address => bytes32) public openClaim;

    uint256 private _nonce;

    /// @dev Mirrors MintBoundASC.Query so the proof payload is identical.
    struct Query {
        uint64 chainKey;
        uint64 blockHeight;
        bytes encodedTransaction;
        bytes32 merkleRoot;
        INativeQueryVerifier.MerkleProofEntry[] siblings;
        bytes32 lowerEndpointDigest;
        bytes32[] continuityRoots;
    }

    event ContinuityAsserted(
        bytes32 indexed claimId,
        address indexed asset,
        address indexed asserter,
        uint64 fromHeight,
        uint64 toHeight,
        uint256 bond,
        uint64 settleAfter
    );
    event ContinuityProven(bytes32 indexed claimId, address indexed asset, uint64 coveredThrough);
    event ContinuityRefuted(
        bytes32 indexed claimId,
        address indexed asset,
        address indexed challenger,
        uint64 outflowHeight,
        uint256 amount,
        uint256 bondPaid
    );

    error BondTooSmall(uint256 sent, uint256 required);
    error ClaimAlreadyOpen(address asset, bytes32 claimId);
    error NonContiguous(uint64 given, uint64 expected);
    error EmptyInterval();
    error BeyondAttestation(uint64 toHeight, uint64 latestAttested);
    error UnknownClaim(bytes32 claimId);
    error ClaimClosed(bytes32 claimId);
    error StillLive(bytes32 claimId, uint64 settleAfter);
    error WrongChainKey(uint64 got, uint64 expected);
    error VerificationFailed();
    error SourceTransactionReverted();
    error UnsupportedTransactionType(uint8 txType);
    error HeightOutsideInterval(uint64 height, uint64 fromHeight, uint64 toHeight);
    error NoOutflowFound();
    error NoAnchor(address asset);
    error BondTransferFailed();

    constructor(
        address asc,
        uint64 sourceChainKey,
        address canonicalVault,
        uint256 minBond,
        uint64 liveness
    ) {
        require(liveness >= MIN_LIVENESS, "liveness too short");
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        CHAIN_INFO = ChainInfoLib.get();
        ASC = IReserveHeight(asc);
        SOURCE_CHAIN_KEY = sourceChainKey;
        CANONICAL_VAULT = canonicalVault;
        MIN_BOND = minBond;
        LIVENESS = liveness;
    }

    // -------------------------------------------------------------------------
    // Assert
    // -------------------------------------------------------------------------

    /**
     * @notice Assert, under bond, that no reserve left the vault across an interval.
     * @dev Permissionless. Anyone may assert — the custodian, a holder, a watchtower —
     *      because the assertion carries no authority. It is a wager that a specific
     *      negative is true, settled by whether anyone can produce a counterexample.
     *
     *      Three constraints make the claim meaningful rather than decorative:
     *
     *      1. `fromHeight` must equal where coverage currently ends. A claim about a
     *         disconnected interval proves nothing about the reserve backing supply now.
     *      2. `toHeight` must already be attested on Creditcoin. Asserting over blocks
     *         nobody can yet prove anything about would make the claim unfalsifiable —
     *         and an unfalsifiable claim accepted by default is worse than no claim.
     *      3. One open claim per asset, so coverage advances in a single chain.
     */
    function assertNoOutflow(address asset, uint64 fromHeight, uint64 toHeight)
        external
        payable
        returns (bytes32 claimId)
    {
        if (msg.value < MIN_BOND) revert BondTooSmall(msg.value, MIN_BOND);

        bytes32 open = openClaim[asset];
        if (open != bytes32(0) && !claims[open].settled && !claims[open].disproven) {
            revert ClaimAlreadyOpen(asset, open);
        }

        uint64 anchor = anchorHeight(asset);
        if (anchor == 0) revert NoAnchor(asset);
        if (fromHeight != anchor) revert NonContiguous(fromHeight, anchor);
        if (toHeight <= fromHeight) revert EmptyInterval();

        uint64 latest = CHAIN_INFO.get_latest_attestation_height_and_hash(SOURCE_CHAIN_KEY).height;
        if (toHeight > latest) revert BeyondAttestation(toHeight, latest);

        claimId = keccak256(abi.encode(asset, fromHeight, toHeight, ++_nonce, block.chainid));
        uint64 settleAfter = uint64(block.timestamp) + LIVENESS;

        claims[claimId] = Claim({
            asset: asset,
            asserter: msg.sender,
            fromHeight: fromHeight,
            toHeight: toHeight,
            settleAfter: settleAfter,
            bond: msg.value,
            settled: false,
            disproven: false
        });
        openClaim[asset] = claimId;

        emit ContinuityAsserted(claimId, asset, msg.sender, fromHeight, toHeight, msg.value, settleAfter);
    }

    /// @notice Where a new claim must start: current coverage, or the last proven snapshot.
    function anchorHeight(address asset) public view returns (uint64) {
        uint64 covered = coveredThrough[asset];
        if (covered != 0) return covered;
        (,, uint64 attestedAtHeight,,,) = ASC.reserves(asset);
        return attestedAtHeight;
    }

    // -------------------------------------------------------------------------
    // Refute
    // -------------------------------------------------------------------------

    /**
     * @notice Destroy a claim with a single proof that reserve did leave the vault.
     * @dev The whole design rests on this being cheap and permissionless. The challenger
     *      needs one transaction, from anywhere in the interval, in which the asset's
     *      own token contract emitted `Transfer(from = vault, ...)`. The Block Prover
     *      verifies it in native code; nobody votes on whether it counts.
     *
     *      The bond goes to the challenger. Watching is therefore paid work, which is
     *      what makes the optimistic assumption reasonable rather than hopeful.
     */
    function disprove(bytes32 claimId, Query calldata q) external returns (bool) {
        Claim storage c = claims[claimId];
        if (c.asset == address(0)) revert UnknownClaim(claimId);
        if (c.settled || c.disproven) revert ClaimClosed(claimId);

        if (q.chainKey != SOURCE_CHAIN_KEY) revert WrongChainKey(q.chainKey, SOURCE_CHAIN_KEY);
        if (q.blockHeight <= c.fromHeight || q.blockHeight > c.toHeight) {
            revert HeightOutsideInterval(q.blockHeight, c.fromHeight, c.toHeight);
        }

        _verify(q);
        uint256 amount = _findVaultOutflow(q.encodedTransaction, c.asset);

        c.disproven = true;
        uint256 bond = c.bond;
        c.bond = 0;

        emit ContinuityRefuted(claimId, c.asset, msg.sender, q.blockHeight, amount, bond);

        (bool ok,) = payable(msg.sender).call{value: bond}("");
        if (!ok) revert BondTransferFailed();
        return true;
    }

    // -------------------------------------------------------------------------
    // Settle
    // -------------------------------------------------------------------------

    /**
     * @notice Close an unrefuted claim and extend continuous coverage.
     * @dev After this, the reserve is proven to have held across the whole interval —
     *      not sampled at its endpoints. Permissionless: the asserter has no special
     *      right to settle their own claim, and no way to prevent someone else doing it.
     */
    function settle(bytes32 claimId) external returns (uint64 newCoverage) {
        Claim storage c = claims[claimId];
        if (c.asset == address(0)) revert UnknownClaim(claimId);
        if (c.settled || c.disproven) revert ClaimClosed(claimId);
        if (block.timestamp < c.settleAfter) revert StillLive(claimId, c.settleAfter);

        c.settled = true;
        coveredThrough[c.asset] = c.toHeight;
        newCoverage = c.toHeight;

        uint256 bond = c.bond;
        c.bond = 0;

        emit ContinuityProven(claimId, c.asset, c.toHeight);

        if (bond > 0) {
            (bool ok,) = payable(c.asserter).call{value: bond}("");
            if (!ok) revert BondTransferFailed();
        }
    }

    // -------------------------------------------------------------------------
    // Read surface
    // -------------------------------------------------------------------------

    /// @notice Whether reserve continuity is established from `sinceHeight` to now.
    function isContinuouslyProven(address asset, uint64 sinceHeight) external view returns (bool) {
        uint64 covered = coveredThrough[asset];
        if (covered == 0 || sinceHeight > covered) return false;
        uint64 latest = CHAIN_INFO.get_latest_attestation_height_and_hash(SOURCE_CHAIN_KEY).height;
        return covered >= latest ? true : false;
    }

    /// @notice Attested source blocks not yet covered by a continuity claim.
    /// @dev This is the honest measure of how much of recent history is still only
    ///      known point-in-time. Zero means fully continuous to the attested tip.
    function uncoveredBlocks(address asset) external view returns (uint64) {
        uint64 latest = CHAIN_INFO.get_latest_attestation_height_and_hash(SOURCE_CHAIN_KEY).height;
        uint64 covered = coveredThrough[asset];
        if (covered == 0 || latest <= covered) return covered == 0 ? latest : 0;
        return latest - covered;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    function _verify(Query calldata q) internal {
        INativeQueryVerifier.MerkleProof memory mp =
            INativeQueryVerifier.MerkleProof({root: q.merkleRoot, siblings: q.siblings});
        INativeQueryVerifier.ContinuityProof memory cp = INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: q.lowerEndpointDigest,
            roots: q.continuityRoots
        });
        if (!VERIFIER.verifyAndEmit(q.chainKey, q.blockHeight, q.encodedTransaction, mp, cp)) {
            revert VerificationFailed();
        }
    }

    /**
     * @dev Find a Transfer emitted BY the asset's token contract moving value OUT of the
     *      canonical vault. Both bindings matter: the emitter must be the real token
     *      (or any contract could fake a Transfer log), and `from` must be the vault.
     */
    function _findVaultOutflow(bytes memory encodedTx, address asset)
        internal
        view
        returns (uint256 amount)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTx);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTx);
        if (receipt.receiptStatus != 1) revert SourceTransactionReverted();

        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, TRANSFER_SIG);

        uint256 len = logs.length;
        for (uint256 i; i < len; ++i) {
            EvmV1Decoder.LogEntry memory log = logs[i];
            if (log.address_ != asset) continue; // must be the real token contract
            if (log.topics.length != 3) continue;
            if (address(uint160(uint256(log.topics[1]))) != CANONICAL_VAULT) continue; // from
            if (log.data.length != 32) continue;

            amount = abi.decode(log.data, (uint256));
            if (amount > 0) return amount;
        }
        revert NoOutflowFound();
    }

    /// @dev Bonds arrive via assertNoOutflow only; reject stray value.
    receive() external payable {
        revert("use assertNoOutflow");
    }
}
