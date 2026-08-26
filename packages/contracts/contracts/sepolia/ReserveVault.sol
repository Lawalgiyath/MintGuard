// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReserveVault
 * @notice The source-chain (Ethereum Sepolia) half of MintBound. It holds reserves and
 *         emits facts. It contains no solvency policy whatsoever.
 *
 * @dev -- The state-to-event lift ------------------------------------------------
 *      Creditcoin's Block Prover precompile proves that a transaction was included in
 *      an attested source block. It cannot answer "what is the balance of this vault
 *      right now" -- that is state, not an event. Proof-of-assets needs a balance, so
 *      snapshotReserves() reads the balance and writes it into a log. The balance
 *      becomes a fact ABOUT A TRANSACTION, which is exactly what the precompile can
 *      prove. That trick generalises: it turns a transaction oracle into a state
 *      oracle for any dApp.
 *
 *      -- Closing the detection window ------------------------------------------
 *      A naive vault lets the custodian withdraw instantly. Creditcoin cannot learn of
 *      it until someone snapshots and that snapshot is attested -- measured at roughly
 *      11 minutes worst case. During that window a drained vault still looks solvent,
 *      and mints keep clearing. That was this design's honest weak point.
 *
 *      It is closed by making withdrawal a TWO-STEP, TIMELOCKED operation and,
 *      crucially, by reporting announced-but-unexecuted withdrawals in the snapshot
 *      itself as `encumbered`. MintBound subtracts encumbrances from the reserve the
 *      moment the announcement is proven -- which happens LONG BEFORE the funds are
 *      allowed to move.
 *
 *      The effect is a reversal of the security question. It is no longer "how fast can
 *      we detect a theft?" but "can the custodian move funds without telling anyone
 *      first?" -- and the answer is no. As long as
 *
 *          WITHDRAWAL_DELAY  >  attestation latency + snapshot gap
 *
 *      the reserve is de-rated before a single token can leave. Deployment scripts
 *      enforce that inequality rather than trusting the operator to pick well.
 *
 *      -- Why snapshotting is permissionless -------------------------------------
 *      If only the custodian could snapshot, they could withhold snapshots to hide a
 *      shortfall. Anyone may call it and pay the gas, so a shortfall becomes publicly
 *      provable by whoever notices. And because minting halts when snapshots go stale,
 *      withholding is never a winning strategy.
 */
contract ReserveVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Events -- the entire cross-chain interface of this contract
    // -------------------------------------------------------------------------

    /// @notice Flow event. Authorises exactly one mint of `amount` to `user`.
    /// @dev topics: [sig, user, asset]; data: abi.encode(amount, nonce) — 64 bytes
    event Locked(address indexed user, address indexed asset, uint256 amount, uint256 nonce);

    /**
     * @notice Stock event. The state-to-event lift, now carrying encumbrances.
     * @dev topics: [sig, vault, asset]; data: abi.encode(balance, encumbered, epoch) — 96 bytes
     *      `encumbered` is the total of announced-but-unexecuted withdrawals. Reporting
     *      it in the same event means the existing single proof path automatically
     *      accounts for pending exits: no second proof type, no extra round trip.
     */
    event ReserveSnapshot(
        address indexed vault, address indexed asset, uint256 balance, uint256 encumbered, uint256 epoch
    );

    /// @notice A withdrawal has been ANNOUNCED. Provable, and acted on before funds move.
    event WithdrawalRequested(
        address indexed asset, address indexed to, uint256 amount, uint256 eta, bytes32 indexed requestId
    );
    event WithdrawalExecuted(bytes32 indexed requestId, address indexed asset, uint256 amount);
    event WithdrawalCancelled(bytes32 indexed requestId, address indexed asset, uint256 amount);

    /// @notice Settlement of a redemption that already burned supply on Creditcoin.
    event Released(address indexed user, address indexed asset, uint256 amount, bytes32 redeemId);

    /// @notice An unannounced outflow. Only possible while the escape hatch is live.
    event EmergencyWithdrawal(address indexed asset, address indexed to, uint256 amount);

    /// @notice The escape hatch has been destroyed. Irreversible.
    event EmergencyWithdrawalRenounced(uint256 atBlock);

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    /// @notice Blocks that must pass between snapshots of the same asset. Anti-spam only.
    uint256 public immutable MIN_SNAPSHOT_GAP;

    /**
     * @notice Blocks between announcing a withdrawal and being allowed to execute it.
     * @dev THE SECURITY PARAMETER. Must exceed attestation latency plus the snapshot
     *      gap, or the announcement will not be proven on Creditcoin before the funds
     *      are movable and the guarantee evaporates. Measured latency on CC3 is ~57
     *      blocks worst case; the constructor demands a 2x margin over that.
     */
    uint256 public immutable WITHDRAWAL_DELAY;

    struct Withdrawal {
        address asset;
        address to;
        uint256 amount;
        uint256 eta;
        bool executed;
        bool cancelled;
    }

    mapping(bytes32 => Withdrawal) public withdrawals;

    /// @notice Announced-but-unexecuted withdrawals per asset. Subtracted from reserve.
    mapping(address => uint256) public encumbered;

    mapping(address => uint256) public lastSnapshotBlock;
    mapping(address => uint256) public epoch;
    mapping(address => uint256) public totalLocked;
    mapping(address => uint256) public nonces;
    mapping(address => bool) public supported;
    mapping(bytes32 => bool) public settledRedemptions;

    uint256 private _withdrawalNonce;

    /**
     * @notice Whether the unannounced-withdrawal escape hatch still exists.
     * @dev A production deployment renounces this at genesis, which is a single
     *      irreversible on-chain transaction anyone can verify. It exists at all so the
     *      defence-in-depth path (drift detection catching an out-of-band loss) can be
     *      demonstrated on a real chain rather than described on a slide.
     */
    bool public emergencyEnabled = true;

    error UnsupportedAsset(address asset);
    error SnapshotTooSoon(address asset, uint256 nextAllowedBlock);
    error ZeroAmount();
    error RedemptionAlreadySettled(bytes32 redeemId);
    error WithdrawalDelayTooShort(uint256 given, uint256 minimum);
    error UnknownWithdrawal(bytes32 requestId);
    error WithdrawalNotReady(bytes32 requestId, uint256 eta);
    error WithdrawalClosed(bytes32 requestId);
    error InsufficientUnencumberedBalance(uint256 requested, uint256 available);
    error EmergencyDisabled();

    /// @dev Detection latency on CC3: ~44 blocks attestation + ~5 snapshot gap + ~8
    ///      finality margin. A 2x margin over that is the floor we will accept.
    uint256 public constant MIN_WITHDRAWAL_DELAY = 120;

    constructor(uint256 minSnapshotGap, uint256 withdrawalDelay) Ownable(msg.sender) {
        if (withdrawalDelay < MIN_WITHDRAWAL_DELAY) {
            revert WithdrawalDelayTooShort(withdrawalDelay, MIN_WITHDRAWAL_DELAY);
        }
        MIN_SNAPSHOT_GAP = minSnapshotGap;
        WITHDRAWAL_DELAY = withdrawalDelay;
    }

    function setSupportedAsset(address asset, bool isSupported) external onlyOwner {
        supported[asset] = isSupported;
    }

    // -------------------------------------------------------------------------
    // Flow: lock reserves, authorising a mint
    // -------------------------------------------------------------------------

    /**
     * @notice Lock `amount` of `asset`, authorising exactly one mint on Creditcoin.
     * @dev Amount is measured as a balance delta so a fee-on-transfer asset cannot
     *      authorise a mint larger than what the vault actually received.
     */
    function deposit(address asset, uint256 amount) external nonReentrant returns (uint256 nonce) {
        if (!supported[asset]) revert UnsupportedAsset(asset);
        if (amount == 0) revert ZeroAmount();

        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(asset).balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        totalLocked[asset] += received;

        nonce = ++nonces[msg.sender];
        emit Locked(msg.sender, asset, received, nonce);
    }

    // -------------------------------------------------------------------------
    // Stock: the state-to-event lift
    // -------------------------------------------------------------------------

    /**
     * @notice Publish the vault's balance and encumbrances as a provable log entry.
     * @dev Permissionless. Anyone may call this and anyone may pay the gas.
     */
    function snapshotReserves(address asset)
        external
        returns (uint256 balance, uint256 encumberedAmount, uint256 newEpoch)
    {
        if (!supported[asset]) revert UnsupportedAsset(asset);

        uint256 nextAllowed = lastSnapshotBlock[asset] + MIN_SNAPSHOT_GAP;
        if (lastSnapshotBlock[asset] != 0 && block.number < nextAllowed) {
            revert SnapshotTooSoon(asset, nextAllowed);
        }

        balance = IERC20(asset).balanceOf(address(this));
        encumberedAmount = encumbered[asset];
        lastSnapshotBlock[asset] = block.number;
        newEpoch = ++epoch[asset];

        emit ReserveSnapshot(address(this), asset, balance, encumberedAmount, newEpoch);
    }

    /// @notice Whether a snapshot is currently permitted (for worker/dashboard use).
    function canSnapshot(address asset) external view returns (bool) {
        if (!supported[asset]) return false;
        if (lastSnapshotBlock[asset] == 0) return true;
        return block.number >= lastSnapshotBlock[asset] + MIN_SNAPSHOT_GAP;
    }

    /// @notice Balance minus announced withdrawals — what actually backs supply.
    function availableReserve(address asset) external view returns (uint256) {
        uint256 bal = IERC20(asset).balanceOf(address(this));
        uint256 enc = encumbered[asset];
        return bal > enc ? bal - enc : 0;
    }

    // -------------------------------------------------------------------------
    // Timelocked withdrawal — the mechanism that closes the detection window
    // -------------------------------------------------------------------------

    /**
     * @notice Announce an intent to withdraw. Moves no funds.
     * @dev The instant this event is proven on Creditcoin, MintBound subtracts `amount`
     *      from the reserve backing supply. Because WITHDRAWAL_DELAY exceeds attestation
     *      latency, that de-rating lands well before execute() becomes callable. A
     *      custodian planning to rug must therefore tell the invariant first, and the
     *      invariant reacts while the money is still in the vault.
     */
    function requestWithdrawal(address asset, address to, uint256 amount)
        external
        onlyOwner
        returns (bytes32 requestId)
    {
        if (amount == 0) revert ZeroAmount();

        uint256 bal = IERC20(asset).balanceOf(address(this));
        uint256 free = bal > encumbered[asset] ? bal - encumbered[asset] : 0;
        if (amount > free) revert InsufficientUnencumberedBalance(amount, free);

        requestId = keccak256(abi.encode(asset, to, amount, ++_withdrawalNonce, block.chainid));
        uint256 eta = block.number + WITHDRAWAL_DELAY;

        withdrawals[requestId] =
            Withdrawal({asset: asset, to: to, amount: amount, eta: eta, executed: false, cancelled: false});
        encumbered[asset] += amount;

        emit WithdrawalRequested(asset, to, amount, eta, requestId);
    }

    /// @notice Execute a previously announced withdrawal, once the timelock has elapsed.
    function executeWithdrawal(bytes32 requestId) external onlyOwner nonReentrant {
        Withdrawal storage w = withdrawals[requestId];
        if (w.amount == 0) revert UnknownWithdrawal(requestId);
        if (w.executed || w.cancelled) revert WithdrawalClosed(requestId);
        if (block.number < w.eta) revert WithdrawalNotReady(requestId, w.eta);

        w.executed = true;
        encumbered[w.asset] -= w.amount;
        if (totalLocked[w.asset] >= w.amount) {
            totalLocked[w.asset] -= w.amount;
        } else {
            totalLocked[w.asset] = 0;
        }

        IERC20(w.asset).safeTransfer(w.to, w.amount);
        emit WithdrawalExecuted(requestId, w.asset, w.amount);
    }

    /// @notice Abandon an announced withdrawal, releasing the encumbrance.
    function cancelWithdrawal(bytes32 requestId) external onlyOwner {
        Withdrawal storage w = withdrawals[requestId];
        if (w.amount == 0) revert UnknownWithdrawal(requestId);
        if (w.executed || w.cancelled) revert WithdrawalClosed(requestId);

        w.cancelled = true;
        encumbered[w.asset] -= w.amount;
        emit WithdrawalCancelled(requestId, w.asset, w.amount);
    }

    // -------------------------------------------------------------------------
    // Settlement
    // -------------------------------------------------------------------------

    /// @notice Settle a redemption whose wrapped supply was already burned on Creditcoin.
    function release(address asset, address to, uint256 amount, bytes32 redeemId)
        external
        onlyOwner
        nonReentrant
    {
        if (settledRedemptions[redeemId]) revert RedemptionAlreadySettled(redeemId);
        settledRedemptions[redeemId] = true;
        if (totalLocked[asset] >= amount) {
            totalLocked[asset] -= amount;
        } else {
            totalLocked[asset] = 0;
        }
        IERC20(asset).safeTransfer(to, amount);
        emit Released(to, asset, amount, redeemId);
    }

    // -------------------------------------------------------------------------
    // The escape hatch, and its destruction
    // -------------------------------------------------------------------------

    /**
     * @notice Withdraw without announcing. Exists only until renounced.
     * @dev This is the rug the timelock is designed to make impossible. Keeping it
     *      available on a testnet deployment lets the second line of defence -- drift
     *      detection catching an unannounced loss -- be demonstrated against real
     *      chains. A serious deployment calls renounceEmergencyWithdrawal() at genesis,
     *      and anyone can verify from the chain that it did.
     */
    function emergencyWithdraw(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (!emergencyEnabled) revert EmergencyDisabled();
        if (totalLocked[asset] >= amount) {
            totalLocked[asset] -= amount;
        } else {
            totalLocked[asset] = 0;
        }
        IERC20(asset).safeTransfer(to, amount);
        emit EmergencyWithdrawal(asset, to, amount);
    }

    /**
     * @notice Permanently destroy the unannounced-withdrawal path.
     * @dev Irreversible by construction: there is no setter that can turn it back on.
     *      After this, every outflow must be announced and timelocked, which is what
     *      makes the "reserves cannot move without warning" claim literally true rather
     *      than a matter of operator good behaviour.
     */
    function renounceEmergencyWithdrawal() external onlyOwner {
        emergencyEnabled = false;
        emit EmergencyWithdrawalRenounced(block.number);
    }

    function reserveBalance(address asset) external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }
}
