import { spawnSync } from "node:child_process";
import { effectiveKind, loadAgents, loadTabs } from "./herdr";
import { deliveryFields, isAddress, isRecord, parseSend, resolveTarget, withFooter } from "./lib";
import { runHc } from "./passthrough";

export function send(args: string[]): number {
  // `hcx send --help` is hc's own help, not a message.
  if (args[0] === "--help" || args[0] === "-h") return runHc(["send", ...args]);

  const plan = parseSend(args);
  const me = process.env.HC_TERMINAL_ID;
  const tabs = me || !isAddress(plan.target) ? loadTabs() : [];
  const address = resolveTarget(plan.target, tabs);
  const text = plan.raw ? plan.text : withFooter(plan.text, me, tabs);
  // Without HC_TERMINAL_ID the core has no caller, so it adds no <hc from> tag.
  const { HC_TERMINAL_ID: _caller, ...env } = process.env;

  // hc prints JSON with --json, and by default when its stdout is piped. Only then can
  // the delivery fields join the result; in a terminal the human line stays hc's own.
  if (!plan.flags.includes("--json") && process.stdout.isTTY) {
    return runHc(["send", ...plan.flags, address, text], env);
  }

  const flags = plan.flags.includes("--json") ? plan.flags : [...plan.flags, "--json"];
  const p = spawnSync("hc", ["send", ...flags, address, text], { env, encoding: "utf8" });
  if (p.error) throw p.error;
  if (p.stderr) process.stderr.write(p.stderr);
  const result = parseSendResult(p.stdout);
  if (p.status !== 0 || !result) {
    // An error, or output that is not a send result: hc's own bytes and exit code.
    if (p.stdout) process.stdout.write(p.stdout);
    return p.status ?? 1;
  }
  const route = plan.raw ? "hcx-raw" : "hcx";
  const fields = deliveryFields(result, effectiveKind(loadAgents(), address), route);
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
