import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { BLOCK_PROVER, CHAIN_INFO, encodeTx, makeQuery, snapshotLog, addrTopic } from "./helpers.js";

/**
 * Proof of reserve over an INTERVAL, not at an instant.
 *
 * The claim under test: a bonded assertion that no reserve left the vault across a
 * height range, refutable by a single cryptographic inclusion proof of one outbound
 * Transfer. If it holds, the reserve is proven for every height in the range — not
 * interpolated between two snapshots.
 *
 * These tests are written to BREAK it. The interesting ones are the attempts to get
 * coverage without earning it: unfalsifiable claims over unattested blocks, gaps in the
 * chain of intervals, forged Transfer logs from a fake token, and outflows just outside
 * the asserted range.
 */

const abi = AbiCoder.defaultAbiCoder();
const CHAIN_KEY = 1n;
const E18 = 10n ** 18n;
const TRANSFER_SIG = keccak256(toUtf8Bytes("Transfer(address,address,uint256)"));
const LIVENESS = 3600n;
const MIN_BOND = 10n ** 16n; // 0.01 CTC

/** An ERC-20 Transfer log, as the real token contract emits it. */
function transferLog(token: string, from: string, to: string, value: bigint) {
  return {
    address_: token,
    topics: [TRANSFER_SIG, addrTopic(from), addrTopic(to)],
    data: abi.encode(["uint256"], [value]),
  };
}

describe("SolvencyContinuity — interval proof of reserve", () => {
  let ethers: any;
  let deployer: any, alice: any, watcher: any;
  let asset: any, vault: any, asc: any, wrapped: any, chainInfo: any, prover: any, cont: any;
  let assetAddr: string, vaultAddr: string, ascAddr: string;
  let snap: any;

  const A = 1_000_000n; // anchor height (a proven snapshot)
  const B = 1_000_500n; // end of the asserted interval

  before(async () => {
    ({ ethers } = await network.connect());
    [deployer, alice, watcher] = await ethers.getSigners();

    const proverImpl = await ethers.deployContract("MockBlockProver");
    await ethers.provider.send("hardhat_setCode", [
      BLOCK_PROVER,
      await ethers.provider.getCode(await proverImpl.getAddress()),
    ]);
    prover = await ethers.getContractAt("MockBlockProver", BLOCK_PROVER);
    await prover.setRevertOnInvalid(true);

    const ciImpl = await ethers.deployContract("MockChainInfo");
    await ethers.provider.send("hardhat_setCode", [
      CHAIN_INFO,
      await ethers.provider.getCode(await ciImpl.getAddress()),
    ]);
    chainInfo = await ethers.getContractAt("MockChainInfo", CHAIN_INFO);

    asset = await ethers.deployContract("TestUSD", ["Test USD", "TUSD", 18]);
    assetAddr = await asset.getAddress();
    vault = await ethers.deployContract("ReserveVault", [0n, 150n]);
    vaultAddr = await vault.getAddress();
    await vault.setSupportedAsset(assetAddr, true);

    asc = await ethers.deployContract("MintBoundASC", [CHAIN_KEY, vaultAddr, 200n]);
    ascAddr = await asc.getAddress();
    wrapped = await ethers.deployContract("WrappedAsset", ["W", "W", 18, ascAddr]);
    await asc.registerAsset(assetAddr, await wrapped.getAddress(), 10_000);

    cont = await ethers.deployContract("SolvencyContinuity", [
      ascAddr,
      CHAIN_KEY,
      vaultAddr,
      MIN_BOND,
      LIVENESS,
    ]);

    // Anchor: a proven reserve snapshot at height A.
    await chainInfo.setLatestAttestation(CHAIN_KEY, B + 100n, `0x${"aa".repeat(32)}`);
    await asc.submitReserveSnapshot(
      makeQuery({
        blockHeight: A,
        encodedTransaction: encodeTx({
          logs: [snapshotLog(vaultAddr, assetAddr, 1000n * E18, 1n)],
        }),
      }),
    );

    snap = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snap]);
    snap = await ethers.provider.send("evm_snapshot", []);
  });

  const assertInterval = (from = A, to = B, bond = MIN_BOND) =>
    cont.assertNoOutflow(assetAddr, from, to, { value: bond });

  async function claimIdFrom(tx: any): Promise<string> {
    const rc = await tx.wait();
    const ev = rc.logs.find((l: any) => l.fragment?.name === "ContinuityAsserted");
    return ev.args.claimId;
  }

  function outflowQuery(height: bigint, token = assetAddr, from = vaultAddr, flags?: boolean[]) {
    return makeQuery({
      blockHeight: height,
      encodedTransaction: encodeTx({
        logs: [transferLog(token, from, "0x00000000000000000000000000000000deadbeef", 400n * E18)],
      }),
      siblingFlags: flags ?? [true, false],
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  describe("the guarantee", () => {
    it("anchors to a cryptographically proven snapshot height", async () => {
      expect(await cont.anchorHeight(assetAddr)).to.equal(A);
    });

    it("establishes continuous coverage when nobody can refute it", async () => {
      const id = await claimIdFrom(await assertInterval());
      expect(await cont.coveredThrough(assetAddr)).to.equal(0n);

      await ethers.provider.send("evm_increaseTime", [Number(LIVENESS) + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(cont.settle(id)).to.emit(cont, "ContinuityProven").withArgs(id, assetAddr, B);
      expect(await cont.coveredThrough(assetAddr)).to.equal(B);
    });

    it("returns the bond to the asserter on settlement", async () => {
      const id = await claimIdFrom(await assertInterval());
      await ethers.provider.send("evm_increaseTime", [Number(LIVENESS) + 1]);
      await ethers.provider.send("evm_mine", []);

      const before = await ethers.provider.getBalance(deployer.address);
      const rc = await (await cont.settle(id)).wait();
      const after = await ethers.provider.getBalance(deployer.address);
      // Bond returned, minus gas.
      expect(after + rc.gasUsed * rc.gasPrice - before).to.equal(MIN_BOND);
    });

    it("advances coverage contiguously across consecutive intervals", async () => {
      let id = await claimIdFrom(await assertInterval(A, B));
      await ethers.provider.send("evm_increaseTime", [Number(LIVENESS) + 1]);
      await ethers.provider.send("evm_mine", []);
      await cont.settle(id);

      id = await claimIdFrom(await assertInterval(B, B + 100n));
      await ethers.provider.send("evm_increaseTime", [Number(LIVENESS) + 1]);
      await ethers.provider.send("evm_mine", []);
      await cont.settle(id);

      expect(await cont.coveredThrough(assetAddr)).to.equal(B + 100n);
      expect(await cont.uncoveredBlocks(assetAddr)).to.equal(0n);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("refutation — one proof destroys the claim", () => {
    it("a single outbound Transfer refutes the interval and pays the challenger", async () => {
      const id = await claimIdFrom(await assertInterval());

      const before = await ethers.provider.getBalance(watcher.address);
      const rc = await (
        await cont.connect(watcher).disprove(id, outflowQuery(A + 250n))
      ).wait();
      const after = await ethers.provider.getBalance(watcher.address);

      expect(after + rc.gasUsed * rc.gasPrice - before).to.equal(MIN_BOND); // bond seized
      expect((await cont.claims(id)).disproven).to.equal(true);
      expect(await cont.coveredThrough(assetAddr)).to.equal(0n); // no coverage granted
    });

    it("a refuted claim can never be settled", async () => {
      const id = await claimIdFrom(await assertInterval());
      await cont.connect(watcher).disprove(id, outflowQuery(A + 250n));

      await ethers.provider.send("evm_increaseTime", [Number(LIVENESS) + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(cont.settle(id)).to.be.revertedWithCustomError(cont, "ClaimClosed");
    });

    it("refutation is permissionless — anyone may collect", async () => {
      const id = await claimIdFrom(await assertInterval());
      await expect(cont.connect(alice).disprove(id, outflowQuery(A + 10n))).to.emit(
        cont,
        "ContinuityRefuted",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("attempts to get coverage without earning it", () => {
    it("rejects an unfalsifiable claim over blocks nobody can prove anything about", async () => {
      // Beyond the attested tip no disproof could ever be generated, so accepting such a
      // claim by default would be strictly worse than having no claim at all.
      const latest = B + 100n;
      await expect(assertInterval(A, latest + 1n)).to.be.revertedWithCustomError(
        cont,
        "BeyondAttestation",
      );
    });

    it("rejects a claim that skips a gap in coverage", async () => {
      await expect(assertInterval(A + 50n, B)).to.be.revertedWithCustomError(cont, "NonContiguous");
    });

    it("rejects an empty or inverted interval", async () => {
      await expect(assertInterval(A, A)).to.be.revertedWithCustomError(cont, "EmptyInterval");
    });

    it("rejects an underfunded bond", async () => {
      await expect(assertInterval(A, B, MIN_BOND - 1n)).to.be.revertedWithCustomError(
        cont,
        "BondTooSmall",
      );
    });

    it("allows only one open claim per asset", async () => {
      await assertInterval();
      await expect(assertInterval()).to.be.revertedWithCustomError(cont, "ClaimAlreadyOpen");
    });

    it("cannot settle before the liveness window closes", async () => {
      const id = await claimIdFrom(await assertInterval());
      await expect(cont.settle(id)).to.be.revertedWithCustomError(cont, "StillLive");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("attempts to forge a refutation", () => {
    it("rejects a Transfer forged by a contract that is not the real token", async () => {
      // Anyone can emit a Transfer-shaped log. Only the asset's own contract counts.
      const id = await claimIdFrom(await assertInterval());
      const fakeToken = "0x00000000000000000000000000000000f00dbabe";
      await expect(
        cont.connect(watcher).disprove(id, outflowQuery(A + 10n, fakeToken)),
      ).to.be.revertedWithCustomError(cont, "NoOutflowFound");
    });

    it("rejects a Transfer that did not come from the canonical vault", async () => {
      const id = await claimIdFrom(await assertInterval());
      const someoneElse = "0x00000000000000000000000000000000cafe0001";
      await expect(
        cont.connect(watcher).disprove(id, outflowQuery(A + 10n, assetAddr, someoneElse)),
      ).to.be.revertedWithCustomError(cont, "NoOutflowFound");
    });

    it("rejects an outflow from outside the asserted interval", async () => {
      const id = await claimIdFrom(await assertInterval());
      await expect(
        cont.connect(watcher).disprove(id, outflowQuery(B + 50n)),
      ).to.be.revertedWithCustomError(cont, "HeightOutsideInterval");
      await expect(
        cont.connect(watcher).disprove(id, outflowQuery(A)),
      ).to.be.revertedWithCustomError(cont, "HeightOutsideInterval");
    });

    it("rejects a refutation whose proof the precompile will not verify", async () => {
      const id = await claimIdFrom(await assertInterval());
      const root = `0x${"99".repeat(32)}`;
      await prover.setInvalidRoot(root, true);
      const q = makeQuery({
        blockHeight: A + 10n,
        encodedTransaction: encodeTx({
          logs: [transferLog(assetAddr, vaultAddr, alice.address, 1n)],
        }),
        merkleRoot: root,
      });
      await expect(cont.connect(watcher).disprove(id, q)).to.be.revertedWith(
        "Merkle proof validation failed",
      );
    });

    it("rejects a refutation built from a REVERTED source transaction", async () => {
      const id = await claimIdFrom(await assertInterval());
      const q = makeQuery({
        blockHeight: A + 10n,
        encodedTransaction: encodeTx({
          logs: [transferLog(assetAddr, vaultAddr, alice.address, 1n)],
          receiptStatus: 0,
        }),
      });
      await expect(cont.connect(watcher).disprove(id, q)).to.be.revertedWithCustomError(
        cont,
        "SourceTransactionReverted",
      );
    });

    it("rejects a proof from the wrong source chain", async () => {
      const id = await claimIdFrom(await assertInterval());
      const q = makeQuery({
        chainKey: 3n,
        blockHeight: A + 10n,
        encodedTransaction: encodeTx({
          logs: [transferLog(assetAddr, vaultAddr, alice.address, 1n)],
        }),
      });
      await expect(cont.connect(watcher).disprove(id, q)).to.be.revertedWithCustomError(
        cont,
        "WrongChainKey",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("honest reporting of what is not yet covered", () => {
    it("reports every attested block as uncovered before any claim settles", async () => {
      expect(await cont.uncoveredBlocks(assetAddr)).to.equal(B + 100n);
      expect(await cont.isContinuouslyProven(assetAddr, A)).to.equal(false);
    });

    it("reports continuity only once coverage reaches the attested tip", async () => {
      const id = await claimIdFrom(await assertInterval(A, B));
      await ethers.provider.send("evm_increaseTime", [Number(LIVENESS) + 1]);
      await ethers.provider.send("evm_mine", []);
      await cont.settle(id);

      // Covered to B, but the chain is attested to B+100 — so NOT continuous to now.
      expect(await cont.uncoveredBlocks(assetAddr)).to.equal(100n);
      expect(await cont.isContinuouslyProven(assetAddr, A)).to.equal(false);

      const id2 = await claimIdFrom(await assertInterval(B, B + 100n));
      await ethers.provider.send("evm_increaseTime", [Number(LIVENESS) + 1]);
      await ethers.provider.send("evm_mine", []);
      await cont.settle(id2);

      expect(await cont.uncoveredBlocks(assetAddr)).to.equal(0n);
      expect(await cont.isContinuouslyProven(assetAddr, A)).to.equal(true);
    });
  });
});
