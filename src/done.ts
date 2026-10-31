// `hcx done <tab>...`: kill each live terminal, then remove it.

import { spawnSync } from "node:child_process";
import { loadTabs } from "./herdr";
import { HcxError, resolveTarget } from "./lib";

export const DONE_USAGE = "usage: hcx done [--self] [--json] <tab>...";

const DONE_HELP = `${DONE_USAGE}

Kill each named terminal's program, then remove the terminal. One line per tab
(done Mira (t5)). A tab whose program already finished is still removed; an unknown
tab is reported on stderr and the other tabs still go. Exits 1 when any tab failed.

--self allows ending your own terminal (the one HC_TERMINAL_ID names); without it a
target that equals HC_TERMINAL_ID is refused. --json prints one JSON array with one
object per tab: {"target","terminal","removed","error"?}.`;

interface DoneOptions {
  self: boolean;
  json: boolean;
  targets: string[];
}

/** Split hcx's own `done` flags from the targets; any other flag is refused. */
export function parseDone(args: string[]): DoneOptions {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(DONE_HELP);
    process.exit(0);
  }
  const options: DoneOptions = { self: false, json: false, targets: [] };
  for (const arg of args) {
    if (arg === "--self") options.self = true;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("-")) throw new HcxError(`unknown flag "${arg}"; ${DONE_USAGE}`, { kind: "usage" });
    else options.targets.push(arg);
  }
  if (!options.targets.length) throw new HcxError(DONE_USAGE, { kind: "usage" });
  return options;
}

/**
 * Kills each named terminal's program, then removes the terminal. The `hc kill`
 * result is checked and reported; a program that already finished is still fine, so
 * only the removal decides success. Unknown tabs are reported and the others still
 * go. A target that equals the caller's own terminal (HC_TERMINAL_ID) is refused
 * unless --self is given.
 */
export function done(targets: string[]): number {
  const options = parseDone(targets);
  const me = process.env.HC_TERMINAL_ID;
  const tabs = loadTabs();
  let failed = false;
  const results: { target: string; terminal: string | null; removed: boolean; error?: string }[] = [];
  for (const target of options.targets) {
    let address: string;
    try {
      address = resolveTarget(target, tabs);
    } catch (e) {
      const message = e instanceof HcxError ? e.message : String(e);
      if (!options.json) console.error(`hcx done: ${target}: ${message}`);
      else results.push({ target, terminal: null, removed: false, error: message });
      failed = true;
      continue;
    }
    if (me && address === me && !options.self) {
      const message = `refusing to end your own terminal "${target}"; pass --self to confirm`;
      if (!options.json) console.error(`hcx done: ${target}: ${message}`);
      else results.push({ target, terminal: address, removed: false, error: message });
      failed = true;
      continue;
    }
    const killed = spawnSync("hc", ["kill", address], { encoding: "utf8" });
    if (killed.error) throw killed.error;
    let error: string | undefined;
    if (killed.status !== 0 && !alreadyFinished(reason(killed))) error = reason(killed);
    const removed = spawnSync("hc", ["rm", address], { encoding: "utf8" });
    if (removed.error) throw removed.error;
    if (removed.status !== 0) error = reason(removed);
    const gone = removed.status === 0;
    if (error) {
      if (!options.json) console.error(`hcx done: ${target}: ${error}`);
      else results.push({ target, terminal: address, removed: gone, error });
      failed = true;
      continue;
    }
    if (options.json) results.push({ target, terminal: address, removed: true });
    else console.log(address === target ? `done ${target}` : `done ${target} (${address})`);
  }
  if (options.json) console.log(JSON.stringify(results));
  return failed ? 1 : 0;
}

/** Whether the `hc kill` failure just means the program already finished. */
function alreadyFinished(message: string): boolean {
  return /already finished|not running|no such process/i.test(message);
}

/** hc's error message (JSON when piped), else whatever it printed. */
function reason(p: { stdout?: string | null; stderr?: string | null; status?: number | null }): string {
  const text = (p.stderr || p.stdout || "").trim();
  try {
    const body = JSON.parse(text) as { error?: { message?: string; hint?: string } };
    const message = body.error?.message;
    if (message) return body.error?.hint ? `${message} (${body.error.hint})` : message;
  } catch {
    // Not JSON: the text is the message.
  }
  return text || `hc rm failed (exit ${p.status ?? "?"})`;
}
