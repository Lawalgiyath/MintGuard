// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title AggregatorV3Interface
 * @notice The Chainlink data-feed interface, reproduced here so MintBound can speak it
 *         in BOTH directions without taking a dependency on the Chainlink packages.
 *
 * @dev Why this matters more than it looks:
 *
 *      OUTBOUND — MintBound exposes a proven reserve THROUGH this interface
 *      (`ProvenReserveFeed`). Chainlink Proof of Reserve feeds report reserves as the
 *      `answer` field, and Secure Mint integrations already read exactly this shape.
 *      So any contract already wired to a PoR feed can point at MintBound instead and
 *      keep working, unchanged — the number simply stops being a report and starts
 *      being a proof. That turns "nobody uses this yet" into "everything already built
 *      against Secure Mint can use this today".
 *
 *      INBOUND — for reserves that genuinely cannot be proven on-chain (fiat in a bank,
 *      metal in a vault), MintBound can read a Chainlink feed instead, and label that
 *      asset honestly as oracle-reported. See ISolvencyOracle.trustedParties.
 *
 *      The consequence is that MintBound is not a competitor to Proof of Reserve. It is
 *      a strictly stronger evidence tier for the subset of reserves that live on a
 *      chain, wearing the same connector as the incumbent.
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
