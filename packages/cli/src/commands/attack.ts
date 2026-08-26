import {
  AbiCoder,
  Contract,
  Interface,
  getAddress,
  keccak256,
  toUtf8Bytes,
  zeroPadValue,
} from "ethers";
import { ASC_ABI, ASC_ERRORS } from "../abi.js";
import { EXPLORER, creditcoin, sepolia } from "../config.js";
import { providers } from "../read.js";
import { describeRevert } from "../revert.js";
import { CROSS, TICK, c, heading, rule } from "../render.js";

/**
 * `mintbound attack` — fire the documented attacks at the live guard and report back.
 *
 * These are real `eth_call`s against the real MintBoundASC on CC3. Every one is
 * expected to revert, and the reverts are the product.
 *
 * WHAT THIS PROVES, EXACTLY: each attempt carries forged proof material, so each is
 * rejected by the Block Prover precompile before the guard's own logic runs. There is
 * no path around the precompile. It does NOT exercise the guard's internal rejections
 * (emitter binding, event matching, replay) — those require a *valid* proof carrying
 * malicious contents, which cannot be forged against live CC3 by construction, and are
 * covered in the unit suite against a mock verifier instead.
 */

const abi = AbiCoder.defaultAbiCoder();

const RESERVE_SNAPSHOT_SIG = keccak256(
  toUtf8Bytes("ReserveSnapshot(address,address,uint256,uint256,uint256)"),
);
const LOCKED_SIG = keccak256(toUtf8Bytes("Locked(address,address,uint256,uint256)"));
const topic = (a: string) => zeroPadValue(getAddress(a), 32);

interface LogEntry {
  address_: string;
  topics: string[];
  data: string;
}

function encodeTx(logs: LogEntry[], receiptStatus = 1): string {
  const common = abi.encode(
    ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
    [
      1n,
      500000n,
      "0x1111111111111111111111111111111111111111",
      false,
      "0x2222222222222222222222222222222222222222",
      0n,
      "0x",
    ],
  );
  const typeSpecific = abi.encode(
    ["uint64", "uint128", "uint128", "tuple(address,bytes32[])[]", "uint8", "bytes32", "bytes32"],
    [11155111n, 1n, 2n, [], 0, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`],
  );
  const receipt = abi.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [
      receiptStatus,
      100000n,
      logs.map((l) => [l.address_, l.topics, l.data]),
      "0x" + "00".repeat(256),
    ],
  );
  return abi.encode(["uint8", "bytes[]"], [2, [common, typeSpecific, receipt]]);
}

/** Three non-indexed words, matching ReserveVault's event exactly. */
function snapshotLog(vault: string, asset: string, balance: bigint, epoch: bigint): LogEntry {
  return {
    address_: vault,
    topics: [RESERVE_SNAPSHOT_SIG, topic(vault), topic(asset)],
    data: abi.encode(["uint256", "uint256", "uint256"], [balance, 0n, epoch]),
  };
}

function lockedLog(
  vault: string,
  user: string,
  asset: string,
  amount: bigint,
  nonce: bigint,
): LogEntry {
  return {
    address_: vault,
    topics: [LOCKED_SIG, topic(user), topic(asset)],
    data: abi.encode(["uint256", "uint256"], [amount, nonce]),
  };
}

function query(
  blockHeight: bigint,
  encodedTransaction: string,
  opts: { chainKey?: bigint } = {},
) {
  return [
    opts.chainKey ?? 1n,
    blockHeight,
    encodedTransaction,
    `0x${"ab".repeat(32)}`,
    [
      [keccak256(toUtf8Bytes("s0")), false],
      [keccak256(toUtf8Bytes("s1")), true],
    ],
    `0x${"cd".repeat(32)}`,
    [`0x${"ef".repeat(32)}`],
  ] as const;
}

export async function attack() {
  const cc = creditcoin();
  const sep = sepolia();
  const { cc: ccProvider, sep: sepProvider } = providers();

  const ascAddr = cc.contracts.MintBoundASC;
  const vault = String(cc.config?.canonicalVault ?? sep.contracts.ReserveVault);
  const asset = String(cc.config?.sourceAsset ?? sep.contracts.TestUSD);
  const iface = new Interface([...ASC_ABI, ...ASC_ERRORS] as unknown as string[]);
  const asc = new Contract(ascAddr, iface, ccProvider);

  // Aim at a height that actually exists, so a rejection is never merely "no such block".
  const head = BigInt(await sepProvider.getBlockNumber().catch(() => 11_600_000));

  heading("MintBound — live attack suite");
  console.log(`  target   ${ascAddr}  ${c.grey("(Creditcoin CC3)")}`);
  console.log(`  vault    ${vault}  ${c.grey("(Sepolia)")}`);
  console.log(`  height   ${head}`);
  console.log("");
  console.log(
    c.grey(
      "  Real eth_calls against the live guard. Every one should revert. Forged proof\n" +
        "  material means each is stopped by the precompile before the guard's own\n" +
        "  checks run — which is the property being demonstrated.",
    ),
  );

  const cases: { name: string; expect: string; run: () => Promise<unknown> }[] = [
    {
      name: "Forged inclusion proof",
      expect: "the precompile will not verify fabricated material",
      run: () =>
        asc.submitReserveSnapshot!.staticCall(
          query(head, encodeTx([snapshotLog(vault, asset, 10n ** 30n, 999n)])),
        ),
    },
    {
      name: "Counterfeit vault, identical event",
      expect: "a counterfeit emitter still needs a real inclusion proof",
      run: () =>
        asc.submitReserveSnapshot!.staticCall(
          query(
            head,
            encodeTx([
              snapshotLog("0xdeadbeef00000000000000000000000000000000", asset, 10n ** 30n, 999n),
            ]),
          ),
        ),
    },
    {
      name: "Reverted source transaction",
      expect: "a reverted receipt is unprovable to begin with",
      run: () =>
        asc.submitReserveSnapshot!.staticCall(
          query(head, encodeTx([snapshotLog(vault, asset, 10n ** 30n, 999n)], 0)),
        ),
    },
    {
      name: "Proof from the wrong source chain",
      expect: "chainKey is pinned at construction, before any proof work",
      run: () =>
        asc.submitReserveSnapshot!.staticCall(
          query(head, encodeTx([snapshotLog(vault, asset, 1n, 999n)]), { chainKey: 3n }),
        ),
    },
    {
      name: "Mint with no authorising Locked event",
      expect: "nothing here authorises a mint",
      run: () =>
        asc.mintWithProof!.staticCall(
          query(head, encodeTx([snapshotLog(vault, asset, 1n, 1n)])),
        ),
    },
    {
      name: "Unauthorised mint of an enormous amount",
      expect: "rejected before any supply is created",
      run: () =>
        asc.mintWithProof!.staticCall(
          query(
            head,
            encodeTx([
              lockedLog(vault, "0x000000000000000000000000000000000000dEaD", asset, 10n ** 30n, 424242n),
            ]),
          ),
        ),
    },
  ];

  const results: { name: string; blocked: boolean; reason: string }[] = [];

  for (const t of cases) {
    console.log("");
    console.log(`  ${c.bold(t.name)}`);
    console.log(c.grey(`    expect: ${t.expect}`));
    try {
      await t.run();
      console.log(`    ${c.red("SUCCEEDED")} — this must not happen. Investigate before shipping.`);
      results.push({ name: t.name, blocked: false, reason: "call succeeded" });
    } catch (e: any) {
      const reason = describeRevert(iface, e);
      console.log(`    ${c.green(TICK + " BLOCKED")} ${c.grey(reason)}`);
      results.push({ name: t.name, blocked: true, reason });
    }
  }

  const blocked = results.filter((r) => r.blocked).length;
  heading("Summary");
  for (const r of results) {
    console.log(`  ${r.blocked ? c.green(TICK) : c.red(CROSS)} ${r.name}`);
  }
  console.log("");
  // Be precise about WHERE each one died. Most are stopped by the precompile; the
  // chain-key case never reaches it, because the key is pinned at construction and
  // checked first. Reporting them all as "blocked at the proof layer" would be tidier
  // and wrong.
  const atProof = results.filter((r) => /merkle|proof/i.test(r.reason)).length;
  const beforeProof = blocked - atProof;
  const tally = `${blocked}/${results.length}`;
  console.log(
    `  ${blocked === results.length ? c.green(tally) : c.red(tally)} blocked` +
      c.grey(
        ` — ${atProof} by the Block Prover precompile` +
          (beforeProof > 0 ? `, ${beforeProof} by the guard before it got that far` : ""),
      ),
  );
  console.log(
    c.grey(
      "\n  Guard-internal rejections — emitter binding, event matching, chain-key pinning,\n" +
        "  replay protection — need a valid proof carrying malicious contents, which cannot\n" +
        "  be forged against live CC3. Those are covered in test/MintBound.test.ts against a\n" +
        "  mock verifier.",
    ),
  );
  rule();
  console.log(c.grey(`  ${EXPLORER.creditcoin}/address/${ascAddr}`));
  console.log("");

  return blocked === results.length ? 0 : 1;
}
