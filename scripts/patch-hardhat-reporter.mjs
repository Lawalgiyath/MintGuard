#!/usr/bin/env node
/**
 * Works around an upstream Hardhat 3 / Node 25 incompatibility.
 *
 * `hardhat test solidity` crashes before printing results:
 *
 *   TypeError [ERR_INVALID_ARG_VALUE]: The argument 'format' must be one of:
 *   … 'gray' … Received 'grey'
 *
 * Hardhat's Solidity-test reporter calls `util.styleText("grey", …)`. Node accepted
 * that spelling historically; Node 22+ tightened the allowed list to 'gray' only, so
 * on Node 25 the reporter throws while formatting the FIRST passing test. The tests
 * themselves run fine — only the printing dies, which makes it look like a test
 * failure when it is not.
 *
 * This rewrites the two spellings in the installed reporter. It is idempotent, safe to
 * run when the bug is already fixed upstream, and never fails the install.
 *
 * Runs automatically via the root `postinstall` script.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "node_modules/hardhat/dist/src/internal/builtin-plugins/solidity-test/reporter.js",
  "node_modules/hardhat/src/internal/builtin-plugins/solidity-test/reporter.ts",
];

let patched = 0;
for (const rel of targets) {
  const file = join(root, rel);
  if (!existsSync(file)) continue;
  try {
    const before = readFileSync(file, "utf8");
    const after = before.replaceAll('"grey"', '"gray"').replaceAll("'grey'", "'gray'");
    if (after !== before) {
      writeFileSync(file, after, "utf8");
      patched++;
    }
  } catch {
    // Never break an install over a cosmetic reporter fix.
  }
}

if (patched > 0) {
  console.log(`[mintbound] patched ${patched} Hardhat reporter file(s) for Node 22+ styleText`);
}
