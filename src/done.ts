// `hcx done <tab>...`: kill each live terminal, then remove it.

import { spawnSync } from "node:child_process";
import { loadTabs } from "./herdr";
import { HcxError, resolveTarget } from "./lib";

/**
 * Kills each named terminal's program, then removes the terminal. `hc kill` ends a
 * live program and is a no-op on one that already finished, so only the removal
 * decides success. Unknown tabs are reported and the others still go.
 */
export function done(targets: string[]): number {
  if (!targets.length) throw new HcxError("usage: hcx done <tab>...");
  const tabs = loadTabs();
  let failed = false;
  for (const target of targets) {
    let address: string;
    try {
      address = resolveTarget(target, tabs);
    } catch (e) {
      console.error(`hcx done: ${target}: ${e instanceof HcxError ? e.message : String(e)}`);
      failed = true;
      continue;
    }
    spawnSync("hc", ["kill", address], { encoding: "utf8" });
    const removed = spawnSync("hc", ["rm", address], { encoding: "utf8" });
    if (removed.error) throw removed.error;
    if (removed.status !== 0) {
      console.error(`hcx done: ${target}: ${reason(removed)}`);
      failed = true;
      continue;
    }
    console.log(address === target ? `done ${target}` : `done ${target} (${address})`);
  }
  return failed ? 1 : 0;
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
