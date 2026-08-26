import { expect } from "chai";
import { network } from "hardhat";
import {
  BLOCK_PROVER,
  CHAIN_INFO,
  encodeTx,
  lockedLog,
  makeQuery,
  snapshotLog,
  supplyLog,
} from "./helpers.js";

/**
 * The tests run MintBoundASC completely unmodified. The two precompiles are injected
 * at their real addresses (0x0FD2, 0x0FD3) with hardhat_setCode, so the contract makes
 * the same calls to the same addresses it will make on CC3. Nothing is stubbed inside
 * the contract under test.
 */

const CHAIN_KEY = 1n;
const STALENESS = 200n;
const E18 = 10n ** 18n;

describe("MintBound", () => {
  let ethers: any;
  let deployer: any, alice: any, bob: any, attacker: any;
  let asset: any, vault: any, asc: any, wrapped: any, prover: any, chainInfo: any;
  let vaultAddr: string, assetAddr: string, ascAddr: string;
  let snap: any;

  const SRC_HEIGHT = 1_000_000n;

  before(async () => {
    ({ ethers } = await network.connect());
    [deployer, alice, bob, attacker] = await ethers.getSigners();

    // --- inject the precompiles at their canonical addresses ---
    const proverImpl = await ethers.deployContract("MockBlockProver");
    await ethers.provider.send("hardhat_setCode", [
      BLOCK_PROVER,
      await ethers.provider.getCode(await proverImpl.getAddress()),
    ]);
    prover = await ethers.getContractAt("MockBlockProver", BLOCK_PROVER);
    // hardhat_setCode copies runtime bytecode but NOT constructor-initialised storage,
    // so any field with an inline initialiser reads as zero at the injected address.
    // Set it explicitly, or the mock silently returns false instead of reverting and
    // the forged-proof test asserts the wrong failure mode.
    await prover.setRevertOnInvalid(true);

    const chainInfoImpl = await ethers.deployContract("MockChainInfo");
    await ethers.provider.send("hardhat_setCode", [
      CHAIN_INFO,
      await ethers.provider.getCode(await chainInfoImpl.getAddress()),
    ]);
    chainInfo = await ethers.getContractAt("MockChainInfo", CHAIN_INFO);

    // --- source chain ---
    asset = await ethers.deployContract("TestUSD", ["Test USD", "TUSD", 18]);
    assetAddr = await asset.getAddress();
    vault = await ethers.deployContract("ReserveVault", [0n, 120n]);
    vaultAddr = await vault.getAddress();
    await vault.setSupportedAsset(assetAddr, true);

    // --- Creditcoin side ---
    asc = await ethers.deployContract("MintBoundASC", [CHAIN_KEY, vaultAddr, STALENESS]);
    ascAddr = await asc.getAddress();
    wrapped = await ethers.deployContract("WrappedAsset", [
      "Wrapped Test USD",
      "wTUSD",
      18,
      ascAddr,
    ]);
    await asc.registerAsset(assetAddr, await wrapped.getAddress(), 10_000);

    await chainInfo.setLatestAttestation(CHAIN_KEY, SRC_HEIGHT, `0x${"aa".repeat(32)}`);

    snap = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snap]);
    snap = await ethers.provider.send("evm_snapshot", []);
  });

  // helper: prove a reserve balance
  async function proveReserve(
    balance: bigint,
    epoch: bigint,
    height = SRC_HEIGHT,
    flags?: boolean[],
    encumbered = 0n,
  ) {
    const tx = encodeTx({ logs: [snapshotLog(vaultAddr, assetAddr, balance, epoch, encumbered)] });
    return asc.submitReserveSnapshot(
      makeQuery({ blockHeight: height, encodedTransaction: tx, siblingFlags: flags }),
    );
  }

  // helper: mint against a proven lock
  async function mintLock(user: string, amount: bigint, nonce: bigint, flags?: boolean[]) {
    const tx = encodeTx({ logs: [lockedLog(vaultAddr, user, assetAddr, amount, nonce)] });
    return asc.mintWithProof(
      makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx, siblingFlags: flags ?? [true, false] }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  describe("the happy path", () => {
    it("proves a reserve balance from a source-chain snapshot event", async () => {
      await expect(proveReserve(1000n * E18, 1n))
        .to.emit(asc, "ReserveProven")
        .withArgs(assetAddr, 1000n * E18, SRC_HEIGHT, 1n, (x: string) => x.length === 66);

      const [bal, at] = await asc.verifiedReserve(assetAddr);
      expect(bal).to.equal(1000n * E18);
      expect(at).to.equal(SRC_HEIGHT);
    });

    it("mints against a proven lock while the aggregate bound holds", async () => {
      await proveReserve(1000n * E18, 1n);
      await expect(mintLock(alice.address, 600n * E18, 1n)).to.emit(asc, "Minted");
      expect(await wrapped.totalSupply()).to.equal(600n * E18);
      expect(await wrapped.balanceOf(alice.address)).to.equal(600n * E18);
    });

    it("reports a live solvency picture through ISolvencyOracle", async () => {
      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 500n * E18, 1n);

      const r = await asc.solvencyReport(assetAddr);
      expect(r.verifiedReserve).to.equal(1000n * E18);
      expect(r.outstandingSupply).to.equal(500n * E18);
      expect(r.collateralRatioBps).to.equal(20_000n); // 200% covered
      expect(r.solvent).to.equal(true);
      expect(r.fresh).to.equal(true);
      expect(r.mintFrozen).to.equal(false);
      expect(await asc.isSolvent(assetAddr)).to.equal(true);
    });

    it("applies the haircut to the mintable bound", async () => {
      await asc.setHaircut(assetAddr, 9_500); // 95%
      await proveReserve(1000n * E18, 1n);

      // 950 is exactly the discounted bound; 951 is one wei-scale step past it.
      await expect(mintLock(alice.address, 951n * E18, 1n)).to.be.revertedWithCustomError(
        asc,
        "InvariantViolated",
      );
      await expect(mintLock(alice.address, 950n * E18, 2n, [false, true])).to.emit(asc, "Minted");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the aggregate bound — the difference from flow-only minting", () => {
    it("rejects a mint that individually fits but breaches the total", async () => {
      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 600n * E18, 1n);

      // 500 <= 1000 reserve, so a per-deposit check passes it. The aggregate does not:
      // 600 already outstanding + 500 = 1100 > 1000.
      await expect(
        mintLock(bob.address, 500n * E18, 2n, [false, true]),
      ).to.be.revertedWithCustomError(asc, "InvariantViolated");

      expect(await wrapped.totalSupply()).to.equal(600n * E18);
    });

    it("allows minting exactly up to the bound and not one wei beyond", async () => {
      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 1000n * E18, 1n);
      expect(await wrapped.totalSupply()).to.equal(1000n * E18);

      await expect(mintLock(bob.address, 1n, 2n, [false, true])).to.be.revertedWithCustomError(
        asc,
        "InvariantViolated",
      );
    });

    it("refuses to mint before any reserve has ever been proven", async () => {
      await expect(mintLock(alice.address, 1n, 1n)).to.be.revertedWithCustomError(
        asc,
        "NoReserveProof",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("attacks on the proof itself", () => {
    it("rejects a forged proof — precompile reverts, as the live one does", async () => {
      // Verified against live 0x0FD2 on 2026-08-25: a tampered merkle root reverts with
      // "Merkle proof validation failed" rather than returning false. The mock defaults
      // to that behaviour so this test exercises the real production path.
      const root = `0x${"99".repeat(32)}`;
      await prover.setInvalidRoot(root, true);

      const tx = encodeTx({ logs: [snapshotLog(vaultAddr, assetAddr, 10n ** 9n * E18, 1n)] });
      await expect(
        asc.submitReserveSnapshot(
          makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx, merkleRoot: root }),
        ),
      ).to.be.revertedWith("Merkle proof validation failed");
    });

    it("also rejects a forged proof if the precompile merely returns false", async () => {
      // Defence in depth. Should the precompile ever signal failure by return value
      // instead of reverting, the explicit check must still stop the mint.
      const root = `0x${"98".repeat(32)}`;
      await prover.setRevertOnInvalid(false);
      await prover.setInvalidRoot(root, true);

      const tx = encodeTx({ logs: [snapshotLog(vaultAddr, assetAddr, 10n ** 9n * E18, 1n)] });
      await expect(
        asc.submitReserveSnapshot(
          makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx, merkleRoot: root }),
        ),
      ).to.be.revertedWithCustomError(asc, "VerificationFailed");

      await prover.setRevertOnInvalid(true);
    });

    it("rejects a proof from a different source chain", async () => {
      const tx = encodeTx({ logs: [snapshotLog(vaultAddr, assetAddr, 1000n * E18, 1n)] });
      await expect(
        asc.submitReserveSnapshot(
          makeQuery({ chainKey: 3n, blockHeight: SRC_HEIGHT, encodedTransaction: tx }),
        ),
      ).to.be.revertedWithCustomError(asc, "WrongChainKey");
    });

    it("rejects a REVERTED source transaction even though its inclusion is valid", async () => {
      // The precompile proves inclusion, not success. A reverted tx is still in the
      // block. This is the documented footgun and the check that closes it.
      const tx = encodeTx({
        logs: [snapshotLog(vaultAddr, assetAddr, 10n ** 9n * E18, 1n)],
        receiptStatus: 0,
      });
      await expect(
        asc.submitReserveSnapshot(makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx })),
      ).to.be.revertedWithCustomError(asc, "SourceTransactionReverted");
    });

    it("rejects a byte-identical event emitted by a counterfeit vault", async () => {
      // Anyone can deploy a contract that emits this exact event with any balance and
      // get it included in a real block. The inclusion proof would be genuine.
      const fakeVault = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      const tx = encodeTx({
        logs: [snapshotLog(fakeVault, assetAddr, 10n ** 12n * E18, 1n)],
      });
      await expect(
        asc.submitReserveSnapshot(makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx })),
      ).to.be.revertedWithCustomError(asc, "NoMatchingEvent");
    });

    it("is not fooled by a counterfeit log placed BEFORE the genuine one", async () => {
      // Reading logs[0] — as the reference implementation does — would pick the fake.
      const fakeVault = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      const tx = encodeTx({
        logs: [
          snapshotLog(fakeVault, assetAddr, 10n ** 12n * E18, 99n),
          snapshotLog(vaultAddr, assetAddr, 1000n * E18, 1n),
        ],
      });
      await asc.submitReserveSnapshot(
        makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx }),
      );

      const [bal] = await asc.verifiedReserve(assetAddr);
      expect(bal).to.equal(1000n * E18); // the genuine one, not the planted one
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("replay protection", () => {
    it("rejects resubmission of the same query", async () => {
      const tx = encodeTx({ logs: [snapshotLog(vaultAddr, assetAddr, 1000n * E18, 1n)] });
      const q = makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx });

      await asc.submitReserveSnapshot(q);
      await expect(asc.submitReserveSnapshot(q)).to.be.revertedWithCustomError(
        asc,
        "QueryAlreadyProcessed",
      );
    });

    it("rejects a second mint from one deposit, even via a different query", async () => {
      await proveReserve(2000n * E18, 1n);
      await mintLock(alice.address, 100n * E18, 7n, [true, false]);

      // Same Locked event, different block height => different queryId. Only the
      // per-deposit nonce guard stops this one.
      const tx = encodeTx({ logs: [lockedLog(vaultAddr, alice.address, assetAddr, 100n * E18, 7n)] });
      await expect(
        asc.mintWithProof(
          makeQuery({ blockHeight: SRC_HEIGHT + 1n, encodedTransaction: tx, siblingFlags: [true, true] }),
        ),
      ).to.be.revertedWithCustomError(asc, "LockAlreadyConsumed");

      expect(await wrapped.totalSupply()).to.equal(100n * E18);
    });

    it("rejects replaying an older, higher snapshot to mask a shortfall", async () => {
      await proveReserve(1000n * E18, 5n);
      // epoch 3 is genuine and older — its balance is real but its conclusion is a lie.
      await expect(proveReserve(9999n * E18, 3n, SRC_HEIGHT, [true, true])).to.be.revertedWithCustomError(
        asc,
        "StaleEpoch",
      );
      const [bal] = await asc.verifiedReserve(assetAddr);
      expect(bal).to.equal(1000n * E18);
    });

    it("rejects a snapshot whose source height regresses", async () => {
      await proveReserve(1000n * E18, 1n, SRC_HEIGHT);
      await expect(
        proveReserve(2000n * E18, 2n, SRC_HEIGHT - 10n, [true, true]),
      ).to.be.revertedWithCustomError(asc, "RegressiveHeight");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("freshness, read from the chain and not from the caller", () => {
    it("halts minting once the proof falls outside the staleness bound", async () => {
      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 100n * E18, 1n);

      // Creditcoin attests further up the source chain; nobody refreshes the snapshot.
      await chainInfo.setLatestAttestation(
        CHAIN_KEY,
        SRC_HEIGHT + STALENESS + 1n,
        `0x${"bb".repeat(32)}`,
      );

      await expect(
        mintLock(bob.address, 1n * E18, 2n, [false, true]),
      ).to.be.revertedWithCustomError(asc, "ReserveStale");

      const r = await asc.solvencyReport(assetAddr);
      expect(r.fresh).to.equal(false);
      expect(await asc.isSolvent(assetAddr)).to.equal(false);
    });

    it("mints again as soon as a fresh snapshot lands", async () => {
      await proveReserve(1000n * E18, 1n);
      const far = SRC_HEIGHT + STALENESS + 1n;
      await chainInfo.setLatestAttestation(CHAIN_KEY, far, `0x${"bb".repeat(32)}`);
      await expect(mintLock(alice.address, 1n * E18, 1n)).to.be.revertedWithCustomError(
        asc,
        "ReserveStale",
      );

      await proveReserve(1000n * E18, 2n, far, [true, true]);
      await expect(mintLock(alice.address, 1n * E18, 1n)).to.emit(asc, "Minted");
    });

    it("stays fresh exactly at the bound", async () => {
      await proveReserve(1000n * E18, 1n);
      await chainInfo.setLatestAttestation(CHAIN_KEY, SRC_HEIGHT + STALENESS, `0x${"bb".repeat(32)}`);
      await expect(mintLock(alice.address, 1n * E18, 1n)).to.emit(asc, "Minted");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the custodian drain — the failure flow-only designs cannot see", () => {
    it("detects the shortfall, freezes minting, and keeps redemption open", async () => {
      // Fund the vault for real so the drain is a real ERC-20 movement.
      await asset.mint(deployer.address, 1000n * E18);
      await asset.approve(vaultAddr, 1000n * E18);
      await vault.deposit(assetAddr, 1000n * E18);

      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 900n * E18, 1n);
      expect(await asc.isSolvent(assetAddr)).to.equal(true);

      // The rug: 400 leaves the vault on the source chain.
      await vault.emergencyWithdraw(assetAddr, attacker.address, 400n * E18);
      expect(await asset.balanceOf(vaultAddr)).to.equal(600n * E18);

      // Nothing on Creditcoin has changed yet — that is the point. The shortfall
      // becomes visible only when SOMEONE snapshots. Anyone can, including a
      // bystander with no relationship to the protocol.
      expect(await asc.isSolvent(assetAddr)).to.equal(true);

      await expect(
        asc.connect(bob).submitReserveSnapshot(
          makeQuery({
            blockHeight: SRC_HEIGHT,
            encodedTransaction: encodeTx({
              logs: [snapshotLog(vaultAddr, assetAddr, 600n * E18, 2n)],
            }),
            siblingFlags: [true, true],
          }),
        ),
      )
        .to.emit(asc, "SolvencyBreach")
        .withArgs(assetAddr, 900n * E18, 600n * E18, 6_666n);

      // Minting is dead.
      expect(await asc.isSolvent(assetAddr)).to.equal(false);
      await expect(
        mintLock(bob.address, 1n * E18, 2n, [false, true]),
      ).to.be.revertedWithCustomError(asc, "MintFrozen");

      // Redemption is not. This is the asymmetric fail-safe.
      await wrapped.connect(alice).approve(ascAddr, 100n * E18);
      await expect(asc.connect(alice).redeem(assetAddr, 100n * E18)).to.emit(asc, "RedeemRequested");
      expect(await wrapped.totalSupply()).to.equal(800n * E18);
    });

    it("burning supply improves the proven ratio", async () => {
      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 1000n * E18, 1n);
      expect((await asc.solvencyReport(assetAddr)).collateralRatioBps).to.equal(10_000n);

      await wrapped.connect(alice).approve(ascAddr, 500n * E18);
      await asc.connect(alice).redeem(assetAddr, 500n * E18);
      expect((await asc.solvencyReport(assetAddr)).collateralRatioBps).to.equal(20_000n);
    });
  });


  // ───────────────────────────────────────────────────────────────────────────
  describe("closing the detection window — announced withdrawals", () => {
    it("de-rates the reserve the moment an exit is announced, before funds move", async () => {
      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 900n * E18, 1n);
      expect(await asc.isSolvent(assetAddr)).to.equal(true);

      // The custodian announces a 400 withdrawal. Nothing has moved: the vault still
      // physically holds 1000. But the announcement is provable, and once proven the
      // reserve backing supply is only 600.
      await proveReserve(1000n * E18, 2n, SRC_HEIGHT, [true, true], 400n * E18);

      const r = await asc.solvencyReport(assetAddr);
      expect(r.verifiedReserve).to.equal(1000n * E18); // still physically there
      expect(r.encumberedReserve).to.equal(400n * E18);
      expect(r.collateralRatioBps).to.equal(6_666n); // 600 backing 900
      expect(r.solvent).to.equal(false);
      expect(r.mintFrozen).to.equal(true);

      await expect(
        mintLock(bob.address, 1n * E18, 2n, [false, true]),
      ).to.be.revertedWithCustomError(asc, "MintFrozen");
    });

    it("blocks a mint that only fits if announced exits are ignored", async () => {
      await proveReserve(1000n * E18, 1n, SRC_HEIGHT, undefined, 700n * E18);

      // 500 <= 1000 physical, but only 300 is unencumbered.
      await expect(mintLock(alice.address, 500n * E18, 1n)).to.be.revertedWithCustomError(
        asc,
        "InvariantViolated",
      );
      await expect(mintLock(alice.address, 300n * E18, 2n, [false, true])).to.emit(asc, "Minted");
    });

    it("restores headroom when an announced exit is cancelled", async () => {
      await proveReserve(1000n * E18, 1n, SRC_HEIGHT, undefined, 700n * E18);
      expect((await asc.solvencyReport(assetAddr)).maxMintable).to.equal(300n * E18);

      // Cancellation shows up as a later snapshot with the encumbrance released.
      await proveReserve(1000n * E18, 2n, SRC_HEIGHT, [true, true], 0n);
      expect((await asc.solvencyReport(assetAddr)).maxMintable).to.equal(1000n * E18);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the vault's withdrawal timelock", () => {
    async function fund(amount: bigint) {
      await asset.mint(deployer.address, amount);
      await asset.approve(vaultAddr, amount);
      await vault.deposit(assetAddr, amount);
    }

    it("refuses a withdrawal delay shorter than detection latency", async () => {
      await expect(
        ethers.deployContract("ReserveVault", [0n, 119n]),
      ).to.be.revertedWithCustomError(vault, "WithdrawalDelayTooShort");
    });

    it("moves no funds when a withdrawal is announced", async () => {
      await fund(1000n * E18);
      await vault.requestWithdrawal(assetAddr, attacker.address, 400n * E18);

      expect(await asset.balanceOf(vaultAddr)).to.equal(1000n * E18); // untouched
      expect(await vault.encumbered(assetAddr)).to.equal(400n * E18);
      expect(await vault.availableReserve(assetAddr)).to.equal(600n * E18);
    });

    it("will not execute before the timelock elapses", async () => {
      await fund(1000n * E18);
      const tx = await vault.requestWithdrawal(assetAddr, attacker.address, 400n * E18);
      const rc = await tx.wait();
      const ev = rc.logs.find((l: any) => l.fragment?.name === "WithdrawalRequested");
      const id = ev.args.requestId;

      await expect(vault.executeWithdrawal(id)).to.be.revertedWithCustomError(
        vault,
        "WithdrawalNotReady",
      );

      await ethers.provider.send("hardhat_mine", ["0x80"]); // 128 blocks > 120 delay
      await expect(vault.executeWithdrawal(id)).to.emit(vault, "WithdrawalExecuted");
      expect(await asset.balanceOf(vaultAddr)).to.equal(600n * E18);
      expect(await vault.encumbered(assetAddr)).to.equal(0n);
    });

    it("cannot announce more than is unencumbered", async () => {
      await fund(1000n * E18);
      await vault.requestWithdrawal(assetAddr, attacker.address, 700n * E18);
      await expect(
        vault.requestWithdrawal(assetAddr, attacker.address, 400n * E18),
      ).to.be.revertedWithCustomError(vault, "InsufficientUnencumberedBalance");
    });

    it("reports encumbrances in the snapshot event", async () => {
      await fund(1000n * E18);
      await vault.requestWithdrawal(assetAddr, attacker.address, 250n * E18);
      await expect(vault.snapshotReserves(assetAddr))
        .to.emit(vault, "ReserveSnapshot")
        .withArgs(vaultAddr, assetAddr, 1000n * E18, 250n * E18, 1n);
    });

    it("can permanently renounce the unannounced-withdrawal escape hatch", async () => {
      await fund(1000n * E18);
      expect(await vault.emergencyEnabled()).to.equal(true);

      await expect(vault.renounceEmergencyWithdrawal()).to.emit(vault, "EmergencyWithdrawalRenounced");
      expect(await vault.emergencyEnabled()).to.equal(false);

      // After renouncing there is NO path that moves reserves without announcing.
      await expect(
        vault.emergencyWithdraw(assetAddr, attacker.address, 1n * E18),
      ).to.be.revertedWithCustomError(vault, "EmergencyDisabled");
      expect(await asset.balanceOf(vaultAddr)).to.equal(1000n * E18);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("mint velocity cap — bounding the residual window", () => {
    it("caps how much supply can be created per window", async () => {
      await proveReserve(10_000n * E18, 1n);
      await asc.setMintVelocity(assetAddr, 500n * E18, 3600);

      await expect(mintLock(alice.address, 400n * E18, 1n)).to.emit(asc, "Minted");
      await expect(
        mintLock(bob.address, 200n * E18, 2n, [false, true]),
      ).to.be.revertedWithCustomError(asc, "VelocityCapExceeded");

      expect(await asc.velocityRemaining(assetAddr)).to.equal(100n * E18);
    });

    it("refills the allowance when the window rolls over", async () => {
      await proveReserve(10_000n * E18, 1n);
      await asc.setMintVelocity(assetAddr, 500n * E18, 3600);
      await mintLock(alice.address, 500n * E18, 1n);

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      expect(await asc.velocityRemaining(assetAddr)).to.equal(500n * E18);
      await expect(mintLock(bob.address, 500n * E18, 2n, [false, true])).to.emit(asc, "Minted");
    });

    it("is unlimited when unset", async () => {
      await proveReserve(10_000n * E18, 1n);
      expect(await asc.velocityRemaining(assetAddr)).to.equal(2n ** 256n - 1n);
      await expect(mintLock(alice.address, 5_000n * E18, 1n)).to.emit(asc, "Minted");
    });
  });


  // ───────────────────────────────────────────────────────────────────────────
  describe("cross-chain liabilities — the failure every per-chain check misses", () => {
    // A wrapped asset almost never lives on one chain. Chainlink's own published
    // guidance for wrapped tokens covers the single source-to-destination case, and
    // integrations like Aave's compare the reserve feed against the supply on THAT
    // chain. That check passes on every chain at once while the aggregate is fractional.
    const REMOTE_CHAIN = 3n; // Ethereum mainnet — attested by CC3 alongside Sepolia
    const REMOTE_BEACON = "0x00000000000000000000000000000000beac0001";

    async function registerRemote() {
      await asc.registerRemoteChain(assetAddr, REMOTE_CHAIN, REMOTE_BEACON);
      await chainInfo.setLatestAttestation(REMOTE_CHAIN, SRC_HEIGHT, `0x${"cc".repeat(32)}`);
    }

    async function proveRemoteSupply(amount: bigint, epoch: bigint, flags?: boolean[]) {
      const tx = encodeTx({
        logs: [supplyLog(REMOTE_BEACON, await wrapped.getAddress(), amount, epoch)],
      });
      return asc.submitRemoteSupply(
        makeQuery({
          chainKey: REMOTE_CHAIN,
          blockHeight: SRC_HEIGHT,
          encodedTransaction: tx,
          siblingFlags: flags ?? [true, true],
        }),
      );
    }

    it("THE ATTACK: one reserve backing full supply on two chains", async () => {
      await proveReserve(1000n * E18, 1n);

      // Chain A (Creditcoin): mint the full reserve. By every per-chain measure —
      // including a Chainlink PoR feed wired exactly as Aave wires one — this is
      // 100% backed, and it genuinely is, locally.
      await mintLock(alice.address, 1000n * E18, 1n);
      expect(await wrapped.totalSupply()).to.equal(1000n * E18);
      expect((await asc.solvencyReport(assetAddr)).collateralRatioBps).to.equal(10_000n);
      expect(await asc.isSolvent(assetAddr)).to.equal(true);

      // A per-chain check stops here and reports perfect health, forever.
      // Now the second chain is registered and its supply proven: the SAME reserve
      // is also backing 1000 somewhere else.
      await registerRemote();
      await proveRemoteSupply(1000n * E18, 1n);

      const r = await asc.solvencyReport(assetAddr);
      expect(r.outstandingSupply).to.equal(2000n * E18); // aggregate, not local
      expect(r.collateralRatioBps).to.equal(5_000n); // 50% — genuinely insolvent
      expect(r.solvent).to.equal(false);
      expect(r.mintFrozen).to.equal(true);
      expect(await asc.isSolvent(assetAddr)).to.equal(false);

      // And the local chain still shows 1000 — which is exactly why per-chain
      // verification cannot see this.
      expect(await wrapped.totalSupply()).to.equal(1000n * E18);
    });

    it("counts remote supply against the bound before minting", async () => {
      await registerRemote();
      await proveReserve(1000n * E18, 1n);
      await proveRemoteSupply(700n * E18, 1n);

      // Only 300 of headroom remains globally, even though local supply is zero.
      expect((await asc.solvencyReport(assetAddr)).maxMintable).to.equal(300n * E18);
      await expect(mintLock(alice.address, 400n * E18, 1n)).to.be.revertedWithCustomError(
        asc,
        "InvariantViolated",
      );
      await expect(mintLock(alice.address, 300n * E18, 2n, [false, true])).to.emit(asc, "Minted");
    });

    it("refuses to mint while a registered chain has never reported", async () => {
      await registerRemote();
      await proveReserve(1000n * E18, 1n);

      // Unknown liability is not zero liability.
      await expect(mintLock(alice.address, 1n * E18, 1n)).to.be.revertedWithCustomError(
        asc,
        "RemoteSupplyMissing",
      );
    });

    it("halts minting when a remote report goes stale", async () => {
      await registerRemote();
      await proveReserve(1000n * E18, 1n);
      await proveRemoteSupply(100n * E18, 1n);
      await expect(mintLock(alice.address, 10n * E18, 1n)).to.emit(asc, "Minted");

      await chainInfo.setLatestAttestation(
        REMOTE_CHAIN,
        SRC_HEIGHT + STALENESS + 1n,
        `0x${"dd".repeat(32)}`,
      );
      await expect(
        mintLock(alice.address, 10n * E18, 2n, [false, true]),
      ).to.be.revertedWithCustomError(asc, "RemoteSupplyStale");
    });

    it("rejects a supply report from an unregistered beacon", async () => {
      await registerRemote();
      const tx = encodeTx({
        logs: [supplyLog("0x00000000000000000000000000000000deadbeef", await wrapped.getAddress(), 1n, 1n)],
      });
      await expect(
        asc.submitRemoteSupply(
          makeQuery({ chainKey: REMOTE_CHAIN, blockHeight: SRC_HEIGHT, encodedTransaction: tx }),
        ),
      ).to.be.revertedWithCustomError(asc, "RemoteChainNotRegistered");
    });

    it("rejects a replayed older remote supply report", async () => {
      await registerRemote();
      await proveReserve(1000n * E18, 1n);
      await proveRemoteSupply(800n * E18, 5n);
      // Epoch 3 is genuine but older — replaying it would understate liabilities.
      await expect(proveRemoteSupply(1n * E18, 3n, [false, true])).to.be.revertedWithCustomError(
        asc,
        "StaleEpoch",
      );
      expect((await asc.solvencyReport(assetAddr)).outstandingSupply).to.equal(800n * E18);
    });

    it("reports the registered chain set for integrators", async () => {
      await registerRemote();
      const chains = await asc.remoteChainsOf(assetAddr);
      expect(chains.length).to.equal(1);
      expect(chains[0]).to.equal(REMOTE_CHAIN);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("circuit breaker recovery", () => {
    async function breach() {
      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 900n * E18, 1n);
      await proveReserve(600n * E18, 2n, SRC_HEIGHT, [true, true]);
    }

    it("refuses to unfreeze while still unhealthy", async () => {
      await breach();
      await expect(asc.requestUnfreeze(assetAddr)).to.be.revertedWithCustomError(asc, "NotHealthy");
    });

    it("requires the timelock to elapse", async () => {
      await breach();
      await proveReserve(2000n * E18, 3n, SRC_HEIGHT, [false, true]);
      await asc.requestUnfreeze(assetAddr);
      await expect(asc.executeUnfreeze(assetAddr)).to.be.revertedWithCustomError(
        asc,
        "TimelockPending",
      );
    });

    it("unfreezes after the timelock once health is restored", async () => {
      await breach();
      await proveReserve(2000n * E18, 3n, SRC_HEIGHT, [false, true]);
      await asc.requestUnfreeze(assetAddr);

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      await expect(asc.executeUnfreeze(assetAddr)).to.emit(asc, "Unfrozen");
      expect(await asc.isSolvent(assetAddr)).to.equal(true);
      // A 3-sibling path yields a tx index no earlier query in this test used.
      await expect(mintLock(bob.address, 1n * E18, 2n, [true, true, true])).to.emit(asc, "Minted");
    });

    it("cannot execute an unfreeze that was never requested", async () => {
      await breach();
      await expect(asc.executeUnfreeze(assetAddr)).to.be.revertedWithCustomError(
        asc,
        "NoUnfreezeRequested",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("bounded administration", () => {
    it("cannot set a haircut above 100% — no admin action can create supply", async () => {
      await expect(asc.setHaircut(assetAddr, 10_001)).to.be.revertedWithCustomError(
        asc,
        "InvalidHaircut",
      );
      await expect(asc.setHaircut(assetAddr, 0)).to.be.revertedWithCustomError(
        asc,
        "InvalidHaircut",
      );
    });

    it("restricts admin surfaces to the owner", async () => {
      await expect(
        asc.connect(attacker).setHaircut(assetAddr, 9_000),
      ).to.be.revertedWithCustomError(asc, "OwnableUnauthorizedAccount");
      await expect(
        asc.connect(attacker).setGlobalFreeze(true),
      ).to.be.revertedWithCustomError(asc, "OwnableUnauthorizedAccount");
      await expect(
        asc.connect(attacker).registerAsset(assetAddr, assetAddr, 10_000),
      ).to.be.revertedWithCustomError(asc, "OwnableUnauthorizedAccount");
    });

    it("honours the global freeze independently of per-asset state", async () => {
      await proveReserve(1000n * E18, 1n);
      await asc.setGlobalFreeze(true);
      await expect(mintLock(alice.address, 1n * E18, 1n)).to.be.revertedWithCustomError(
        asc,
        "MintFrozen",
      );
      await asc.setGlobalFreeze(false);
      await expect(mintLock(alice.address, 1n * E18, 1n)).to.emit(asc, "Minted");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the wrapped asset", () => {
    it("lets nobody but the ASC mint", async () => {
      await expect(
        wrapped.connect(attacker).mint(attacker.address, 1n * E18),
      ).to.be.revertedWithCustomError(wrapped, "OnlyMinter");
      await expect(wrapped.mint(deployer.address, 1n * E18)).to.be.revertedWithCustomError(
        wrapped,
        "OnlyMinter",
      );
    });

    it("has no admin path to change the minter", async () => {
      // The absence of a setter is the guarantee. If this ever fails to compile away,
      // supply could be created without a proof.
      expect(wrapped.interface.fragments.some((f: any) => /setMinter|grantRole/.test(f.name ?? ""))).to
        .equal(false);
    });
  });


  // ───────────────────────────────────────────────────────────────────────────
  describe("Chainlink compatibility — the adoption path", () => {
    it("serves a proven reserve through AggregatorV3Interface", async () => {
      await proveReserve(1000n * E18, 1n);
      const feed = await ethers.deployContract("ProvenReserveFeed", [
        ascAddr,
        assetAddr,
        18,
        "mTUSD Proven Reserve",
      ]);

      const [roundId, answer, startedAt, updatedAt] = await feed.latestRoundData();
      expect(answer).to.equal(1000n * E18);
      expect(roundId).to.equal(1n); // epoch doubles as a monotonic round id
      expect(updatedAt).to.be.greaterThan(0n);
      expect(startedAt).to.equal(updatedAt);
      expect(await feed.trustedParties()).to.equal(0);
      expect(await feed.decimals()).to.equal(18);
    });

    it("reports the ENCUMBRANCE-ADJUSTED reserve, which ordinary PoR does not", async () => {
      // 1000 held, 400 announced for withdrawal. A conventional PoR feed would report
      // the gross 1000 and leave encumbrance to an auditor's footnote.
      await proveReserve(1000n * E18, 1n, SRC_HEIGHT, undefined, 400n * E18);
      const feed = await ethers.deployContract("ProvenReserveFeed", [
        ascAddr,
        assetAddr,
        18,
        "mTUSD Proven Reserve",
      ]);

      const [, answer] = await feed.latestRoundData();
      expect(answer).to.equal(600n * E18);
    });

    it("runs Chainlink's OWN Secure Mint pattern, unmodified, on our proof", async () => {
      await proveReserve(1000n * E18, 1n);
      const feed = await ethers.deployContract("ProvenReserveFeed", [
        ascAddr,
        assetAddr,
        18,
        "mTUSD Proven Reserve",
      ]);

      // SecureMintReference imports only AggregatorV3Interface. It has no idea
      // MintBound, Creditcoin, precompiles or proofs exist.
      const secureMint = await ethers.deployContract("SecureMintReference", [
        await feed.getAddress(),
        3600n,
      ]);

      await expect(secureMint.mint(alice.address, 900n * E18)).to.emit(secureMint, "Minted");
      expect(await secureMint.totalSupply()).to.equal(900n * E18);

      // And its unmodified reserve check now enforces our bound.
      await expect(
        secureMint.mint(bob.address, 200n * E18),
      ).to.be.revertedWithCustomError(secureMint, "InsufficientReserves");
    });

    it("gives an unmodified integration our freshness guarantee via its own staleness check", async () => {
      await proveReserve(1000n * E18, 1n);
      const feed = await ethers.deployContract("ProvenReserveFeed", [
        ascAddr,
        assetAddr,
        18,
        "mTUSD Proven Reserve",
      ]);
      const secureMint = await ethers.deployContract("SecureMintReference", [
        await feed.getAddress(),
        3600n,
      ]);

      await expect(secureMint.mint(alice.address, 1n * E18)).to.emit(secureMint, "Minted");

      // No new proof lands for over an hour. The integrator's OWN `updatedAt` check —
      // code they already wrote for Chainlink — now trips on MintBound's staleness.
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        secureMint.mint(alice.address, 1n * E18),
      ).to.be.revertedWithCustomError(secureMint, "StaleReserveData");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("evidence grading — covering assets a proof cannot reach", () => {
    it("grades proven assets as zero trusted parties", async () => {
      await proveReserve(1000n * E18, 1n);
      expect(await asc.trustedParties(assetAddr)).to.equal(0);
      expect((await asc.solvencyReport(assetAddr)).trustedParties).to.equal(0);
    });

    it("covers an off-chain asset via a feed, and says so honestly", async () => {
      // A fiat reserve cannot be lifted into an event. MintBound still covers it —
      // but reports trustedParties = 1 rather than pretending it is proven.
      const feed = await ethers.deployContract("MockAggregator", [18, 5_000n * E18]);
      const offchainAsset = "0x00000000000000000000000000000000000000A1";
      const wrapped2 = await ethers.deployContract("WrappedAsset", ["W", "W", 18, ascAddr]);

      await asc.registerOracleBackedAsset(
        offchainAsset,
        await wrapped2.getAddress(),
        10_000,
        await feed.getAddress(),
      );

      const r = await asc.solvencyReport(offchainAsset);
      expect(r.verifiedReserve).to.equal(5_000n * E18);
      expect(r.trustedParties).to.equal(1); // honest about the weaker tier
      expect(r.solvent).to.equal(true);
      expect(await asc.trustedParties(offchainAsset)).to.equal(1);
    });

    it("refuses to mint on oracle evidence unless explicitly opted in", async () => {
      const feed = await ethers.deployContract("MockAggregator", [18, 5_000n * E18]);
      const offchainAsset = "0x00000000000000000000000000000000000000A2";
      const wrapped2 = await ethers.deployContract("WrappedAsset", ["W", "W", 18, ascAddr]);
      await asc.registerOracleBackedAsset(
        offchainAsset,
        await wrapped2.getAddress(),
        10_000,
        await feed.getAddress(),
      );

      const tx = encodeTx({
        logs: [lockedLog(vaultAddr, alice.address, offchainAsset, 10n * E18, 1n)],
      });
      await expect(
        asc.mintWithProof(
          makeQuery({ blockHeight: SRC_HEIGHT, encodedTransaction: tx, siblingFlags: [true, true] }),
        ),
      ).to.be.revertedWithCustomError(asc, "OracleMintDisabled");
    });

    it("marks an oracle-backed asset stale when its feed stops updating", async () => {
      const feed = await ethers.deployContract("MockAggregator", [18, 5_000n * E18]);
      const offchainAsset = "0x00000000000000000000000000000000000000A3";
      const wrapped2 = await ethers.deployContract("WrappedAsset", ["W", "W", 18, ascAddr]);
      await asc.registerOracleBackedAsset(
        offchainAsset,
        await wrapped2.getAddress(),
        10_000,
        await feed.getAddress(),
      );
      expect((await asc.solvencyReport(offchainAsset)).fresh).to.equal(true);

      // maxStalenessBlocks (200) x 12s = 2400s of tolerated feed age.
      await ethers.provider.send("evm_increaseTime", [3000]);
      await ethers.provider.send("evm_mine", []);
      expect((await asc.solvencyReport(offchainAsset)).fresh).to.equal(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("composability through ISolvencyOracle", () => {
    it("gates a third-party lending market on proven solvency", async () => {
      const credit = await ethers.deployContract("SolvencyGatedCredit", [ascAddr, 10_000]);

      await proveReserve(1000n * E18, 1n);
      await mintLock(alice.address, 500n * E18, 1n);

      let [accepted] = await credit.acceptsCollateral(assetAddr);
      expect(accepted).to.equal(true);

      const wrappedAddr = await wrapped.getAddress();
      await wrapped.connect(alice).approve(await credit.getAddress(), 100n * E18);
      await expect(credit.connect(alice).postCollateral(assetAddr, wrappedAddr, 100n * E18)).to.emit(
        credit,
        "CollateralPosted",
      );

      // Reserve collapses. The market closes to new collateral with no price feed and
      // no governance action involved.
      await proveReserve(100n * E18, 2n, SRC_HEIGHT, [true, true]);
      [accepted] = await credit.acceptsCollateral(assetAddr);
      expect(accepted).to.equal(false);

      await wrapped.connect(alice).approve(await credit.getAddress(), 10n * E18);
      await expect(
        credit.connect(alice).postCollateral(assetAddr, wrappedAddr, 10n * E18),
      ).to.be.revertedWithCustomError(credit, "CollateralNotProvenSolvent");

      // Existing collateral can still be withdrawn — same asymmetry as redemption.
      await expect(credit.connect(alice).withdrawCollateral(wrappedAddr, 100n * E18)).to.emit(
        credit,
        "CollateralWithdrawn",
      );
    });
  });
});
