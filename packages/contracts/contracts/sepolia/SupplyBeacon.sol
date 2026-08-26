// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Supply {
    function totalSupply() external view returns (uint256);
}

/**
 * @title SupplyBeacon
 * @notice Publishes a wrapped token's total supply on a remote chain as a provable log,
 *         so Creditcoin can verify LIABILITIES the same way it verifies assets.
 *
 * @dev THE PROBLEM THIS EXISTS FOR.
 *
 *      A wrapped asset almost never lives on one chain. The reserve sits in one vault;
 *      the wrapped supply is issued on several. Every proof-of-reserve check in
 *      production — including Chainlink's published guidance for wrapped tokens, which
 *      addresses the single source-to-destination bridge case — compares reserve against
 *      the supply on ONE destination chain.
 *
 *      That check passes on every chain simultaneously while the system as a whole is
 *      insolvent. One reserve of 100 can back a supply of 100 on chain A, 100 on chain B
 *      and 100 on chain C. Each chain's PoR reads 100% collateralised. The aggregate is
 *      33%. Nothing in a per-chain design can see it, because no per-chain design ever
 *      looks at the other chains.
 *
 *      This is not hypothetical. Multichain (July 2023) operated wrapped assets across
 *      Fantom, Moonriver, Dogechain, Arbitrum, Polygon, Optimism, Avalanche, BNB Chain,
 *      Moonbeam and Ethereum against custodied reserves, held roughly $1.26B, and lost
 *      approximately $126-130M when centralised control failed. A per-chain reserve check
 *      is exactly the wrong instrument for that shape of system.
 *
 *      THE FIX IS THE SAME TRICK, POINTED THE OTHER WAY.
 *
 *      MintBound already lifts a source-chain BALANCE into an event so the Block Prover
 *      can prove it. This lifts a remote-chain SUPPLY into an event for the same reason.
 *      Creditcoin then verifies both sides by inclusion proof and enforces:
 *
 *          Σ supply(every chain)  ≤  (reserve − encumbered) × haircut
 *
 *      Which is what Provisions (CCS 2015) actually asks for: a proof of assets and a
 *      proof of liabilities, evaluated against the same commitment moment. Our earlier
 *      claim that liabilities were "trivially public" held only while supply existed on
 *      exactly one chain. On any real wrapped asset it does not.
 *
 *      Deploy one of these on every chain where the wrapped asset is issued. Anyone may
 *      call `snapshotSupply()`; withholding it halts minting rather than hiding anything.
 */
contract SupplyBeacon {
    /// @notice The wrapped token whose supply this beacon reports.
    IERC20Supply public immutable TOKEN;

    /// @notice Blocks between snapshots. Anti-spam only.
    uint256 public immutable MIN_GAP;

    uint256 public epoch;
    uint256 public lastSnapshotBlock;

    /// @dev topics: [sig, beacon, token]; data: abi.encode(totalSupply, epoch) — 64 bytes.
    ///      Deliberately the same shape as ReserveSnapshot so one decoder path serves both.
    event SupplySnapshot(
        address indexed beacon, address indexed token, uint256 totalSupply, uint256 epoch
    );

    error TooSoon(uint256 nextAllowedBlock);

    constructor(address token, uint256 minGap) {
        TOKEN = IERC20Supply(token);
        MIN_GAP = minGap;
    }

    /**
     * @notice Publish this chain's outstanding supply as a provable fact.
     * @dev Permissionless, for the same reason reserve snapshots are: if only the issuer
     *      could publish, the issuer could hide supply by staying quiet. Anyone noticing
     *      an inflated supply can prove it themselves.
     */
    function snapshotSupply() external returns (uint256 supply, uint256 newEpoch) {
        uint256 nextAllowed = lastSnapshotBlock + MIN_GAP;
        if (lastSnapshotBlock != 0 && block.number < nextAllowed) revert TooSoon(nextAllowed);

        supply = TOKEN.totalSupply();
        lastSnapshotBlock = block.number;
        newEpoch = ++epoch;

        emit SupplySnapshot(address(this), address(TOKEN), supply, newEpoch);
    }

    function canSnapshot() external view returns (bool) {
        return lastSnapshotBlock == 0 || block.number >= lastSnapshotBlock + MIN_GAP;
    }

    function currentSupply() external view returns (uint256) {
        return TOKEN.totalSupply();
    }
}
