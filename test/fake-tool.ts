// A stand-in for hc, herdr-app and opencode used by the CLI tests. It records every
// call as one JSON line in FAKE_LOG, then answers from FAKE_DIR/<tool>.<command>.{out,err,exit}.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FAKE_DIR ?? "";
const log = process.env.FAKE_LOG ?? "";
const [tool, ...args] = process.argv.slice(2);

appendFileSync(
  log,
  JSON.stringify({ tool, args, caller: process.env.HC_TERMINAL_ID ?? null, cwd: process.cwd() }) + "\n",
);

function answer(name: string): number {
  const delayFile = join(dir, `${name}.delay`);
  if (existsSync(delayFile)) {
    const ms = Number(readFileSync(delayFile, "utf8").trim());
    if (Number.isFinite(ms) && ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.floor(ms));
  }
  const out = join(dir, `${name}.out`);
  const err = join(dir, `${name}.err`);
  const code = join(dir, `${name}.exit`);
  if (existsSync(out)) process.stdout.write(readFileSync(out, "utf8"));
  if (existsSync(err)) process.stderr.write(readFileSync(err, "utf8"));
  return existsSync(code) ? Number(readFileSync(code, "utf8").trim()) : 0;
}

if (tool === "hc") {
  const [command, ...rest] = args;
  if (command === "ls") process.exit(answer("hc.ls"));
  // hcx asks for JSON after the command (`hc get --json t5`); the fixture is
  // still named for the terminal.
  if (command === "get") process.exit(answer(`hc.get.${rest[0] === "--json" ? rest[1] : rest[0]}`));
  if (command === "send") process.exit(answer("hc.send"));
  // hcx asks for JSON after the command (`hc keys --json t5 enter`); the fixture
  // is still named for the terminal.
  if (command === "keys") process.exit(answer(`keys.${rest[0] === "--json" ? rest[1] : rest[0]}`));
  if (command === "kill" || command === "rm") process.exit(answer(`${command}.${rest[0]}`));
  if (command === "--version" || command === "-V") process.exit(answer("hc.version"));
  process.exit(0);
}

if (tool === "herdr-app") {
  if (args[0] === "ls") process.exit(answer("herdr.ls"));
  if (args[0] === "do") process.exit(answer("herdr.do"));
  process.exit(0);
}

if (tool === "opencode") {
  if (args[0] === "api") process.exit(answer(`opencode.${args[1]}`));
  process.exit(0);
}

process.exit(0);
