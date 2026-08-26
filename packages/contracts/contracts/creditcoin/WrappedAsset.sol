// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title WrappedAsset
 * @notice The liability side of the invariant. An ERC-20 on Creditcoin whose supply may
 *         only ever increase through MintBoundASC.
 *
 * @dev The mint authority is a single immutable address set at construction and never
 *      changeable. There is no admin, no role registry, and no upgrade path -- because
 *      every one of those would be a way to increase supply without a proof, which is
 *      exactly the property MintBound exists to guarantee.
 *
 *      Burning is open (ERC20Burnable). That asymmetry is deliberate and load-bearing:
 *      increasing liabilities requires a fresh cryptographic proof, decreasing them
 *      requires nothing at all. Every failure mode therefore degrades toward
 *      "cannot mint, can still redeem" and never toward silent over-issuance.
 */
contract WrappedAsset is ERC20, ERC20Burnable {
    /// @notice The only address that may ever mint. Immutable by design.
    address public immutable MINTER;

    uint8 private immutable _decimals;

    error OnlyMinter(address caller);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address minter_)
        ERC20(name_, symbol_)
    {
        MINTER = minter_;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint wrapped supply. Callable only by MintBoundASC, which calls it only
    ///         after a verified proof has satisfied the aggregate solvency invariant.
    function mint(address to, uint256 amount) external {
        if (msg.sender != MINTER) revert OnlyMinter(msg.sender);
        _mint(to, amount);
    }
}
