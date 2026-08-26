// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISolvencyOracle} from "../../interfaces/ISolvencyOracle.sol";

/**
 * @title SolvencyGatedCredit
 * @notice A deliberately minimal lending market that refuses to accept a wrapped asset
 *         as collateral unless MintBound can currently PROVE it is fully backed.
 *
 * @dev This contract exists to make one argument concretely rather than rhetorically:
 *      MintBound is infrastructure, not an app. The integration is two lines, and the
 *      thing being consumed is not a price feed or an oracle report -- it is a live
 *      cryptographic solvency proof.
 *
 *      Contrast with how this is done today. A lending market accepting a wrapped RWA
 *      has no way to know the backing is still there; it learns about a depeg from the
 *      price feed, which is to say it learns after the market has already priced in
 *      the loss. Here the collateral check fails at the moment the reserve proof goes
 *      stale or the coverage ratio drops -- before any price has moved, because nothing
 *      about this depends on a market observing anything.
 */
contract SolvencyGatedCredit {
    using SafeERC20 for IERC20;

    ISolvencyOracle public immutable ORACLE;

    /// @notice Minimum proven coverage required to post collateral, in bps.
    uint32 public immutable MIN_RATIO_BPS;

    mapping(address => mapping(address => uint256)) public collateral; // user => wrapped => amount

    event CollateralPosted(address indexed user, address indexed wrapped, uint256 amount, uint32 provenRatioBps);
    event CollateralWithdrawn(address indexed user, address indexed wrapped, uint256 amount);

    error CollateralNotProvenSolvent(address sourceAsset, uint32 ratioBps);
    error InsufficientCollateral();

    constructor(address oracle, uint32 minRatioBps) {
        ORACLE = ISolvencyOracle(oracle);
        MIN_RATIO_BPS = minRatioBps;
    }

    /**
     * @notice Post wrapped collateral. Reverts unless the backing is provably there.
     * @dev The entire integration surface of MintBound is these two calls.
     */
    function postCollateral(address sourceAsset, address wrapped, uint256 amount) external {
        // ---- the integration, in full ----
        uint32 ratio = ORACLE.collateralRatioBps(sourceAsset);
        if (!ORACLE.isSolvent(sourceAsset) || ratio < MIN_RATIO_BPS) {
            revert CollateralNotProvenSolvent(sourceAsset, ratio);
        }
        // ----------------------------------

        IERC20(wrapped).safeTransferFrom(msg.sender, address(this), amount);
        collateral[msg.sender][wrapped] += amount;
        emit CollateralPosted(msg.sender, wrapped, amount, ratio);
    }

    /**
     * @notice Withdraw collateral.
     * @dev Ungated on purpose, mirroring MintBound's own asymmetry: entering a position
     *      that depends on proven solvency requires proof, leaving one never does.
     */
    function withdrawCollateral(address wrapped, uint256 amount) external {
        uint256 bal = collateral[msg.sender][wrapped];
        if (bal < amount) revert InsufficientCollateral();
        collateral[msg.sender][wrapped] = bal - amount;
        IERC20(wrapped).safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, wrapped, amount);
    }

    /// @notice Whether this market would currently accept the asset, and why.
    function acceptsCollateral(address sourceAsset) external view returns (bool accepted, uint32 ratioBps) {
        ratioBps = ORACLE.collateralRatioBps(sourceAsset);
        accepted = ORACLE.isSolvent(sourceAsset) && ratioBps >= MIN_RATIO_BPS;
    }
}
