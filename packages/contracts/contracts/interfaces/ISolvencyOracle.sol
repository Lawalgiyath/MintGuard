// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title ISolvencyOracle
 * @notice The public read surface of MintBound. Any Creditcoin contract can gate its
 *         own logic on the live, cryptographically-proven solvency of a wrapped asset.
 *
 * @dev Every value returned here traces back to a Merkle + continuity proof of a
 *      specific source-chain transaction, verified synchronously by the Block Prover
 *      precompile. Nothing here is an oracle report, an aggregated feed, or a
 *      heartbeat. There is no reporter to trust and none to bribe.
 *
 *      Integration is two lines:
 *          ISolvencyOracle o = ISolvencyOracle(MINTBOUND);
 *          require(o.isSolvent(asset), "collateral not proven solvent");
 */
interface ISolvencyOracle {
    /// @notice Full solvency picture for one source asset.
    struct SolvencyReport {
        uint256 verifiedReserve;      // last cryptographically proven source-chain balance
        uint256 encumberedReserve;    // announced withdrawals, already excluded from backing
        uint256 outstandingSupply;    // wrapped totalSupply on Creditcoin (liabilities)
        uint256 maxMintable;          // verifiedReserve * haircut, minus outstanding
        uint32 collateralRatioBps;    // (verifiedReserve * haircut) / supply, in bps
        uint64 attestedAtHeight;      // source height of the proven snapshot
        uint64 latestAttestedHeight;  // source height Creditcoin has attested to now
        uint64 stalenessBlocks;       // latestAttestedHeight - attestedAtHeight
        uint64 epoch;                 // monotonic snapshot counter
        uint16 haircutBps;            // risk discount applied to the reserve
        uint64 provenAt;              // when the proof landed on Creditcoin
        /**
         * How many off-chain parties must be trusted for this asset's reserve figure.
         * 0 for cryptographically proven reserves. 1 when the figure comes from an
         * external oracle feed, which is honest but strictly weaker evidence.
         * No other reserve system publishes this number.
         */
        uint8 trustedParties;
        bool fresh;                   // staleness within the configured bound
        bool solvent;                 // discounted reserve covers outstanding supply
        bool mintFrozen;              // circuit breaker engaged
    }

    /// @notice True only if the asset is proven solvent AND the proof is fresh AND not frozen.
    /// @dev This is the single call an integrating contract should gate on.
    function isSolvent(address sourceAsset) external view returns (bool);

    /// @notice Collateral ratio in basis points. 10000 = exactly 100% covered.
    function collateralRatioBps(address sourceAsset) external view returns (uint32);

    /// @notice Last proven source-chain reserve and the source height it was proven at.
    function verifiedReserve(address sourceAsset) external view returns (uint256 balance, uint64 atHeight);

    /// @notice Everything a dashboard or an integrating contract could want, in one call.
    function solvencyReport(address sourceAsset) external view returns (SolvencyReport memory);

    /// @notice How many off-chain parties this asset's reserve figure depends on.
    /// @dev Gate on `== 0` to accept only cryptographically proven collateral.
    function trustedParties(address sourceAsset) external view returns (uint8);
}
