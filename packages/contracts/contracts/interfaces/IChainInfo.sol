// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title IChainInfo
 * @notice Solidity interface for Creditcoin's ChainInfo precompile at `0x0fd3`.
 *
 * @dev This interface is NOT published by Gluwa in the Gluwa USC contracts package. It was
 *      reconstructed from the ABI embedded in the Gluwa USC SDK v0.18.0
 *      (`src/chain-info/chain_info.json`) and verified against the live CC3 testnet
 *      precompile on 2026-08-25 — `get_supported_chains()` returned
 *      `[{chainKey:3, chainId:1, "Ethereum"}, {chainKey:1, chainId:11155111, "Sepolia ethereum"}]`.
 *
 *      The function names are deliberately snake_case. The precompile's selectors are
 *      computed over the snake_case signatures (e.g.
 *      `get_latest_attestation_height_and_hash(uint64)`), so renaming them to camelCase
 *      would silently produce the wrong selector and every call would fail.
 *
 *      Why MintBound needs this: the mint path must know how stale a reserve proof is.
 *      Reading the latest attested source height *from the chain itself* is what keeps
 *      the freshness bound trustless. If an off-chain worker supplied that height, a
 *      lying worker could make an arbitrarily stale reserve look current, and the
 *      "no trusted reporter" property would be false.
 */
interface IChainInfo {
    struct HeightAndHash {
        uint64 height;
        bytes32 hash;
        bool isAttestation;
        bool exists;
    }

    struct ChainInfoEntry {
        uint64 chainKey;
        uint64 chainId;
        bytes chainName;
        uint8 chainEncoding;
    }

    /// @notice Highest source-chain height currently attested on Creditcoin.
    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightAndHash memory);

    /// @notice Whether a specific source height has been attested.
    function is_height_attested(uint64 chainKey, uint64 targetHeight) external view returns (bool);

    /// @notice First source height this chain was attested from.
    function get_attestation_genesis_height(uint64 chainKey) external view returns (uint64);

    /// @notice All source chains this Creditcoin network can prove against.
    function get_supported_chains() external view returns (ChainInfoEntry[] memory);
}

library ChainInfoLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000fD3;

    function get() internal pure returns (IChainInfo) {
        return IChainInfo(PRECOMPILE);
    }
}
