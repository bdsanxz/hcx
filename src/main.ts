import { spawnSync } from "node:child_process";
import { done } from "./done";
import { loadTabs } from "./herdr";
import { CAPABILITIES, CONTRACT_VERSION, HcxError, needsTabLookup, resolveArgs, runArgs } from "./lib";
import { runHc } from "./passthrough";
import { send } from "./send";
import { spawn } from "./spawn";
import { VERSION } from "./version";

const USAGE = `hcx — helper over hc for Herdr

  hcx send [--wait] [--force] [--json] [--if idle|working] [--timeout SECONDS] [--no-footer] [--agent-only] <tab-name|tNN> "text"
                                     send without the <hc from> tag, with a sender footer
                                     --no-footer (alias --raw): the text exactly as given
                                     --agent-only: refuse a plain shell or unknown kind
                                     hcx send --help prints this help, not hc's
  hcx spawn <muse|pi|claude|opencode|agy|qoder> [--name N] [--space S] [--folder DIR] [--task TEXT] [--json] [agent flags...]
                                     start the agent in a tab of its own (no parent terminal)
                                     opencode: --model provider/model [--variant LEVEL]
  hcx done [--self] [--json] <tab>...  kill each live terminal, then remove it
  hcx run [hc run args...]           run with --no-parent unless --parent or --no-parent is given

Tab names work anywhere hc takes a <terminal> (get attach read kill rm label keep keys
interrupt wait put send): a name, any case, becomes that tab's agent terminal (or its
first terminal). Twin names are refused; addresses and numeric names pass through.

Every other hc command is passed through unchanged, with its output, errors and exit
code: hcx ls --json, hcx read Vrax, hcx command...
hcx --version prints hcx's version, then hc's. hcx --version --json prints the
machine contract: {"hcx","hc","contract","capabilities"}.

  hcx spawn muse --yolo
  hcx spawn opencode --model provider/model --variant high
  hcx send Vrax "check this"
  hcx done Vrax
`;

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (command === "--version" || command === "-V") {
    if (args.includes("--json")) {
      console.log(JSON.stringify({ hcx: VERSION, hc: hcVersion(command), contract: CONTRACT_VERSION, capabilities: CAPABILITIES }));
      process.exit(0);
    }
    console.log(`hcx ${VERSION}`);
    process.exit(runHc([command]));
  } else if (command === "send") {
    process.exit(send(args));
  } else if (command === "spawn") {
    process.exit(spawn(args));
  } else if (command === "done") {
    process.exit(done(args));
  } else if (command === "run") {
    process.exit(runHc(["run", ...runArgs(args)]));
  } else {
    const tabs = needsTabLookup(command, args) ? loadTabs() : [];
    process.exit(runHc([command, ...resolveArgs(command, args, tabs)]));
  }
} catch (e) {
  process.exit(reportError(e, args));
}

/**
 * The hc version for the machine contract, parsed from `hc --version` ("hc X.Y.Z").
 * Throws when hc cannot answer, like the text `hcx --version` path.
 */
function hcVersion(flag: string): string {
  const p = spawnSync("hc", [flag], { encoding: "utf8", timeout: 5000 });
  if (p.error) throw p.error;
  if (p.status !== 0) {
    const detail = (p.stderr || "").trim();
    throw new HcxError(detail ? `hc ${flag} failed: ${detail}` : `hc ${flag} failed (exit ${p.status})`);
  }
  const raw = (p.stdout || "").trim();
  const withoutPrefix = raw.startsWith("hc ") ? raw.slice(3).trim() : raw;
  return withoutPrefix.split(/\s+/)[0] || "unknown";
}

/**
 * Prints hcx's own error and returns its exit code. With `--json` or a piped stderr
 * the error follows hc's `{"error":{"kind","message","hint"}}` shape on stderr;
 * otherwise it is the human `hcx: <message>` line.
 */
function reportError(e: unknown, args: string[]): number {
  const code = e instanceof HcxError ? e.exitCode : 1;
  if (e instanceof HcxError && (args.includes("--json") || !process.stderr.isTTY)) {
    const body: { error: { kind: string; message: string; hint?: string } } = {
      error: { kind: e.kind, message: e.message },
    };
    if (e.hint !== undefined) body.error.hint = e.hint;
    console.error(JSON.stringify(body));
    return code;
  }
  console.error(`hcx: ${e instanceof HcxError ? e.message : String(e)}`);
  return code;
}
