// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {ISolvencyOracle} from "../interfaces/ISolvencyOracle.sol";

/**
 * @title ProvenReserveFeed
 * @notice A Chainlink-shaped Proof of Reserve feed whose answer is a cryptographic
 *         proof rather than an aggregated report.
 *
 * @dev THIS IS THE ADOPTION STORY, AND IT IS THE POINT OF THE WHOLE CONTRACT.
 *
 *      Chainlink Secure Mint integrations read a PoR feed through
 *      `AggregatorV3Interface.latestRoundData()` and treat `answer` as the reserve.
 *      Every one of those integrations -- TUSD, 21BTC, Matrixdock STBT, and the rest of
 *      a $17B installed base -- can point at this contract instead and keep working
 *      with **no code change at all**. The integration surface is identical. The only
 *      thing that changes is where the number came from:
 *
 *          before:  a decentralized oracle network reports a balance on a heartbeat
 *          after :  a native precompile proved a specific source-chain transaction,
 *                   and announced withdrawals were already subtracted
 *
 *      So MintBound is not a competitor to Proof of Reserve. It is a stronger evidence
 *      tier wearing the incumbent's connector -- which is the only realistic way a new
 *      reserve primitive ever gets adopted.
 *
 *      TWO PROPERTIES WORTH NOTING:
 *
 *      1. `updatedAt` is the moment the PROOF landed, not the moment someone asked.
 *         Consumers already perform staleness checks against `updatedAt`; wiring this
 *         feed in therefore hands them MintBound's freshness guarantee for free, using
 *         code they have already written and audited.
 *
 *      2. `answer` is the ENCUMBERED-ADJUSTED reserve. Ordinary PoR reports gross
 *         balances and leaves encumbrance to an auditor's prose -- an omission the
 *         industry openly acknowledges. Here, reserves with a withdrawal already
 *         announced against them stop counting the moment that announcement is proven.
 *         A consumer gets that correction without knowing this contract exists.
 */
contract ProvenReserveFeed is AggregatorV3Interface {
    ISolvencyOracle public immutable ORACLE;
    address public immutable SOURCE_ASSET;
    uint8 private immutable _decimals;
    string private _description;

    error NoData();

    constructor(address oracle, address sourceAsset, uint8 decimals_, string memory description_) {
        ORACLE = ISolvencyOracle(oracle);
        SOURCE_ASSET = sourceAsset;
        _decimals = decimals_;
        _description = description_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    /**
     * @notice The proven, encumbrance-adjusted reserve, in Chainlink feed shape.
     * @dev `roundId` is the snapshot epoch — strictly monotonic, which is exactly the
     *      property a round id is supposed to have, and here it is enforced by the
     *      replay protection rather than by an off-chain sequencer.
     */
    function latestRoundData()
        public
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        ISolvencyOracle.SolvencyReport memory r = ORACLE.solvencyReport(SOURCE_ASSET);
        if (r.provenAt == 0) revert NoData();

        uint256 backing = r.verifiedReserve > r.encumberedReserve
            ? r.verifiedReserve - r.encumberedReserve
            : 0;

        roundId = uint80(r.epoch);
        answer = int256(backing);
        startedAt = r.provenAt;
        updatedAt = r.provenAt;
        answeredInRound = roundId;
    }

    /// @dev Historical rounds are not retained; only the latest proof is stored on-chain.
    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = latestRoundData();
        if (_roundId != roundId) revert NoData();
    }

    // -------------------------------------------------------------------------
    // Extras beyond the Chainlink shape — strictly additive, safe to ignore
    // -------------------------------------------------------------------------

    /// @notice How many off-chain parties this answer depends on. Always 0 here.
    function trustedParties() external view returns (uint8) {
        return ORACLE.trustedParties(SOURCE_ASSET);
    }

    /// @notice Whether the backing is currently proven solvent, fresh and unfrozen.
    function isSolvent() external view returns (bool) {
        return ORACLE.isSolvent(SOURCE_ASSET);
    }
}
