import { spawnSync } from "node:child_process";
import { parseSpaces, parseTabs, type SpaceInfo, type TabInfo } from "./lib";

export function loadTabs(): TabInfo[] {
  try {
    const p = spawnSync("herdr-app", ["ls"], { encoding: "utf8" });
    return p.status === 0 ? parseTabs(JSON.parse(p.stdout)) : [];
  } catch {
    return []; // no Herdr app: plain addresses still work
  }
}

export function loadSpaces(): SpaceInfo[] {
  try {
    const p = spawnSync("herdr-app", ["ls"], { encoding: "utf8" });
    return p.status === 0 ? parseSpaces(JSON.parse(p.stdout)) : [];
  } catch {
    return [];
  }
}

/** Terminal address → agent kind, from `hc ls --json`; empty when hc cannot answer. */
export function loadAgents(): Map<string, string> {
  try {
    const p = spawnSync("hc", ["ls", "--json"], { encoding: "utf8" });
    if (p.status !== 0) return new Map();
    const list = JSON.parse(p.stdout) as { terminals?: { address?: unknown; agent?: unknown }[] };
    const agents = new Map<string, string>();
    for (const t of list.terminals ?? []) {
      if (typeof t.address === "string" && typeof t.agent === "string") agents.set(t.address, t.agent);
    }
    return agents;
  } catch {
    return new Map();
  }
}
