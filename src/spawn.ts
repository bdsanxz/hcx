import { spawnSync } from "node:child_process";
import { loadHerdr, loadTabs } from "./herdr";
import { HcxError, nameTaken, parseSpawn, pickSpace, SPAWN_HELP } from "./lib";
import { prepareOpencodeSession } from "./opencode";

/** Opens the agent in a tab of its own (`herdr-app do tab.new`), so it has no parent terminal. */
export function spawn(args: string[]): number {
  // `hcx spawn --help` is hcx's own help. (`spawn muse --help` still goes to the agent.)
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(SPAWN_HELP);
    return 0;
  }
  const plan = parseSpawn(args);
  // One Herdr read for the name check, the space lookup and the auto-name poll below.
  const herdr = loadHerdr();
  if (!herdr.ok) {
    if (plan.name) throw new HcxError(`could not check --name "${plan.name}": ${herdr.error}`);
    if (plan.space) throw new HcxError(`could not list spaces for --space "${plan.space}": ${herdr.error}`);
  }
  const tabs = herdr.ok ? herdr.tabs : [];
  const spaces = herdr.ok ? herdr.spaces : [];
  // Tab names are how agents address each other, so a name never repeats: check before opening anything.
  if (plan.name) {
    const taken = nameTaken(plan.name, tabs);
    if (taken)
      throw new HcxError(
        `tab name "${plan.name}" is already used by ${taken.terminals[0] ?? "another tab"}; pick another --name`,
        { kind: "usage" },
      );
  }
  const folder = plan.folder ?? process.cwd();
  // Without --space the tab lands in the space of whoever runs hcx, not in whichever space is active.
  // Validated BEFORE any session or tab exists, so a typo refuses before anything opens.
  const space = pickSpace(plan.space, process.env.HC_TERMINAL_ID, spaces);
  // OpenCode chooses the model before the tab opens, through its background service:
  // create the session, switch it, verify it, then start the TUI on that session.
  let session: string | undefined;
  if (plan.agent === "opencode" && plan.model) {
    session = prepareOpencodeSession(folder, plan.name, plan.model, plan.variant);
    plan.argv = ["opencode", "--session", session, ...plan.argv.slice(1)];
  }
  const doArgs = ["do", "tab.new", "--argv", JSON.stringify(plan.argv), "--folder", folder];
  if (space) doArgs.push("--space", space);
  if (plan.name) doArgs.push("--name", plan.name);
  if (plan.task) doArgs.push("--task", plan.task);

  const p = spawnSync("herdr-app", doArgs, { encoding: "utf8" });
  if (p.error) throw new HcxError(`herdr-app not found: ${(p.error as Error).message}`);
  const sessionNote = session ? ` (opencode session ${session})` : "";
  let made: { tab?: string; terminal?: string; error?: string };
  try {
    made = JSON.parse(p.stdout);
  } catch {
    throw new HcxError(`herdr-app failed: ${(p.stderr || p.stdout).trim() || `exit ${p.status}`}${sessionNote}`);
  }
  if (p.status !== 0 || made.error || !made.terminal)
    throw new HcxError(`${made.error ?? "herdr-app made no terminal"}${sessionNote}`);

  // An auto-naming mod may rename the tab a moment later: wait briefly for a real name.
  let name = plan.name ?? "";
  for (let i = 0; i < 8 && !name; i++) {
    const tab = loadTabs().find((t) => t.id === made.tab);
    if (tab && !/^\d+$/.test(tab.name)) name = tab.name;
    else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  if (plan.json) {
    console.log(
      JSON.stringify({
        name: name || made.terminal,
        terminal: made.terminal,
        agent: plan.agent,
        space: space ?? null,
        folder,
        ...(plan.model ? { model: plan.model } : {}),
        ...(plan.variant ? { variant: plan.variant } : {}),
        ...(made.tab ? { tab: made.tab } : {}),
        ...(session ? { session } : {}),
      }),
    );
  } else {
    console.log(`spawned ${name || made.terminal} (${made.terminal}, ${plan.agent}) · message it: hcx send ${name || made.terminal} "..."`);
  }
  return 0;
}
