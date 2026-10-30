import { spawnSync } from "node:child_process";
import { loadTabs } from "./herdr";
import { HcxError, nameTaken, parseSpawn } from "./lib";

/** Opens the agent in a tab of its own (`herdr-app do tab.new`), so it has no parent terminal. */
export function spawn(args: string[]): number {
  const plan = parseSpawn(args);
  // Tab names are how agents address each other, so a name never repeats: check before opening anything.
  if (plan.name) {
    const taken = nameTaken(plan.name, loadTabs());
    if (taken) throw new HcxError(`tab name "${plan.name}" is already used by ${taken.terminals[0] ?? "another tab"}; pick another --name`);
  }
  const doArgs = ["do", "tab.new", "--argv", JSON.stringify(plan.argv), "--folder", plan.folder ?? process.cwd()];
  if (plan.name) doArgs.push("--name", plan.name);
  if (plan.task) doArgs.push("--task", plan.task);

  const p = spawnSync("herdr-app", doArgs, { encoding: "utf8" });
  let made: { tab?: string; terminal?: string; error?: string };
  try {
    made = JSON.parse(p.stdout);
  } catch {
    throw new HcxError(`herdr-app failed: ${(p.stderr || p.stdout).trim() || `exit ${p.status}`}`);
  }
  if (p.status !== 0 || made.error || !made.terminal) throw new HcxError(made.error ?? "herdr-app made no terminal");

  // An auto-naming mod may rename the tab a moment later: wait briefly for a real name.
  let name = plan.name ?? "";
  for (let i = 0; i < 8 && !name; i++) {
    const tab = loadTabs().find((t) => t.id === made.tab);
    if (tab && !/^\d+$/.test(tab.name)) name = tab.name;
    else spawnSync("sleep", ["0.4"]);
  }
  console.log(`spawned ${name || made.terminal} (${made.terminal}, ${plan.agent}) · message it: hcx send ${name || made.terminal} "..."`);
  return 0;
}
