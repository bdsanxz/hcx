import { spawnSync } from "node:child_process";
import {
  agentOf,
  isShellKind,
  parseSpaces,
  parseTabs,
  type SpaceInfo,
  type TabInfo,
} from "./lib";

/** One `herdr-app ls` read, parsed into tabs and spaces. */
export interface HerdrListings {
  tabs: TabInfo[];
  spaces: SpaceInfo[];
}

/** The result of a Herdr lookup: listings, or why it could not run. */
export type HerdrResult = { ok: true; tabs: TabInfo[]; spaces: SpaceInfo[] } | { ok: false; error: string };

/**
 * The single `herdr-app ls` read every lookup shares. Lookups get a 5 s timeout;
 * a hung `herdr-app ls` must not hang name resolution. Callers that protect against
 * mistakes (--name twin check, --space list, footer sender) refuse when this fails
 * instead of silently skipping the check.
 */
export function loadHerdr(): HerdrResult {
  try {
    const p = spawnSync("herdr-app", ["ls"], { encoding: "utf8", timeout: 5000 });
    if (p.error) return { ok: false, error: `herdr-app not found: ${(p.error as Error).message}` };
    if (p.status !== 0) {
      const detail = (p.stderr || "").trim();
      return { ok: false, error: detail ? `herdr-app ls failed: ${detail}` : `herdr-app ls failed (exit ${p.status})` };
    }
    try {
      const parsed = JSON.parse(p.stdout) as unknown;
      return { ok: true, tabs: parseTabs(parsed), spaces: parseSpaces(parsed) };
    } catch {
      return { ok: false, error: "herdr-app ls printed no JSON" };
    }
  } catch (e) {
    return { ok: false, error: `herdr-app ls failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function loadTabs(): TabInfo[] {
  const r = loadHerdr();
  return r.ok ? r.tabs : []; // no Herdr app: plain addresses still work
}

export function loadSpaces(): SpaceInfo[] {
  const r = loadHerdr();
  return r.ok ? r.spaces : [];
}

/**
 * Terminal address (and terminal name) → agent kind, from `hc ls --json`; empty when
 * hc cannot answer. Terminals started with `hc run --name` are reached by name, so
 * the map is keyed by address and by name (exact and lower case).
 */
export function loadAgents(): Map<string, string> {
  try {
    const p = spawnSync("hc", ["ls", "--json"], { encoding: "utf8", timeout: 5000 });
    if (p.error || p.status !== 0) return new Map();
    const list = JSON.parse(p.stdout) as {
      terminals?: { address?: unknown; agent?: unknown; name?: unknown; title?: unknown }[];
    };
    const agents = new Map<string, string>();
    for (const t of list.terminals ?? []) {
      if (typeof t.address !== "string" || typeof t.agent !== "string") continue;
      agents.set(t.address, t.agent);
      agents.set(t.address.toLowerCase(), t.agent);
      for (const label of [t.name, t.title]) {
        if (typeof label === "string" && label) {
          agents.set(label, t.agent);
          agents.set(label.toLowerCase(), t.agent);
        }
      }
    }
    return agents;
  } catch {
    return new Map();
  }
}

/**
 * Agents hcx recognises in the foreground of a shell wrapper: a shell kind becomes
 * the foreground program only when it names one of these. Anything else the shell
 * runs stays a shell tab and is reported as the foreground program instead.
 */
const KNOWN_FOREGROUND_AGENTS = new Set(["opencode"]);

/** The target's kind and, when the kind stays a shell, its foreground program. */
export interface KindAndProgram {
  kind: string | null;
  program: string | null;
}

/**
 * The target's agent kind, seeing through the shell wrapper hc reports for tabs that
 * run an agent behind a login shell: a kind that is not a shell is used as is; a shell
 * kind becomes the foreground program only when it names a known agent (`opencode`).
 * Any failure of `hc get` or unparseable JSON keeps the shell kind, so a plain shell
 * is never mistaken for an agent.
 */
export function effectiveKindAndProgram(agents: Map<string, string>, address: string): KindAndProgram {
  const agent = agentOf(agents, address);
  if (agent === null) return { kind: null, program: null };
  if (!isShellKind(agent)) return { kind: agent, program: null };
  const foreground = foregroundName(address);
  if (foreground && KNOWN_FOREGROUND_AGENTS.has(foreground)) return { kind: foreground, program: null };
  return { kind: agent, program: foreground };
}

/**
 * The target's agent kind, seeing through the shell wrapper hc reports for tabs that
 * run an agent behind a login shell. See `effectiveKindAndProgram`.
 */
export function effectiveKind(agents: Map<string, string>, address: string): string | null {
  return effectiveKindAndProgram(agents, address).kind;
}

/** The basename (lower case) of the foreground program `hc get <addr>` reports; null when it says nothing. */
function foregroundName(address: string): string | null {
  try {
    const p = spawnSync("hc", ["get", address], { encoding: "utf8", timeout: 5000 });
    if (p.error || p.status !== 0) return null;
    const body = JSON.parse(p.stdout) as { foreground?: { name?: unknown } };
    const name = body.foreground?.name;
    if (typeof name !== "string") return null;
    const base = name.split("/").pop()?.toLowerCase() ?? "";
    return base === "" || isShellKind(base) ? null : base;
  } catch {
    return null; // hc get failed or its output is not JSON: the shell kind stands.
  }
}
