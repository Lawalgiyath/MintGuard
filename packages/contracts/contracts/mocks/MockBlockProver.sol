// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    INativeQueryVerifier
} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/**
 * @title MockBlockProver
 * @notice Local stand-in for the Block Prover precompile at 0x0FD2.
 *
 * @dev This is deployed and then its runtime code is injected AT 0x0FD2 with
 *      hardhat_setCode, so MintBoundASC runs completely unmodified in tests -- same
 *      address, same interface, same call path. Nothing in the production contract is
 *      aware that tests exist, which is the only way a test suite is worth anything
 *      here: a mock the contract has to be adapted for proves nothing about the
 *      contract you deploy.
 *
 *      It deliberately reproduces the precompile's most dangerous property: it
 *      verifies INCLUSION ONLY and will happily verify a transaction whose receipt
 *      status is 0. If the mock silently rejected reverted transactions, the test
 *      asserting that MintBoundASC rejects them would pass for the wrong reason.
 */
contract MockBlockProver {
    /// @notice Roots explicitly marked unforgeable-and-invalid, to simulate a fake proof.
    mapping(bytes32 => bool) public invalidRoot;
    bool public rejectAll;

    /**
     * @notice How an invalid proof is signalled.
     * @dev VERIFIED AGAINST THE LIVE PRECOMPILE (2026-08-25): the real 0x0FD2 REVERTS
     *      with "Merkle proof validation failed" rather than returning false. Default
     *      to that so tests exercise the production path. The return-false branch is
     *      kept switchable because MintBoundASC defends against both, and a mock that
     *      could only do one would leave half that defence untested.
     */
    bool public revertOnInvalid = true;

    function setRevertOnInvalid(bool v) external {
        revertOnInvalid = v;
    }

    event TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 transactionIndex);

    function setInvalidRoot(bytes32 root, bool invalid) external {
        invalidRoot[root] = invalid;
    }

    function setRejectAll(bool v) external {
        rejectAll = v;
    }

    /// @dev Deterministic position derived from the sibling side-flags, mirroring how a
    ///      real Merkle path encodes the leaf index.
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata merkleProof)
        external
        pure
        returns (uint64 idx)
    {
        uint256 n = merkleProof.siblings.length;
        for (uint256 i; i < n; ++i) {
            if (merkleProof.siblings[i].isLeft) {
                idx |= uint64(1) << uint64(i);
            }
        }
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata
    ) external returns (bool) {
        if (rejectAll || invalidRoot[merkleProof.root]) {
            if (revertOnInvalid) revert("Merkle proof validation failed");
            return false;
        }
        emit TransactionVerified(chainKey, height, 0);
        return true;
    }

    function verify(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        if (rejectAll || invalidRoot[merkleProof.root]) {
            if (revertOnInvalid) revert("Merkle proof validation failed");
            return false;
        }
        return true;
    }
}
