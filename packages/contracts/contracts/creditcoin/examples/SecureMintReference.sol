// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AggregatorV3Interface} from "../../interfaces/AggregatorV3Interface.sol";

/**
 * @title SecureMintReference
 * @notice A faithful reproduction of the Chainlink Proof of Reserve "Secure Mint"
 *         pattern, written exactly as an integrator would write it against a Chainlink
 *         feed — with NO knowledge that MintBound exists.
 *
 * @dev This contract is evidence, not a product.
 *
 *      The pattern is Chainlink's, documented as: before minting, read the PoR feed,
 *      check the reserve covers `totalSupply + amount`, revert otherwise, and reject a
 *      stale answer. Nothing below is MintBound-aware: it imports only
 *      AggregatorV3Interface, stores a feed address, and calls `latestRoundData()`.
 *
 *      The point is what happens when you hand it `ProvenReserveFeed` instead of a
 *      Chainlink feed. It works, unmodified — and silently gains three properties its
 *      author never wrote:
 *
 *        1. the reserve figure becomes a per-transaction cryptographic proof rather
 *           than an aggregated report from a decentralized oracle network;
 *        2. withdrawals announced against those reserves are already subtracted, which
 *           ordinary PoR does not do at all;
 *        3. its existing `updatedAt` staleness check — code it already had — now
 *           enforces MintBound's freshness bound.
 *
 *      That is the adoption argument in executable form: the installed base of Secure
 *      Mint integrations does not have to be rewritten to benefit from stronger
 *      evidence. It has to change one address.
 */
contract SecureMintReference {
    AggregatorV3Interface public immutable RESERVE_FEED;

    /// @notice Reject any answer older than this. Standard Chainlink integration hygiene.
    uint256 public immutable MAX_ANSWER_AGE;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Minted(address indexed to, uint256 amount, uint256 reserves, uint256 newSupply);

    error StaleReserveData(uint256 updatedAt, uint256 maxAge);
    error InvalidReserveAnswer(int256 answer);
    error InsufficientReserves(uint256 wouldBeSupply, uint256 reserves);

    constructor(address reserveFeed, uint256 maxAnswerAge) {
        RESERVE_FEED = AggregatorV3Interface(reserveFeed);
        MAX_ANSWER_AGE = maxAnswerAge;
    }

    /**
     * @notice Mint, but only if reserves cover the resulting supply.
     * @dev Verbatim Secure Mint logic. Note there is no mention of proofs, precompiles,
     *      encumbrances or Creditcoin anywhere in it.
     */
    function mint(address to, uint256 amount) external {
        (, int256 answer,, uint256 updatedAt,) = RESERVE_FEED.latestRoundData();

        if (answer <= 0) revert InvalidReserveAnswer(answer);
        if (block.timestamp > updatedAt + MAX_ANSWER_AGE) {
            revert StaleReserveData(updatedAt, MAX_ANSWER_AGE);
        }

        uint256 reserves = uint256(answer);
        uint256 wouldBe = totalSupply + amount;
        if (wouldBe > reserves) revert InsufficientReserves(wouldBe, reserves);

        totalSupply = wouldBe;
        balanceOf[to] += amount;
        emit Minted(to, amount, reserves, wouldBe);
    }

    /// @notice What this integration currently believes the reserves to be.
    function currentReserves() external view returns (uint256 reserves, uint256 updatedAt) {
        (, int256 answer,, uint256 at,) = RESERVE_FEED.latestRoundData();
        return (answer > 0 ? uint256(answer) : 0, at);
    }
}
