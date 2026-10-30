import { spawnSync } from "node:child_process";
import { agentOf, parseSpaces, parseTabs, type SpaceInfo, type TabInfo } from "./lib";

/** Shell kinds: a shell tab is a plain shell, never an agent. */
const SHELLS = new Set(["zsh", "sh", "bash", "fish", "dash", "ksh", "nu", "pwsh"]);

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

/**
 * The target's agent kind, seeing through the shell wrapper hc reports for tabs that
 * run an agent behind a login shell: a kind that is not a shell is used as is; a shell
 * kind becomes the foreground program `hc get <addr>` names (`opencode`, …) when that
 * is neither empty nor itself a shell. Any failure of `hc get` or unparseable JSON
 * keeps the shell kind, so a plain shell is never mistaken for an agent.
 */
export function effectiveKind(agents: Map<string, string>, address: string): string | null {
  const agent = agentOf(agents, address);
  if (agent === null) return null;
  if (!SHELLS.has(agent)) return agent;
  return foregroundName(address) ?? agent;
}

/** The basename (lower case) of the foreground program `hc get <addr>` reports; null when it says nothing. */
function foregroundName(address: string): string | null {
  try {
    const p = spawnSync("hc", ["get", address], { encoding: "utf8" });
    if (p.status !== 0) return null;
    const body = JSON.parse(p.stdout) as { foreground?: { name?: unknown } };
    const name = body.foreground?.name;
    if (typeof name !== "string") return null;
    const base = name.split("/").pop()?.toLowerCase() ?? "";
    return base === "" || SHELLS.has(base) ? null : base;
  } catch {
    return null; // hc get failed or its output is not JSON: the shell kind stands.
  }
}
