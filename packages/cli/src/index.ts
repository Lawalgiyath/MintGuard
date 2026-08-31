#!/usr/bin/env node
import { attack } from "./commands/attack.js";
import { claims } from "./commands/claims.js";
import { status } from "./commands/status.js";
import { verify } from "./commands/verify.js";
import { c } from "./render.js";

const USAGE = `
${c.bold("mintbound")} — check MintBound's solvency evidence yourself

  ${c.bold("status")}                        the whole balance sheet and assurance vector, live
  ${c.bold("verify")} --source-tx <hash>     walk one source transaction through the precompile
  ${c.bold("attack")}                        fire the documented attacks at the live guard
  ${c.bold("claims")}                        audit every claim our submission makes, live

${c.grey("Options")}
  --json                        machine-readable output (status only)
  --help                        this text

${c.grey("Everything here is read-only. No private key, no funded account, no setup — the")}
${c.grey("Proof Builder is a read API and the guard's entry points are reachable by eth_call,")}
${c.grey("so a stranger can check every claim MintBound makes without being trusted with")}
${c.grey("anything. That is the point.")}

${c.grey("Examples")}
  npx @mintbound/cli status
  npx @mintbound/cli verify --source-tx 0xc42a211e02ee86e5d92bb0bee2cef1679fbd358e474a044bdfe1e7ff7c9efa9c
  npx @mintbound/cli attack
  npx @mintbound/cli claims
`;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  switch (cmd) {
    case "status":
      return status({ json: argv.includes("--json") });

    case "verify": {
      const tx = arg(argv, "source-tx") ?? arg(argv, "tx") ?? argv[1];
      if (!tx || tx.startsWith("--")) {
        console.error(c.red("verify needs a transaction hash: --source-tx 0x..."));
        return 2;
      }
      return verify(tx);
    }

    case "attack":
      return attack();

    case "claims":
      return claims({ json: argv.includes("--json") });

    default:
      console.error(c.red(`Unknown command: ${cmd}`));
      console.log(USAGE);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((e) => {
    console.error(c.red(`\n${e?.shortMessage ?? e?.message ?? e}`));
    process.exitCode = 1;
  });
