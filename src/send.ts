import { loadTabs } from "./herdr";
import { isAddress, parseSend, resolveTarget, withFooter } from "./lib";
import { runHc } from "./passthrough";

export function send(args: string[]): number {
  // `hcx send --help` is hc's own help, not a message.
  if (args[0] === "--help" || args[0] === "-h") return runHc(["send", ...args]);

  const plan = parseSend(args);
  const me = process.env.HC_TERMINAL_ID;
  const tabs = me || !isAddress(plan.target) ? loadTabs() : [];
  const address = resolveTarget(plan.target, tabs);
  const text = withFooter(plan.text, me, tabs);
  // Without HC_TERMINAL_ID the core has no caller, so it adds no <hc from> tag.
  const { HC_TERMINAL_ID: _caller, ...env } = process.env;
  return runHc(["send", ...plan.flags, address, text], env);
}
