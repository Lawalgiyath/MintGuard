// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title FeeOnTransferToken
 * @notice An ERC20 that delivers less than was sent, so the vault's accounting can be
 *         tested against an asset that does not behave.
 *
 * @dev Test-only. This exists because `ReserveVault.deposit` deliberately measures a
 *      BALANCE DELTA rather than trusting the requested amount, and that decision is
 *      unverifiable without a token that actually takes a cut.
 *
 *      The failure being guarded against is not exotic. If the vault credited the
 *      requested figure, a fee-on-transfer asset would authorise wrapped supply against
 *      reserve the vault never received — minting an IOU for money that was never in the
 *      building. USDT has a fee mechanism in its source to this day; several
 *      deflationary tokens apply one unconditionally.
 */
contract FeeOnTransferToken is ERC20 {
    /// @notice Fee applied to every transfer, in basis points.
    uint16 public immutable FEE_BPS;

    constructor(string memory name_, string memory symbol_, uint16 feeBps) ERC20(name_, symbol_) {
        require(feeBps < 10_000, "fee must be under 100%");
        FEE_BPS = feeBps;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Burns the fee rather than routing it anywhere — the only property under test
    ///      is that the recipient receives less than the sender sent.
    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value); // mint and burn are untaxed
            return;
        }
        uint256 fee = (value * FEE_BPS) / 10_000;
        super._update(from, to, value - fee);
        if (fee > 0) super._update(from, address(0), fee);
    }
}
