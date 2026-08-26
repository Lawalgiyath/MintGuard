// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AggregatorV3Interface} from "../../interfaces/AggregatorV3Interface.sol";
import {ISolvencyOracle} from "../../interfaces/ISolvencyOracle.sol";

/**
 * @title ConventionalPoRFeed
 * @notice A deliberate model of how proof-of-reserve feeds behave today, so the two
 *         approaches can be compared side by side against the same underlying reserve.
 *
 * @dev READ THIS BEFORE DRAWING CONCLUSIONS FROM IT.
 *
 *      This is NOT a Chainlink feed, is not affiliated with Chainlink, and makes no
 *      claim about the correctness or quality of any real oracle network. Chainlink
 *      Proof of Reserve is production infrastructure securing billions of dollars and
 *      is substantially more sophisticated than this contract.
 *
 *      What this models is narrow and specific: the two STRUCTURAL properties that any
 *      report-on-a-heartbeat design has, independent of how well it is engineered.
 *
 *        1. IT REPORTS GROSS. A reserve figure is a balance. Whether some of that
 *           balance is already promised to a departing party — encumbered — is not
 *           expressible in a single number, and is conventionally handled in an
 *           auditor's periodic report rather than on-chain. The PoR industry states
 *           this limitation openly.
 *
 *        2. IT UPDATES ON A HEARTBEAT. Between updates, the published answer is the
 *           last one, however much the underlying reserve has moved since.
 *
 *      Both are consequences of reporting rather than proving. Neither is a bug.
 *      MintBound's `ProvenReserveFeed` serves the identical interface, sourced from a
 *      per-transaction proof and net of announced withdrawals — so any divergence
 *      between the two is a direct, visible measure of what proving buys over
 *      reporting, on the same reserve, at the same instant.
 *
 *      Used by the dashboard's divergence panel. Testnet demonstration only.
 */
contract ConventionalPoRFeed is AggregatorV3Interface {
    ISolvencyOracle public immutable ORACLE;
    address public immutable SOURCE_ASSET;
    uint8 private immutable _decimals;

    /// @notice Seconds between permitted heartbeat updates.
    uint256 public immutable HEARTBEAT;

    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _round;

    event Poked(uint80 indexed round, int256 answer, uint256 at);

    error TooSoon(uint256 nextAllowed);

    constructor(address oracle, address sourceAsset, uint8 decimals_, uint256 heartbeat) {
        ORACLE = ISolvencyOracle(oracle);
        SOURCE_ASSET = sourceAsset;
        _decimals = decimals_;
        HEARTBEAT = heartbeat;
        _poke();
    }

    /// @notice Publish a fresh reading. Rate-limited to the heartbeat, as a real feed is.
    function poke() external {
        if (block.timestamp < _updatedAt + HEARTBEAT) revert TooSoon(_updatedAt + HEARTBEAT);
        _poke();
    }

    /// @dev Reports the GROSS reserve. Encumbrances are deliberately ignored — that is
    ///      the property being modelled.
    function _poke() internal {
        ISolvencyOracle.SolvencyReport memory r = ORACLE.solvencyReport(SOURCE_ASSET);
        _answer = int256(r.verifiedReserve);
        _updatedAt = block.timestamp;
        _round += 1;
        emit Poked(_round, _answer, _updatedAt);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "Conventional PoR model (gross, heartbeat) - demonstration only";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function latestRoundData()
        public
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_round, _answer, _updatedAt, _updatedAt, _round);
    }

    function getRoundData(uint80)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return latestRoundData();
    }

    /// @notice Seconds since this feed last published. The staleness a consumer inherits.
    function ageSeconds() external view returns (uint256) {
        return block.timestamp - _updatedAt;
    }
}
