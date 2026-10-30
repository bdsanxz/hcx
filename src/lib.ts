// Pure helpers: tab lookup, target resolution, send/run arguments and the spawn plan.

export interface TabInfo {
  id: string;
  name: string;
  /** Every terminal address in the tab. */
  terminals: string[];
  /** Terminals whose program reports an agent (`app` set). */
  agents: string[];
}

/** Reads the JSON printed by `herdr-app ls`. */
export function parseTabs(ls: unknown): TabInfo[] {
  const spaces = (ls as { spaces?: unknown[] } | null)?.spaces ?? [];
  const tabs: TabInfo[] = [];
  for (const space of spaces as { tabs?: unknown[] }[]) {
    for (const tab of (space.tabs ?? []) as { id?: string; name: string; terminals?: { terminal: string; app?: string | null }[] }[]) {
      const terminals = tab.terminals ?? [];
      tabs.push({
        id: tab.id ?? "",
        name: tab.name,
        terminals: terminals.map((t) => t.terminal),
        agents: terminals.filter((t) => t.app).map((t) => t.terminal),
      });
    }
  }
  return tabs;
}

export interface SpaceInfo {
  id: string;
  name: string;
  /** Every terminal address in the space. */
  terminals: string[];
}

/** Reads the spaces out of the JSON printed by `herdr-app ls`. */
export function parseSpaces(ls: unknown): SpaceInfo[] {
  const spaces = (ls as { spaces?: unknown[] } | null)?.spaces ?? [];
  return (spaces as { id?: string; name?: string; tabs?: { terminals?: { terminal: string }[] }[] }[])
    .filter((s) => s.id)
    .map((s) => ({
      id: s.id!,
      name: s.name ?? "",
      terminals: (s.tabs ?? []).flatMap((t) => (t.terminals ?? []).map((x) => x.terminal)),
    }));
}

export class HcxError extends Error {}

/** A plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The space a spawned tab opens in: `--space` (an id or a name, any case) when given,
 * else the space of the calling terminal. Undefined when neither is known, so Herdr
 * falls back to its active space.
 */
export function pickSpace(wanted: string | undefined, caller: string | undefined, spaces: SpaceInfo[]): string | undefined {
  if (wanted) {
    const byId = spaces.find((s) => s.id === wanted);
    if (byId) return byId.id;
    const hits = spaces.filter((s) => s.name.toLowerCase() === wanted.toLowerCase());
    if (hits.length > 1) throw new HcxError(`space name "${wanted}" is ambiguous; use its id`);
    if (hits.length === 0) throw new HcxError(`no space "${wanted}"; known: ${spaces.map((s) => s.name).join(", ")}`);
    return hits[0].id;
  }
  return caller ? spaces.find((s) => s.terminals.includes(caller))?.id : undefined;
}

/** An address like `t7`, `t1b` or `machine/t7`; never a tab name. */
export function isAddress(s: string): boolean {
  return /^(?:[^/\s]+\/)?t[0-9][a-z0-9]*$/.test(s);
}

/** A tab name made only of digits is not resolved: it may be a terminal name. */
function isNumericName(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * A tab name (any case) becomes its agent terminal, else its first one. Addresses and
 * numeric names pass through unchanged.
 */
export function resolveTarget(target: string, tabs: TabInfo[]): string {
  if (isAddress(target) || isNumericName(target)) return target;
  const hits = tabs.filter((t) => t.name.toLowerCase() === target.toLowerCase());
  if (hits.length > 1) throw new HcxError(`tab name "${target}" is ambiguous; use an address like t7`);
  if (hits.length === 0) return target;
  const [address] = hits[0].agents.length ? hits[0].agents : hits[0].terminals;
  if (!address) throw new HcxError(`tab "${target}" has no terminal`);
  return address;
}

/** The sender's tab name, else its address, else null when unknown. */
export function senderName(me: string | undefined, tabs: TabInfo[]): string | null {
  if (!me) return null;
  return tabs.find((t) => t.terminals.includes(me))?.name ?? me;
}

export function withFooter(text: string, me: string | undefined, tabs: TabInfo[]): string {
  const name = senderName(me, tabs);
  return name ? `${text}\n\n— from ${name} · reply: hcx send ${name} "..."` : text;
}

/** Commands whose first positional argument is a `<terminal>`. */
export const TERMINAL_COMMANDS = new Set([
  "get",
  "attach",
  "read",
  "kill",
  "rm",
  "label",
  "keep",
  "keys",
  "interrupt",
  "wait",
  "put",
  "send",
]);

/** Options that take a value, so that value is not mistaken for the terminal. */
const VALUE_OPTIONS: Record<string, readonly string[]> = {
  attach: ["--history"],
  read: ["--lines"],
  interrupt: ["--timeout"],
  wait: ["--children", "--output", "--timeout"],
  send: ["--if", "--timeout"],
};

/** Index of the first positional argument, skipping options and their values, or -1. */
export function firstPositional(command: string, args: string[]): number {
  const takesValue = new Set(VALUE_OPTIONS[command] ?? []);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return i + 1 < args.length ? i + 1 : -1;
    if (arg.startsWith("-") && arg !== "-") {
      if (takesValue.has(arg)) i++;
      continue;
    }
    return i;
  }
  return -1;
}

/** Whether resolving this command's terminal needs `herdr-app ls`. */
export function needsTabLookup(command: string, args: string[]): boolean {
  if (!TERMINAL_COMMANDS.has(command)) return false;
  const i = firstPositional(command, args);
  if (i < 0) return false;
  return !isAddress(args[i]) && !isNumericName(args[i]);
}

/**
 * Replaces the first positional argument (the terminal) with the tab's address when it
 * matches a tab name. Everything else is left alone.
 */
export function resolveArgs(command: string, args: string[], tabs: TabInfo[]): string[] {
  if (!TERMINAL_COMMANDS.has(command)) return args;
  const i = firstPositional(command, args);
  if (i < 0) return args;
  const address = resolveTarget(args[i], tabs);
  if (address === args[i]) return args;
  return args.map((arg, index) => (index === i ? address : arg));
}

/** Adds `--no-parent` to `hc run` unless the user chose a parent (or none). */
export function runArgs(args: string[]): string[] {
  for (const arg of args) {
    if (arg === "--") break;
    if (arg === "--parent" || arg === "--no-parent" || arg.startsWith("--parent=")) return args;
  }
  return ["--no-parent", ...args];
}

export interface SendPlan {
  target: string;
  text: string;
  /** `hc send` options, kept before the target. */
  flags: string[];
  /** No sender footer and no `<hc from>` tag: the text goes exactly as given. */
  raw: boolean;
}

const SEND_BOOLEAN_FLAGS = new Set(["--wait", "--force", "--json"]);
const SEND_VALUE_FLAGS = new Set(["--if", "--timeout"]);
/** hcx's own send flags: they change the text, so hc never sees them. */
const SEND_RAW_FLAGS = new Set(["--no-footer", "--raw"]);

/**
 * `<hc send flags...> <tab-name|tNN> <text...>`. Flags are accepted before the target
 * and before the text; once the text starts, every remaining argument is text.
 * `--no-footer` (alias `--raw`) sends the text exactly as given.
 */
export function parseSend(args: string[]): SendPlan {
  const flags: string[] = [];
  let target: string | undefined;
  let raw = false;
  let i = 0;
  const usage = 'usage: hcx send [--wait] [--force] [--json] [--if idle|working] [--timeout SECONDS] [--no-footer] <tab-name|tNN> "text"';

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      i++;
      if (target === undefined) target = args[i++];
      break;
    }
    if (target === undefined) {
      if (arg === "-h" || arg === "--help") {
        flags.push(arg);
        i++;
        continue;
      }
      if (SEND_RAW_FLAGS.has(arg)) {
        raw = true;
        i++;
        continue;
      }
      if (SEND_BOOLEAN_FLAGS.has(arg)) {
        flags.push(arg);
        i++;
        continue;
      }
      if (SEND_VALUE_FLAGS.has(arg)) {
        const value = args[i + 1];
        if (value === undefined) throw new HcxError(`${arg} needs a value`);
        flags.push(arg, value);
        i += 2;
        continue;
      }
      if (arg.startsWith("--if=") || arg.startsWith("--timeout=")) {
        flags.push(arg);
        i++;
        continue;
      }
      target = arg;
      i++;
      continue;
    }
    if (SEND_RAW_FLAGS.has(arg)) {
      raw = true;
      i++;
      continue;
    }
    if (SEND_BOOLEAN_FLAGS.has(arg)) {
      flags.push(arg);
      i++;
      continue;
    }
    if (SEND_VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined) throw new HcxError(`${arg} needs a value`);
      flags.push(arg, value);
      i += 2;
      continue;
    }
    if (arg.startsWith("--if=") || arg.startsWith("--timeout=")) {
      flags.push(arg);
      i++;
      continue;
    }
    break;
  }

  if (!target) throw new HcxError(usage);
  const text = args.slice(i).join(" ");
  if (!text) throw new HcxError(usage);
  return { target, text, flags, raw };
}

/** How a message reached its target: `hcx` untagged, `hc` tagged, `hcx-raw` untagged as given. */
export type SendRoute = "hcx" | "hc" | "hcx-raw";

export interface DeliveryFields {
  /** True or false when the target confirmed; null when it reports no status. */
  delivered: boolean | null;
  route: SendRoute;
  /** The target's agent kind, from `hc ls`; null when it is not listed. */
  agent: string | null;
  /** Why delivery is unconfirmed. */
  note?: string;
}

/** The note for an opencode target that reports no status. */
export const OPENCODE_NOTE = "opencode reports no turn status";

/** The note for any other target that reports no status, so nobody can tell if it arrived. */
export const NO_STATUS_NOTE = "target is an opencode TUI or a shell; hc reports no turn status";

/**
 * Explicit delivery fields for an `hc send` result. `started` is null exactly when the
 * program reports no status, so `delivered` stays null there and a note explains it.
 */
export function deliveryFields(result: unknown, agent: string | null, route: SendRoute): DeliveryFields {
  const started = isRecord(result) ? result.started : undefined;
  const delivered = typeof started === "boolean" ? started : null;
  if (delivered !== null) return { delivered, route, agent };
  return { delivered, route, agent, note: agent === "opencode" ? OPENCODE_NOTE : NO_STATUS_NOTE };
}

/** The target's agent kind, from `hc ls`; null when it is not listed. */
export function agentOf(agents: Map<string, string>, address: string): string | null {
  return agents.get(address) ?? null;
}

/** Agents `hcx spawn` knows, and the command each one runs. */
export const AGENTS: Record<string, string> = { muse: "muse", pi: "pi", claude: "claude", opencode: "opencode" };

/** Spellings people type that the agent itself spells differently. */
const FLAG_ALIASES: Record<string, string> = { "--dangerously-skip-permission": "--dangerously-skip-permissions" };

export interface SpawnPlan {
  agent: string;
  argv: string[];
  name?: string;
  folder?: string;
  task?: string;
  space?: string;
  /** opencode only: the model to switch the new session to, `provider/model`. */
  model?: string;
  /** opencode only: the model variant, such as `high`. */
  variant?: string;
  /** Print one JSON object instead of the text line. */
  json?: boolean;
}

/**
 * `<agent> [--name N] [--folder DIR] [--task TEXT] [--space S] [--json] [agent flags...]`.
 * Only those are hcx's own; every other flag goes to the agent. For opencode, `--model`
 * and `--variant` are hcx's own too, because they choose the session's model.
 */
export function parseSpawn(args: string[]): SpawnPlan {
  const [agent, ...rest] = args;
  if (!agent) throw new HcxError(`usage: hcx spawn <${Object.keys(AGENTS).join("|")}> [agent flags...]`);
  const command = AGENTS[agent];
  if (!command) throw new HcxError(`unknown agent "${agent}"; known: ${Object.keys(AGENTS).join(", ")}`);
  const plan: SpawnPlan = { agent, argv: [command] };
  const value = (flag: string, i: number) => {
    const v = rest[i + 1];
    if (v === undefined) throw new HcxError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") { plan.argv.push(...rest.slice(i + 1)); break; }
    if (a === "--name") plan.name = value(a, i++);
    else if (a === "--folder" || a === "-C") plan.folder = value(a, i++);
    else if (a === "--task") plan.task = value(a, i++);
    else if (a === "--space") plan.space = value(a, i++);
    else if (a === "--json") plan.json = true;
    else if (agent === "opencode" && a === "--model") plan.model = value(a, i++);
    else if (agent === "opencode" && a === "--variant") plan.variant = value(a, i++);
    else plan.argv.push(FLAG_ALIASES[a] ?? a);
  }
  if (plan.variant && !plan.model) throw new HcxError("--variant needs --model");
  return plan;
}

/** `provider/model`, split at the first slash: model ids may contain one. */
export function parseModel(spec: string): { providerID: string; id: string } {
  const at = spec.indexOf("/");
  if (at <= 0 || at === spec.length - 1) {
    throw new HcxError(`--model needs provider/model, such as "provider/model"; got "${spec}"`);
  }
  return { providerID: spec.slice(0, at), id: spec.slice(at + 1) };
}

export interface ModelSpec {
  providerID: string;
  id: string;
  variant?: string;
}

export interface SessionModel {
  providerID: string;
  id: string;
  /** The session's variant, `default` when it reports none. */
  variant: string;
}

/** The model a `session.list` entry reports; null when the session is not in the list. */
export function sessionModel(listed: unknown, sessionID: string): SessionModel | null {
  const data = isRecord(listed) && Array.isArray(listed.data) ? listed.data : [];
  const entry = data.find((s) => isRecord(s) && s.id === sessionID);
  if (!isRecord(entry)) return null;
  const model = isRecord(entry.model) ? entry.model : {};
  return {
    providerID: typeof model.providerID === "string" ? model.providerID : "",
    id: typeof model.id === "string" ? model.id : "",
    variant: typeof model.variant === "string" ? model.variant : "default",
  };
}

/** Whether the session reports the model that was asked for, and the variant when one was asked for. */
export function sameModel(found: SessionModel, expected: ModelSpec): boolean {
  if (found.providerID !== expected.providerID || found.id !== expected.id) return false;
  return expected.variant === undefined || found.variant === expected.variant;
}

/** The verdict on a model from the `opencode api model.list` registry. */
export type ModelCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether the model registry holds `spec`: an entry whose `providerID` and `id` match,
 * `enabled !== false`, and — when a variant was asked for — that variant among the
 * entry's `variants[].id`. A variant's ids may be listed in the reason; nothing else
 * from the registry ever reaches it, so no provider data beyond the spec leaks.
 */
export function checkModel(list: unknown, spec: ModelSpec): ModelCheck {
  const asked = `${spec.providerID}/${spec.id}`;
  const data = isRecord(list) && Array.isArray(list.data) ? list.data : [];
  const entry = data.find((e) => isRecord(e) && e.providerID === spec.providerID && e.id === spec.id);
  if (!isRecord(entry)) {
    return { ok: false, reason: `unknown opencode model "${asked}"; run opencode and pick one with /models` };
  }
  if (entry.enabled === false) {
    return { ok: false, reason: `opencode model "${asked}" is disabled; run opencode and enable it first` };
  }
  const variants = (Array.isArray(entry.variants) ? entry.variants : [])
    .map((v) => (isRecord(v) && typeof v.id === "string" ? v.id : ""))
    .filter((id) => id !== "");
  if (spec.variant !== undefined && !variants.includes(spec.variant)) {
    return {
      ok: false,
      reason: `unknown variant "${spec.variant}" for ${asked}; available: ${variants.join(", ") || "none"}`,
    };
  }
  return { ok: true };
}

/** The tab already called `name` (any case), so spawn can refuse a duplicate before it opens anything. */
export function nameTaken(name: string, tabs: TabInfo[]): TabInfo | undefined {
  return tabs.find((t) => t.name.toLowerCase() === name.toLowerCase());
}
