import { spawnSync } from "node:child_process";
import { effectiveKindAndProgram, loadAgents, loadHerdr } from "./herdr";
import {
  deliveryFields,
  HcxError,
  isAddress,
  isRecord,
  isShellKind,
  parseSend,
  resolveTarget,
  SEND_HELP,
  withFooter,
} from "./lib";
import { runHc } from "./passthrough";

export function send(args: string[]): number {
  // `hcx send --help` is hcx's own help (hc's omits --no-footer and the footer).
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(SEND_HELP);
    return 0;
  }

  const plan = parseSend(args);
  // `hcx send Vrax --help` is help too; after an explicit `--` the text is literal.
  if (!args.includes("--") && (plan.text === "--help" || plan.text === "-h")) {
    console.log(SEND_HELP);
    return 0;
  }

  const me = process.env.HC_TERMINAL_ID;
  const herdr = me || !isAddress(plan.target) ? loadHerdr() : { ok: true as const, tabs: [], spaces: [] };
  if (!herdr.ok) {
    if (!plan.raw && me) {
      throw new HcxError(
        `could not look up Herdr tabs (${herdr.error}); refusing to send with a footer — pass --no-footer or fix herdr-app`,
      );
    }
    // No footer and a non-name target: hc itself reports an unknown target.
  }
  const tabs = herdr.ok ? herdr.tabs : [];
  const address = resolveTarget(plan.target, tabs);

  // Without --no-footer a plain shell is refused BEFORE sending: typing there would
  // run the text and the footer as shell commands. If the kind lookup fails, behave
  // as today. The same lookup feeds the delivery fields, so no extra subprocess.
  let kind: string | null = null;
  let program: string | null = null;
  if (!plan.raw) {
    const found = effectiveKindAndProgram(loadAgents(), address);
    kind = found.kind;
    program = found.program;
    if (kind && isShellKind(kind)) {
      throw new HcxError(`tab "${plan.target}" is a plain shell; use --no-footer to type a command`, { kind: "usage" });
    }
  }

  const text = plan.raw ? plan.text : withFooter(plan.text, me, tabs);
  // Without HC_TERMINAL_ID the core has no caller, so it adds no <hc from> tag.
  const { HC_TERMINAL_ID: _caller, ...env } = process.env;
  // `--` keeps a text starting with `-` out of hc's flags.
  const invocation = ["send", ...plan.flags, "--", address, text];

  // hc prints JSON with --json, and by default when its stdout is piped. Only then can
  // the delivery fields join the result; in a terminal the human line stays hc's own.
  if (!plan.flags.includes("--json") && process.stdout.isTTY) {
    return runHc(invocation, env);
  }

  const flags = plan.flags.includes("--json") ? plan.flags : [...plan.flags, "--json"];
  const p = spawnSync("hc", ["send", ...flags, "--", address, text], { env, encoding: "utf8" });
  if (p.error) throw p.error;
  if (p.stderr) process.stderr.write(p.stderr);
  const result = parseSendResult(p.stdout);
  if (p.status !== 0 || !result) {
    // An error, or output that is not a send result: hc's own bytes and exit code.
    if (p.stdout) process.stdout.write(p.stdout);
    return p.status ?? 1;
  }
  const route = plan.raw ? "hcx-raw" : "hcx";
  if (plan.raw) {
    // Nothing changed for --no-footer: the kind is still looked up once for the fields.
    const found = effectiveKindAndProgram(loadAgents(), address);
    kind = found.kind;
    program = found.program;
  }
  const fields = deliveryFields(result, kind, route, program);
  console.log(JSON.stringify({ ...result, ...fields }));
  return 0;
}

/** hc's send result is the only object with a turn count; anything else is passed on. */
function parseSendResult(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) && typeof value.turn === "number" ? value : null;
  } catch {
    return null;
  }
}
