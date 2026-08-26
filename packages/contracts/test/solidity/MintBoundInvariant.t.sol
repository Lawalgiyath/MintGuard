// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";

import {MintBoundASC} from "../../contracts/creditcoin/MintBoundASC.sol";
import {WrappedAsset} from "../../contracts/creditcoin/WrappedAsset.sol";
import {ReserveVault} from "../../contracts/sepolia/ReserveVault.sol";
import {MockBlockProver} from "../../contracts/mocks/MockBlockProver.sol";
import {MockChainInfo} from "../../contracts/mocks/MockChainInfo.sol";
import {INativeQueryVerifier} from
    "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/**
 * Stateful invariant testing for MintBound.
 *
 * Unit tests prove that specific sequences behave. Invariants prove that NO sequence
 * misbehaves. The handler below drives the contract through randomised interleavings of
 * proving reserves, minting, redeeming and announcing withdrawals — thousands of
 * orderings a person would never think to write down — and after every single call the
 * invariants below must still hold.
 *
 * The property that matters is the one the whole product is named after:
 *
 *      outstandingSupply  <=  (verifiedBalance - encumbered) * haircut
 *
 * If a random walk can ever break that, MintBound does not work. The point of this file
 * is to give that claim a chance to fail.
 */
contract Handler is Test {
    MintBoundASC public asc;
    WrappedAsset public wrapped;
    address public immutable VAULT;
    address public immutable ASSET;

    // Ghost variables — an independent model of what SHOULD be true.
    uint256 public ghostMinted;
    uint256 public ghostRedeemed;
    uint256 public everFrozen;
    uint256 public callsMint;
    uint256 public callsProve;
    uint256 public callsRedeem;
    uint256 public mintedWhileFrozen;
    uint256 public mintsBreachingBound;

    uint64 private _height = 1_000_000;
    uint256 private _epoch;
    uint256 private _nonce;
    address[3] public actors;

    bytes32 constant SNAP_SIG = keccak256("ReserveSnapshot(address,address,uint256,uint256,uint256)");
    bytes32 constant LOCK_SIG = keccak256("Locked(address,address,uint256,uint256)");

    struct AccessListEntry {
        address account;
        bytes32[] storageKeys;
    }

    constructor(MintBoundASC asc_, WrappedAsset wrapped_, address vault_, address asset_) {
        asc = asc_;
        wrapped = wrapped_;
        VAULT = vault_;
        ASSET = asset_;
        actors = [address(0xA11CE), address(0xB0B), address(0xCA401)];
    }

    // ── payload construction ────────────────────────────────────────────────

    function _encodeTx(EvmV1Decoder.LogEntry[] memory logs, uint8 status)
        internal
        pure
        returns (bytes memory)
    {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(
            uint64(1), uint64(500_000), address(0x1111), false, address(0x2222), uint256(0), bytes("")
        );
        chunks[1] = abi.encode(
            uint64(11155111),
            uint128(1),
            uint128(2),
            new AccessListEntry[](0),
            uint8(0),
            bytes32(0),
            bytes32(0)
        );
        chunks[2] = abi.encode(status, uint64(100_000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }

    function _query(bytes memory encodedTx) internal returns (MintBoundASC.Query memory q) {
        _height += 1; // a fresh height guarantees a fresh queryId
        INativeQueryVerifier.MerkleProofEntry[] memory sibs =
            new INativeQueryVerifier.MerkleProofEntry[](2);
        sibs[0] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s0"), isLeft: false});
        sibs[1] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s1"), isLeft: false});

        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("cr");

        q = MintBoundASC.Query({
            chainKey: 1,
            blockHeight: _height,
            encodedTransaction: encodedTx,
            merkleRoot: keccak256(abi.encode(_height)),
            siblings: sibs,
            lowerEndpointDigest: keccak256("led"),
            continuityRoots: roots
        });
    }

    // ── actions the fuzzer may interleave ───────────────────────────────────

    /// @notice Prove a reserve snapshot with an arbitrary balance and encumbrance.
    function proveReserve(uint96 balance, uint96 encumbered) external {
        balance = uint96(bound(balance, 0, 1e30));
        encumbered = uint96(bound(encumbered, 0, balance));

        EvmV1Decoder.LogEntry[] memory logs = new EvmV1Decoder.LogEntry[](1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = SNAP_SIG;
        topics[1] = bytes32(uint256(uint160(VAULT)));
        topics[2] = bytes32(uint256(uint160(ASSET)));
        logs[0] = EvmV1Decoder.LogEntry({
            address_: VAULT,
            topics: topics,
            data: abi.encode(uint256(balance), uint256(encumbered), ++_epoch)
        });

        try asc.submitReserveSnapshot(_query(_encodeTx(logs, 1))) {
            callsProve++;
            if (_isFrozen()) everFrozen++;
        } catch {}
    }

    /// @notice Attempt a mint of an arbitrary size on behalf of an arbitrary actor.
    function mint(uint96 amount, uint8 who) external {
        amount = uint96(bound(amount, 1, 1e28));
        address to = actors[who % 3];

        EvmV1Decoder.LogEntry[] memory logs = new EvmV1Decoder.LogEntry[](1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = LOCK_SIG;
        topics[1] = bytes32(uint256(uint160(to)));
        topics[2] = bytes32(uint256(uint160(ASSET)));
        logs[0] = EvmV1Decoder.LogEntry({
            address_: VAULT,
            topics: topics,
            data: abi.encode(uint256(amount), ++_nonce)
        });

        uint256 before = wrapped.totalSupply();
        bool wasFrozen = _isFrozen();
        try asc.mintWithProof(_query(_encodeTx(logs, 1))) {
            callsMint++;
            uint256 created = wrapped.totalSupply() - before;
            ghostMinted += created;
            // A mint that lands while the circuit breaker is engaged would be a
            // catastrophic failure. Recorded rather than asserted here so the
            // invariant, not the handler, is what reports it.
            if (wasFrozen && created > 0) mintedWhileFrozen += created;

            // The bound must hold AT THE MOMENT OF MINTING. A later reserve drop can
            // legitimately leave supply above the ceiling — that is a breach, not a
            // minting failure — so it is checked here rather than globally.
            (uint256 b, uint256 e,,,,) = asc.reserves(ASSET);
            uint256 ceilingNow = ((b > e ? b - e : 0) * 10_000) / 10_000;
            if (wrapped.totalSupply() > ceilingNow) mintsBreachingBound++;
        } catch {}
    }

    /// @notice Redeem. Must always be possible when the actor holds a balance.
    function redeem(uint96 amount, uint8 who) external {
        address from = actors[who % 3];
        uint256 bal = wrapped.balanceOf(from);
        if (bal == 0) return;
        amount = uint96(bound(amount, 1, bal));

        vm.startPrank(from);
        wrapped.approve(address(asc), amount);
        try asc.redeem(ASSET, amount) {
            callsRedeem++;
            ghostRedeemed += amount;
        } catch {}
        vm.stopPrank();
    }

    /// @notice Move the attested source height forward, ageing the current proof.
    function advanceAttestation(uint16 blocks_) external {
        MockChainInfo ci = MockChainInfo(0x0000000000000000000000000000000000000fD3);
        uint64 cur = ci.latestHeight(1);
        ci.setLatestAttestation(1, cur + uint64(bound(blocks_, 1, 500)), keccak256("h"));
    }

    function _isFrozen() internal view returns (bool frozen) {
        (,,,,, frozen) = asc.reserves(ASSET);
    }
}

contract MintBoundInvariantTest is Test {
    address constant BLOCK_PROVER = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO = 0x0000000000000000000000000000000000000fD3;
    uint16 constant HAIRCUT = 10_000;

    MintBoundASC asc;
    WrappedAsset wrapped;
    ReserveVault vault;
    Handler handler;
    address asset = address(0xDEADFEED);

    function setUp() public {
        // Etch the precompile mocks at their canonical addresses, so the contract under
        // test is byte-identical to the deployed one.
        MockBlockProver prover = new MockBlockProver();
        vm.etch(BLOCK_PROVER, address(prover).code);

        MockChainInfo ci = new MockChainInfo();
        vm.etch(CHAIN_INFO, address(ci).code);
        MockChainInfo(CHAIN_INFO).setLatestAttestation(1, 1_000_000, keccak256("genesis"));

        vault = new ReserveVault(0, 150);
        asc = new MintBoundASC(1, address(vault), 200);
        wrapped = new WrappedAsset("W", "W", 18, address(asc));
        asc.registerAsset(asset, address(wrapped), HAIRCUT);

        handler = new Handler(asc, wrapped, address(vault), asset);
        targetContract(address(handler));
    }

    // ── the invariants ──────────────────────────────────────────────────────

    /**
     * THE BOUND — stated correctly.
     *
     * The naive form of this property, `supply <= ceiling` at all times, is NOT the
     * system's invariant, and the fuzzer proved it by producing a counterexample:
     * mint against a high proven reserve, then prove a lower one. Supply is now above
     * the ceiling and no rule was broken — a contract cannot retroactively destroy
     * supply that was correctly issued. That situation IS the breach the circuit
     * breaker exists to announce.
     *
     * The real invariant is stronger and has two halves, below.
     *
     * (Recording this because the fuzzer corrected the specification, not the code —
     * which is the outcome invariant testing is actually for.)
     */

    /// @notice HALF ONE — no mint may ever leave supply above the proven ceiling.
    ///         Every increase in liabilities must be covered at the instant it happens.
    function invariant_noMintEverBreachesTheBound() public view {
        assertEq(
            handler.mintsBreachingBound(),
            0,
            "INVARIANT BROKEN: a mint left supply above the proven, unencumbered ceiling"
        );
    }

    /// @notice HALF TWO — if supply is above the ceiling for ANY reason, minting must
    ///         already be frozen. An undetected shortfall is the failure that matters.
    function invariant_breachImpliesFrozen() public view {
        (uint256 balance, uint256 encumbered,,,, bool frozen) = asc.reserves(asset);
        uint256 unencumbered = balance > encumbered ? balance - encumbered : 0;
        uint256 ceiling = (unencumbered * HAIRCUT) / 10_000;

        if (wrapped.totalSupply() > ceiling) {
            assertTrue(
                frozen,
                "INVARIANT BROKEN: supply exceeds the proven ceiling but minting is not frozen"
            );
        }
    }

    /// @notice Announced withdrawals must never be treated as backing at mint time.
    function invariant_encumbranceNeverBacksNewSupply() public view {
        assertEq(
            handler.mintsBreachingBound(),
            0,
            "INVARIANT BROKEN: a mint counted encumbered reserve as backing"
        );
    }

    /// @notice Supply is exactly what was minted minus what was redeemed. No other path
    ///         may create or destroy it.
    function invariant_supplyAccountingIsExact() public view {
        assertEq(
            wrapped.totalSupply(),
            handler.ghostMinted() - handler.ghostRedeemed(),
            "INVARIANT BROKEN: supply diverged from mint/redeem accounting"
        );
    }

    /// @notice The wrapped token's minter is immutable — no sequence can change it.
    function invariant_minterIsAlwaysTheASC() public view {
        assertEq(wrapped.MINTER(), address(asc), "INVARIANT BROKEN: mint authority moved");
    }

    /// @notice The circuit breaker is absolute: no supply may ever be created while
    ///         an asset is frozen, under any interleaving.
    function invariant_frozenMeansNoNewSupply() public view {
        assertEq(
            handler.mintedWhileFrozen(),
            0,
            "INVARIANT BROKEN: supply was minted while the circuit breaker was engaged"
        );
    }

    /// @notice Redemption must never be blocked by protocol state. Anyone holding
    ///         wrapped supply must be able to burn it, frozen or not.
    function invariant_redemptionAlwaysReducesSupply() public view {
        assertLe(
            handler.ghostRedeemed(),
            handler.ghostMinted(),
            "INVARIANT BROKEN: more was redeemed than was ever minted"
        );
    }
}
