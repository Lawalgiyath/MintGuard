// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title RejectsPayment
 * @notice A contract that refuses every incoming transfer, so the bond-return and
 *         bond-payout failure branches can be exercised.
 *
 * @dev Test-only. `SolvencyContinuity` moves the bond with a low-level call and reverts
 *      with `BondTransferFailed` if that call fails. Those branches are unreachable from
 *      an externally owned account, because an EOA cannot decline a transfer — which is
 *      exactly why they need a contract that can.
 *
 *      This is not a hypothetical shape. A claimant or challenger may perfectly well be
 *      a multisig, a vault, or any contract whose fallback reverts or simply runs out of
 *      the 2300 gas a bare `transfer` forwards. The contract under test must fail
 *      loudly in that case rather than mark a claim settled while the money stayed put.
 */
contract RejectsPayment {
    error NotAcceptingPayments();

    /// @dev Forwards an arbitrary call so the mock can open or refute a claim itself.
    function forward(address target, bytes calldata data, uint256 value)
        external
        payable
        returns (bytes memory)
    {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            // Bubble the original revert so tests see the real reason.
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }

    receive() external payable {
        revert NotAcceptingPayments();
    }

    fallback() external payable {
        revert NotAcceptingPayments();
    }
}
