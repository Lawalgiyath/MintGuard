// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IChainInfo} from "../interfaces/IChainInfo.sol";

/**
 * @title MockChainInfo
 * @notice Local stand-in for the ChainInfo precompile at 0x0FD3.
 *
 * @dev Injected at 0x0FD3 with hardhat_setCode. Its whole job is to let a test advance
 *      the attested source height, which is how the staleness tests work: prove a
 *      reserve, push the attested height forward past maxStalenessBlocks, then assert
 *      that minting stops on its own without anyone touching the contract.
 *
 *      The snake_case function names are not a typo -- see IChainInfo. The selector is
 *      computed over the snake_case signature, so a camelCase mock would not be called
 *      by the contract under test and every staleness test would silently pass.
 */
contract MockChainInfo {
    mapping(uint64 => uint64) public latestHeight;
    mapping(uint64 => bytes32) public latestHash;
    mapping(uint64 => bool) public known;

    function setLatestAttestation(uint64 chainKey, uint64 height, bytes32 hash_) external {
        latestHeight[chainKey] = height;
        latestHash[chainKey] = hash_;
        known[chainKey] = true;
    }

    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (IChainInfo.HeightAndHash memory)
    {
        return IChainInfo.HeightAndHash({
            height: latestHeight[chainKey],
            hash: latestHash[chainKey],
            isAttestation: true,
            exists: known[chainKey]
        });
    }

    function is_height_attested(uint64 chainKey, uint64 targetHeight) external view returns (bool) {
        return known[chainKey] && targetHeight <= latestHeight[chainKey];
    }

    function get_attestation_genesis_height(uint64) external pure returns (uint64) {
        return 0;
    }

    function get_supported_chains() external pure returns (IChainInfo.ChainInfoEntry[] memory chains) {
        chains = new IChainInfo.ChainInfoEntry[](1);
        chains[0] = IChainInfo.ChainInfoEntry({
            chainKey: 1,
            chainId: 11155111,
            chainName: bytes("Sepolia ethereum"),
            chainEncoding: 1
        });
    }
}
