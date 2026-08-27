import { expect } from "chai";
import { network } from "hardhat";

/**
 * The source-chain half of the system: ReserveVault and SupplyBeacon.
 *
 * WHY THIS FILE EXISTS. A coverage run found SupplyBeacon at 0.00% and ReserveVault at
 * 62.50%. Both numbers were worse than they looked: the existing suite proves that
 * MintBoundASC *consumes* these logs correctly, using synthesised log entries, but never
 * ran the contracts that actually *emit* them on the source chain. Two of the six
 * mechanisms we claim — encumbrance-aware bounds and cross-chain liability aggregation —
 * rest on code that was never executed by a test.
 *
 * The withdrawal timelock in particular is the mechanism behind invariants I3 and I4. It
 * is the thing that closes the attestation window, and it is the single most
 * security-critical path on this side of the bridge.
 */

const E18 = 10n ** 18n;
const MIN_GAP = 5n;
const DELAY = 150n;

async function mineBlocks(ethers: any, n: bigint) {
  await ethers.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}

describe("source chain", () => {
  let ethers: any;
  let owner: any, alice: any, outsider: any;
  let asset: any, vault: any;
  let assetAddr: string, vaultAddr: string;
  let snap: any;

  before(async () => {
    ({ ethers } = await network.connect());
    [owner, alice, outsider] = await ethers.getSigners();

    asset = await ethers.deployContract("TestUSD", ["MintBound Test USD", "mTUSD", 18]);
    assetAddr = await asset.getAddress();

    vault = await ethers.deployContract("ReserveVault", [MIN_GAP, DELAY]);
    vaultAddr = await vault.getAddress();

    await (await vault.setSupportedAsset(assetAddr, true)).wait();
    await (await asset.mint(owner.address, 1_000_000n * E18)).wait();
    await (await asset.mint(alice.address, 1_000_000n * E18)).wait();

    snap = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snap]);
    snap = await ethers.provider.send("evm_snapshot", []);
  });

  // ── construction ─────────────────────────────────────────────────────────────
  describe("construction", () => {
    it("refuses a withdrawal delay that cannot outrun detection latency", async () => {
      // The whole point of the delay is that it exceeds the time needed to notice an
      // announced exit. A vault built below the floor would look correct and silently
      // reopen the window the design exists to close, so the constructor refuses.
      const floor = await vault.MIN_WITHDRAWAL_DELAY();
      await expect(
        ethers.deployContract("ReserveVault", [MIN_GAP, floor - 1n]),
      ).to.be.revertedWithCustomError(vault, "WithdrawalDelayTooShort");
    });

    it("accepts exactly the floor", async () => {
      const floor = await vault.MIN_WITHDRAWAL_DELAY();
      const v = await ethers.deployContract("ReserveVault", [MIN_GAP, floor]);
      expect(await v.WITHDRAWAL_DELAY()).to.equal(floor);
    });
  });

  // ── deposit ──────────────────────────────────────────────────────────────────
  describe("deposit", () => {
    it("locks and issues a monotonic per-depositor nonce", async () => {
      await (await asset.connect(alice).approve(vaultAddr, 300n * E18)).wait();

      await expect(vault.connect(alice).deposit(assetAddr, 100n * E18))
        .to.emit(vault, "Locked")
        .withArgs(alice.address, assetAddr, 100n * E18, 1n);

      await expect(vault.connect(alice).deposit(assetAddr, 200n * E18))
        .to.emit(vault, "Locked")
        .withArgs(alice.address, assetAddr, 200n * E18, 2n);

      expect(await vault.totalLocked(assetAddr)).to.equal(300n * E18);
    });

    it("rejects an unsupported asset", async () => {
      const other = await ethers.deployContract("TestUSD", ["Other", "OTH", 18]);
      await (await other.mint(alice.address, 10n * E18)).wait();
      await (await other.connect(alice).approve(vaultAddr, 10n * E18)).wait();
      await expect(
        vault.connect(alice).deposit(await other.getAddress(), 10n * E18),
      ).to.be.revertedWithCustomError(vault, "UnsupportedAsset");
    });

    it("rejects a zero deposit", async () => {
      await expect(
        vault.connect(alice).deposit(assetAddr, 0),
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("counts the balance delta, not the requested amount", async () => {
      // A fee-on-transfer asset delivers less than was asked for. Authorising a mint on
      // the requested figure rather than the received one would create wrapped supply
      // that the vault never actually took custody of.
      const fee = await ethers.deployContract("FeeOnTransferToken", ["Fee", "FEE", 1000]);
      const feeAddr = await fee.getAddress();
      await (await vault.setSupportedAsset(feeAddr, true)).wait();
      await (await fee.mint(alice.address, 100n * E18)).wait();
      await (await fee.connect(alice).approve(vaultAddr, 100n * E18)).wait();

      // 10% fee: ask for 100, the vault receives 90, and 90 is what gets authorised.
      await expect(vault.connect(alice).deposit(feeAddr, 100n * E18))
        .to.emit(vault, "Locked")
        .withArgs(alice.address, feeAddr, 90n * E18, 1n);

      expect(await vault.totalLocked(feeAddr)).to.equal(90n * E18);
    });
  });

  // ── snapshotReserves: the state-to-event lift ────────────────────────────────
  describe("snapshotReserves", () => {
    beforeEach(async () => {
      await (await asset.connect(alice).approve(vaultAddr, 1000n * E18)).wait();
      await (await vault.connect(alice).deposit(assetAddr, 1000n * E18)).wait();
    });

    it("publishes balance, encumbrance and a monotonic epoch", async () => {
      await expect(vault.snapshotReserves(assetAddr))
        .to.emit(vault, "ReserveSnapshot")
        .withArgs(vaultAddr, assetAddr, 1000n * E18, 0n, 1n);
    });

    it("is permissionless — anyone may pay the gas to publish the truth", async () => {
      // If only the custodian could snapshot, the custodian could hide a shortfall by
      // staying quiet. Anyone noticing a discrepancy must be able to publish it.
      await expect(vault.connect(outsider).snapshotReserves(assetAddr)).to.emit(
        vault,
        "ReserveSnapshot",
      );
    });

    it("rate-limits to MIN_SNAPSHOT_GAP", async () => {
      await (await vault.snapshotReserves(assetAddr)).wait();
      await expect(
        vault.snapshotReserves(assetAddr),
      ).to.be.revertedWithCustomError(vault, "SnapshotTooSoon");
    });

    it("allows the next snapshot once the gap has elapsed", async () => {
      await (await vault.snapshotReserves(assetAddr)).wait();
      await mineBlocks(ethers, MIN_GAP);
      await expect(vault.snapshotReserves(assetAddr))
        .to.emit(vault, "ReserveSnapshot")
        .withArgs(vaultAddr, assetAddr, 1000n * E18, 0n, 2n);
    });

    it("rejects an unsupported asset", async () => {
      const other = await ethers.deployContract("TestUSD", ["Other", "OTH", 18]);
      await expect(
        vault.snapshotReserves(await other.getAddress()),
      ).to.be.revertedWithCustomError(vault, "UnsupportedAsset");
    });

    it("canSnapshot tracks the same rule the state-changing path enforces", async () => {
      expect(await vault.canSnapshot(assetAddr)).to.equal(true);
      await (await vault.snapshotReserves(assetAddr)).wait();
      expect(await vault.canSnapshot(assetAddr)).to.equal(false);
      await mineBlocks(ethers, MIN_GAP);
      expect(await vault.canSnapshot(assetAddr)).to.equal(true);
    });

    it("canSnapshot is false for an asset the vault does not support", async () => {
      const other = await ethers.deployContract("TestUSD", ["Other", "OTH", 18]);
      expect(await vault.canSnapshot(await other.getAddress())).to.equal(false);
    });
  });

  // ── the timelock: invariants I3 and I4 ───────────────────────────────────────
  describe("timelocked withdrawal", () => {
    beforeEach(async () => {
      await (await asset.connect(alice).approve(vaultAddr, 1000n * E18)).wait();
      await (await vault.connect(alice).deposit(assetAddr, 1000n * E18)).wait();
    });

    it("encumbers on announcement, BEFORE any money moves", async () => {
      // This is the property the whole design turns on. The announcement itself removes
      // the amount from what backs supply; execution is merely the later bookkeeping.
      const balBefore = await asset.balanceOf(vaultAddr);

      await expect(vault.requestWithdrawal(assetAddr, owner.address, 300n * E18)).to.emit(
        vault,
        "WithdrawalRequested",
      );

      expect(await asset.balanceOf(vaultAddr)).to.equal(balBefore); // nothing moved
      expect(await vault.encumbered(assetAddr)).to.equal(300n * E18);
      expect(await vault.availableReserve(assetAddr)).to.equal(700n * E18);
    });

    it("reports the encumbrance in the very next snapshot", async () => {
      await (await vault.requestWithdrawal(assetAddr, owner.address, 300n * E18)).wait();
      await expect(vault.snapshotReserves(assetAddr))
        .to.emit(vault, "ReserveSnapshot")
        .withArgs(vaultAddr, assetAddr, 1000n * E18, 300n * E18, 1n);
    });

    it("cannot execute before the delay has elapsed", async () => {
      const rc = await (
        await vault.requestWithdrawal(assetAddr, owner.address, 100n * E18)
      ).wait();
      const id = rc.logs.find((l: any) => l.fragment?.name === "WithdrawalRequested")!.args
        .requestId;

      await expect(vault.executeWithdrawal(id)).to.be.revertedWithCustomError(
        vault,
        "WithdrawalNotReady",
      );
    });

    it("executes once the delay has elapsed, releasing the encumbrance", async () => {
      const rc = await (
        await vault.requestWithdrawal(assetAddr, owner.address, 100n * E18)
      ).wait();
      const id = rc.logs.find((l: any) => l.fragment?.name === "WithdrawalRequested")!.args
        .requestId;

      await mineBlocks(ethers, DELAY);

      await expect(vault.executeWithdrawal(id)).to.emit(vault, "WithdrawalExecuted");
      expect(await vault.encumbered(assetAddr)).to.equal(0n);
      expect(await asset.balanceOf(vaultAddr)).to.equal(900n * E18);
    });

    it("refuses to announce more than is unencumbered", async () => {
      await (await vault.requestWithdrawal(assetAddr, owner.address, 800n * E18)).wait();
      // 200 left free; asking for 300 must fail rather than double-spend the encumbrance.
      await expect(
        vault.requestWithdrawal(assetAddr, owner.address, 300n * E18),
      ).to.be.revertedWithCustomError(vault, "InsufficientUnencumberedBalance");
    });

    it("refuses a zero-amount announcement", async () => {
      await expect(
        vault.requestWithdrawal(assetAddr, owner.address, 0),
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("cannot be executed twice", async () => {
      const rc = await (
        await vault.requestWithdrawal(assetAddr, owner.address, 100n * E18)
      ).wait();
      const id = rc.logs.find((l: any) => l.fragment?.name === "WithdrawalRequested")!.args
        .requestId;
      await mineBlocks(ethers, DELAY);
      await (await vault.executeWithdrawal(id)).wait();

      await expect(vault.executeWithdrawal(id)).to.be.revertedWithCustomError(
        vault,
        "WithdrawalClosed",
      );
    });

    it("rejects an unknown request id", async () => {
      await expect(
        vault.executeWithdrawal(ethers.id("never happened")),
      ).to.be.revertedWithCustomError(vault, "UnknownWithdrawal");
    });

    it("cancelling releases the encumbrance and moves nothing", async () => {
      const rc = await (
        await vault.requestWithdrawal(assetAddr, owner.address, 400n * E18)
      ).wait();
      const id = rc.logs.find((l: any) => l.fragment?.name === "WithdrawalRequested")!.args
        .requestId;
      expect(await vault.encumbered(assetAddr)).to.equal(400n * E18);

      await expect(vault.cancelWithdrawal(id)).to.emit(vault, "WithdrawalCancelled");
      expect(await vault.encumbered(assetAddr)).to.equal(0n);
      expect(await asset.balanceOf(vaultAddr)).to.equal(1000n * E18);
    });

    it("a cancelled withdrawal can never be executed", async () => {
      const rc = await (
        await vault.requestWithdrawal(assetAddr, owner.address, 100n * E18)
      ).wait();
      const id = rc.logs.find((l: any) => l.fragment?.name === "WithdrawalRequested")!.args
        .requestId;
      await (await vault.cancelWithdrawal(id)).wait();
      await mineBlocks(ethers, DELAY);

      await expect(vault.executeWithdrawal(id)).to.be.revertedWithCustomError(
        vault,
        "WithdrawalClosed",
      );
    });

    it("restricts announcement, execution and cancellation to the owner", async () => {
      // Naming the exact error matters more than it looks. A bare "it reverted" passes
      // just as happily when the call fails for an unrelated reason, which is how an
      // access-control test quietly stops testing access control.
      await expect(
        vault.connect(outsider).requestWithdrawal(assetAddr, outsider.address, 1n * E18),
      )
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);

      const rc = await (
        await vault.requestWithdrawal(assetAddr, owner.address, 1n * E18)
      ).wait();
      const id = rc.logs.find((l: any) => l.fragment?.name === "WithdrawalRequested")!.args
        .requestId;
      await mineBlocks(ethers, DELAY);

      await expect(vault.connect(outsider).executeWithdrawal(id))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);

      await expect(vault.connect(outsider).cancelWithdrawal(id))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);
    });
  });

  // ── the irreversible renunciation ────────────────────────────────────────────
  describe("emergency renunciation", () => {
    it("starts enabled, and renouncing is permanent", async () => {
      expect(await vault.emergencyEnabled()).to.equal(true);
      await (await vault.renounceEmergencyWithdrawal()).wait();
      expect(await vault.emergencyEnabled()).to.equal(false);

      // There must be no path back. If renunciation were reversible it would be a
      // promise rather than a guarantee, and the whole point is that it is not.
      expect((vault as any).enableEmergencyWithdrawal).to.equal(undefined);
    });

    it("blocks the emergency path once renounced", async () => {
      await (await asset.connect(alice).approve(vaultAddr, 100n * E18)).wait();
      await (await vault.connect(alice).deposit(assetAddr, 100n * E18)).wait();
      await (await vault.renounceEmergencyWithdrawal()).wait();

      await expect(
        vault.emergencyWithdraw(assetAddr, owner.address, 100n * E18),
      ).to.be.revertedWithCustomError(vault, "EmergencyDisabled");
    });
  });

  // ── SupplyBeacon: the liability half of the balance sheet ────────────────────
  describe("SupplyBeacon", () => {
    let token: any, beacon: any, beaconAddr: string, tokenAddr: string;

    beforeEach(async () => {
      token = await ethers.deployContract("TestUSD", ["Remote Wrapped", "rwmTUSD", 18]);
      tokenAddr = await token.getAddress();
      beacon = await ethers.deployContract("SupplyBeacon", [tokenAddr, MIN_GAP]);
      beaconAddr = await beacon.getAddress();
    });

    it("publishes the remote supply as a provable log", async () => {
      await (await token.mint(alice.address, 500n * E18)).wait();

      await expect(beacon.snapshotSupply())
        .to.emit(beacon, "SupplySnapshot")
        .withArgs(beaconAddr, tokenAddr, 500n * E18, 1n);
    });

    it("is permissionless, for the same reason reserve snapshots are", async () => {
      // If only the issuer could publish supply, the issuer could hide supply by staying
      // quiet — and hidden liabilities are exactly what the aggregate bound exists to
      // catch.
      await (await token.mint(alice.address, 10n * E18)).wait();
      await expect(beacon.connect(outsider).snapshotSupply()).to.emit(
        beacon,
        "SupplySnapshot",
      );
    });

    it("tracks supply as it changes, with a monotonic epoch", async () => {
      await (await token.mint(alice.address, 100n * E18)).wait();
      await (await beacon.snapshotSupply()).wait();

      await (await token.mint(alice.address, 400n * E18)).wait();
      await mineBlocks(ethers, MIN_GAP);

      await expect(beacon.snapshotSupply())
        .to.emit(beacon, "SupplySnapshot")
        .withArgs(beaconAddr, tokenAddr, 500n * E18, 2n);
    });

    it("rate-limits, and canSnapshot agrees with the enforced rule", async () => {
      expect(await beacon.canSnapshot()).to.equal(true);
      await (await beacon.snapshotSupply()).wait();

      expect(await beacon.canSnapshot()).to.equal(false);
      await expect(beacon.snapshotSupply()).to.be.revertedWithCustomError(beacon, "TooSoon");

      await mineBlocks(ethers, MIN_GAP);
      expect(await beacon.canSnapshot()).to.equal(true);
      await expect(beacon.snapshotSupply()).to.emit(beacon, "SupplySnapshot");
    });

    it("reports zero supply honestly rather than refusing", async () => {
      // A chain with no wrapped supply must still be able to say so. Silence would be
      // indistinguishable from a chain that stopped reporting, which freezes minting.
      await expect(beacon.snapshotSupply())
        .to.emit(beacon, "SupplySnapshot")
        .withArgs(beaconAddr, tokenAddr, 0n, 1n);
    });

    it("exposes the live supply for off-chain comparison", async () => {
      await (await token.mint(alice.address, 42n * E18)).wait();
      expect(await beacon.currentSupply()).to.equal(42n * E18);
    });

    it("emits data in the same shape the ASC decoder expects", async () => {
      // The event is deliberately shaped like ReserveSnapshot so one decoder path serves
      // both. If the payload width drifts, the guard rejects it for a reason that looks
      // like a proof failure — so pin the width here, where the message is clear.
      await (await token.mint(alice.address, 7n * E18)).wait();
      const rc = await (await beacon.snapshotSupply()).wait();
      const log = rc.logs.find((l: any) => l.fragment?.name === "SupplySnapshot")!;

      expect(log.topics.length).to.equal(3); // sig, beacon, token
      expect(ethers.dataLength(log.data)).to.equal(64); // totalSupply, epoch
    });
  });
});
