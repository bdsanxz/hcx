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
  sendTimeoutMs,
  withFooter,
} from "./lib";
import { isTimeoutError, runHc, sendTimeoutError } from "./passthrough";

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

  const timeoutMs = sendTimeoutMs();
  const me = process.env.HC_TERMINAL_ID;
  // A raw send to an address needs neither a sender name nor resolution, so it
  // skips `herdr-app ls` entirely. Every other send loads Herdr when the sender
  // or a name-like target needs it.
  const skipHerdr = plan.raw && isAddress(plan.target);
  const herdr =
    skipHerdr || (!me && isAddress(plan.target))
      ? { ok: true as const, tabs: [], spaces: [] }
      : loadHerdr();
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

  // The kind is looked up BEFORE sending. Without --no-footer a plain shell is
  // refused (typing there would run the text and footer as shell commands); with
  // --agent-only a plain shell or an unknown kind is refused (also with
  // --no-footer). If the kind lookup fails, behave as today, except --agent-only
  // refuses the unknown kind. The same lookup feeds the delivery fields.
  let kind: string | null = null;
  let program: string | null = null;
  if (plan.agentOnly) {
    const found = effectiveKindAndProgram(loadAgents(), address);
    kind = found.kind;
    program = found.program;
    if (kind && isShellKind(kind)) {
      throw new HcxError(`tab "${plan.target}" is a plain shell; refusing --agent-only send`, { kind: "plain_shell" });
    }
    if (!kind) {
      throw new HcxError(`tab "${plan.target}" is not a known agent; refusing --agent-only send`, {
        kind: "plain_shell",
      });
    }
  } else if (!plan.raw) {
    const found = effectiveKindAndProgram(loadAgents(), address);
    kind = found.kind;
    program = found.program;
    if (kind && isShellKind(kind)) {
      throw new HcxError(`tab "${plan.target}" is a plain shell; use --no-footer to type a command`, {
        kind: "plain_shell",
      });
    }
  }

  const text = plan.raw ? plan.text : withFooter(plan.text, me, tabs);
  // Without HC_TERMINAL_ID the core has no caller, so it adds no <hc from> tag.
  const { HC_TERMINAL_ID: _caller, ...env } = process.env;
  // `--` keeps a text starting with `-` out of hc's flags.
  const invocation = ["send", ...plan.flags, "--", address, text];

  // hc prints JSON with --json, and by default when its stdout is piped. Only then can
  // the delivery fields join the result; in a terminal the human line stays hc's own.
  // The send itself is killed after the send timeout (--timeout stays hc's own wait
  // timeout and is passed through). A killed send may still have landed: never retry.
  if (!plan.flags.includes("--json") && process.stdout.isTTY) {
    return runHc(invocation, env, timeoutMs);
  }

  const flags = plan.flags.includes("--json") ? plan.flags : [...plan.flags, "--json"];
  const p = spawnSync("hc", ["send", ...flags, "--", address, text], { env, encoding: "utf8", timeout: timeoutMs });
  if (p.error) {
    if (isTimeoutError(p.error)) throw sendTimeoutError(timeoutMs);
    throw p.error;
  }
  if (p.stderr) process.stderr.write(p.stderr);
  const result = parseSendResult(p.stdout);
  if (p.status !== 0 || !result) {
    // An error, or output that is not a send result: hc's own bytes and exit code.
    if (p.stdout) process.stdout.write(p.stdout);
    return p.status ?? 1;
  }
  const route = plan.raw ? "hcx-raw" : "hcx";
  if (plan.raw && !plan.agentOnly) {
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
