// Pure helpers: tab lookup, target resolution, send/run arguments and the spawn plan.
import { readFileSync as readAgentsFile } from "node:fs";
import { homedir as osHomedir } from "node:os";

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

/**
 * hcx's own error. `kind` follows hc's `{"error":{"kind","message","hint"}}` shape
 * (`ambiguous`, `usage`, `not_found`, `plain_shell`, `timeout`; anything else is
 * `error`) and `exitCode` follows hc's convention: 2 for usage, 3 for not_found,
 * 4 for plain_shell, 1 otherwise. `plain_shell` and the exit codes are stable:
 * callers use them to tell a shell/agent refusal apart from bad flags.
 */
export type HcxErrorKind = "ambiguous" | "usage" | "not_found" | "plain_shell" | "timeout" | "error";

export class HcxError extends Error {
  kind: HcxErrorKind;
  exitCode: number;
  hint?: string;
  constructor(message: string, opts?: { kind?: HcxErrorKind; exitCode?: number; hint?: string }) {
    super(message);
    this.name = "HcxError";
    this.kind = opts?.kind ?? "error";
    this.exitCode =
      opts?.exitCode ?? (this.kind === "usage" ? 2 : this.kind === "not_found" ? 3 : this.kind === "plain_shell" ? 4 : 1);
    if (opts?.hint !== undefined) this.hint = opts.hint;
  }
}

/** Machine contract version for `hcx --version --json` and the `send --json` fields. */
export const CONTRACT_VERSION = 1;

/** Stable capability names advertised by `hcx --version --json`. */
export const CAPABILITIES: string[] = ["no-footer", "agent-only", "json-delivery"];

/**
 * How long the `hc send` subprocess may run before it is killed. `--timeout`
 * still means hc's own wait timeout and is passed through; this is a separate
 * client-side guard. Overridable with HCX_SEND_TIMEOUT_MS for tests.
 */
export const SEND_TIMEOUT_MS = 30000;

/** Resolve the effective `hc send` timeout, honouring the HCX_SEND_TIMEOUT_MS test hook. */
export function sendTimeoutMs(): number {
  const raw = process.env.HCX_SEND_TIMEOUT_MS;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return SEND_TIMEOUT_MS;
}

/** Human duration for timeout messages: "30 s", or "50 ms" below a second. */
export function formatTimeout(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;
}

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
    if (hits.length > 1) throw new HcxError(`space name "${wanted}" is ambiguous; use its id`, { kind: "ambiguous" });
    if (hits.length === 0)
      throw new HcxError(`no space "${wanted}"; known: ${spaces.map((s) => s.name).join(", ")}`, { kind: "not_found" });
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
  if (hits.length > 1) throw new HcxError(`tab name "${target}" is ambiguous; use an address like t7`, { kind: "ambiguous" });
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

/**
 * What the footer's reply command should target: the sender's tab name, but only when
 * that name resolves uniquely back to the sender's address. Otherwise the address,
 * which always resolves. A name with whitespace, an address-like or numeric name, or
 * a twin name would give a reply that reaches the wrong place or none at all.
 */
export function replyTarget(me: string, tabs: TabInfo[]): string {
  const tab = tabs.find((t) => t.terminals.includes(me));
  const name = tab?.name;
  if (name && !/\s/.test(name) && !isAddress(name) && !/^\d+$/.test(name)) {
    try {
      if (resolveTarget(name, tabs) === me) return name;
    } catch {
      // Ambiguous or terminal-less: fall through to the address.
    }
  }
  return me;
}

export function withFooter(text: string, me: string | undefined, tabs: TabInfo[]): string {
  if (!me) return text;
  const target = replyTarget(me, tabs);
  const name = tabs.find((t) => t.terminals.includes(me))?.name ?? me;
  return `${text}\n\n— from ${name} · reply: hcx send ${target} "..."`;
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
  /** Refuse plain shells and unknown kinds before anything is sent. */
  agentOnly: boolean;
}

const SEND_BOOLEAN_FLAGS = new Set(["--wait", "--force", "--json"]);
const SEND_VALUE_FLAGS = new Set(["--if", "--timeout"]);
/** hcx's own send flags: they change the text, so hc never sees them. */
const SEND_RAW_FLAGS = new Set(["--no-footer", "--raw"]);

export const SEND_USAGE =
  'usage: hcx send [--wait] [--force] [--json] [--if idle|working] [--timeout SECONDS] [--no-footer] [--agent-only] <tab-name|tNN> "text"';

/** hcx's own help for `send`, printed for `hcx send --help` and `hcx send <tab> --help`. */
export const SEND_HELP = `${SEND_USAGE}

Send a message to another terminal without the <hc from> tag, by tab name, with a
footer that names the sender. Without --json it prints one text line
(sent to Vrax (t10, claude-code): delivered, status idle, turn 4); with --json
it prints the result object with the delivery fields. hc flags go before the target or before the text:
--wait, --force, --json, --if <status>, --timeout <seconds>. --timeout is hc's own
wait timeout and is passed through; the hc send call itself is killed after 30 s
(a {"error":{"kind":"timeout"}} error: the message may have landed, never retry).

--no-footer (alias --raw) sends the text exactly as given: no footer and no tag.
It works for every target, including a plain shell or an opencode TUI, and combines
with the other flags: hcx send --no-footer --if idle Vrax "echo hi".
A raw send to a terminal address (t7) skips herdr-app ls: no sender name or
resolution is needed.

--agent-only looks the target kind up first (also with --no-footer) and refuses a
plain shell or an unknown kind before anything is sent. It combines with --json,
--if and --wait. The refusal is kind "plain_shell" (exit 4), stable for callers.

Without --no-footer the footer "— from <tab> · reply: hcx send <tab> ..." is added
when HC_TERMINAL_ID is set, and a plain shell is refused (kind "plain_shell",
exit 4): sending there would type the text and the footer as shell commands.
Use -- if the message itself starts with a flag: hcx send Vrax -- "--wait".`;

/**
 * `<hc send flags...> <tab-name|tNN> <text...>`. Flags are accepted before the target
 * and before the text; once the text starts, every remaining argument is text.
 * `--no-footer` (alias `--raw`) sends the text exactly as given; `--agent-only`
 * refuses shells and unknown kinds before sending. Both are hcx's own, never hc's.
 * `-h`/`--help` are not parsed here: `send` intercepts them (a text starting with
 * `--` still works after an explicit `--`).
 */
export function parseSend(args: string[]): SendPlan {
  const flags: string[] = [];
  let target: string | undefined;
  let raw = false;
  let agentOnly = false;
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      i++;
      if (target === undefined) target = args[i++];
      break;
    }
    if (SEND_RAW_FLAGS.has(arg)) {
      raw = true;
      i++;
      continue;
    }
    if (arg === "--agent-only") {
      agentOnly = true;
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
      if (value === undefined || value.startsWith("-")) throw new HcxError(`${arg} needs a value`, { kind: "usage" });
      flags.push(arg, value);
      i += 2;
      continue;
    }
    if (arg.startsWith("--if=") || arg.startsWith("--timeout=")) {
      flags.push(arg);
      i++;
      continue;
    }
    if (target === undefined) {
      target = arg;
      i++;
      continue;
    }
    break;
  }

  if (!target) throw new HcxError(SEND_USAGE, { kind: "usage" });
  const text = args.slice(i).join(" ");
  if (!text) throw new HcxError(SEND_USAGE, { kind: "usage" });
  return { target, text, flags, raw, agentOnly };
}

/** How a message reached its target: `hcx` untagged, `hcx-raw` untagged as given. */
export type SendRoute = "hcx" | "hcx-raw";

export interface DeliveryFields {
  /** True or false when the target confirmed; null when it reports no status. */
  delivered: boolean | null;
  route: SendRoute;
  /** The target's agent kind, from `hc ls`; null when it is not listed. */
  agent: string | null;
  /** The foreground program when the agent kind is a plain shell, else absent. */
  program?: string;
  /** Why delivery is unconfirmed, or why a confirmed send started no turn. */
  note?: string;
}

/** The note for an opencode target that reports no status. */
export const OPENCODE_NOTE = "opencode reports no turn status";

/** The note for a qoder target that reports no status. */
export const QODER_NOTE = "qoder reports no turn status";

/**
 * The note when nothing about the target is known, so nobody can tell if it arrived.
 * When the kind is known the note names it instead (see `shellNote`).
 */
export const NO_STATUS_NOTE = "target is an opencode TUI or a shell; hc reports no turn status";

/** Shell kinds: a shell tab is a plain shell, never an agent. */
export const SHELL_KINDS = new Set(["zsh", "sh", "bash", "fish", "dash", "ksh", "nu", "pwsh"]);

/** Whether an `hc ls` agent kind is a plain shell. */
export function isShellKind(kind: string): boolean {
  return SHELL_KINDS.has(kind);
}

/** The note for a target whose kind is a plain shell and which reports no status. */
export function shellNote(kind: string): string {
  return `target is a ${kind} shell; hc reports no turn status`;
}

/** The note for a send the target confirmed but which started no turn. */
export const NOT_STARTED_NOTE = "did not start a turn; it may still have arrived, read before resending";

/**
 * Explicit delivery fields for an `hc send` result. `started` is null exactly when the
 * program reports no status, so `delivered` stays null there and a note explains it.
 * A confirmed send that started no turn (`started: false`) keeps `delivered: false`
 * with a note against resending blindly. `program` is the foreground program when the
 * agent kind stayed a shell kind.
 */
export function deliveryFields(
  result: unknown,
  agent: string | null,
  route: SendRoute,
  program?: string | null,
): DeliveryFields {
  const started = isRecord(result) ? result.started : undefined;
  const delivered = typeof started === "boolean" ? started : null;
  const extra = program ? { program } : {};
  if (delivered !== null) {
    return delivered
      ? { delivered, route, agent, ...extra }
      : { delivered, route, agent, ...extra, note: NOT_STARTED_NOTE };
  }
  const note =
    agent === "opencode"
      ? OPENCODE_NOTE
      : agent === "qoder"
        ? QODER_NOTE
        : agent && isShellKind(agent)
          ? shellNote(agent)
          : NO_STATUS_NOTE;
  return { delivered, route, agent, ...extra, note };
}

/** The target's agent kind, from `hc ls` (keyed by address and name); null when it is not listed. */
export function agentOf(agents: Map<string, string>, address: string): string | null {
  return agents.get(address) ?? agents.get(address.toLowerCase()) ?? null;
}

/** Agents `hcx spawn` knows by default, and the command each one runs. */
export const AGENTS: Record<string, string> = {
  muse: "muse",
  pi: "pi",
  claude: "claude",
  opencode: "opencode",
  agy: "agy",
  qoder: "qodercli",
};

/** An agent name: lowercase letters, digits and dashes, starting with an alphanumeric. */
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Where the user's extra `hcx spawn` agents live: `$HCX_AGENTS_FILE` when set,
 * else `${XDG_CONFIG_HOME:-~/.config}/hcx/agents.json`. A missing file is fine.
 */
export function agentsFilePath(): string {
  const override = process.env.HCX_AGENTS_FILE;
  if (override !== undefined && override !== "") return override;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg !== undefined && xdg !== "" ? xdg : `${homeDir()}/.config`;
  return `${base}/hcx/agents.json`;
}

/** The home directory for the default agents file location. */
function homeDir(): string {
  return process.env.HOME ?? osHomedir();
}

/** A resolved agent command: the argv prefix before the user's agent flags. */
export type AgentCommand = string | string[];

/** Agent names to their resolved argv prefix. */
export type KnownAgents = Record<string, AgentCommand>;

/** The built-in agents as argv prefixes. */
export function builtinAgents(): KnownAgents {
  return Object.fromEntries(Object.entries(AGENTS).map(([name, command]) => [name, [command]]));
}

/**
 * Reads the user's agents file: a JSON object mapping an agent name to a command,
 * either a string (`"agy"`) or a non-empty array of strings (`["agy", "--flag"]`,
 * the argv prefix before the user's agent flags). A missing file is fine and reads
 * as no extra agents. Anything malformed throws an HcxError of kind "usage" naming
 * the file path and the offending agent name.
 */
export function loadAgentsFile(file?: string): KnownAgents {
  const path = file ?? agentsFilePath();
  let text: string;
  try {
    text = readAgentsFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw new HcxError(`bad agents file "${path}": cannot read it: ${(e as Error).message}`, { kind: "usage" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HcxError(`bad agents file "${path}": not JSON`, { kind: "usage" });
  }
  if (!isRecord(parsed))
    throw new HcxError(`bad agents file "${path}": must be a JSON object mapping agent name to command`, { kind: "usage" });
  const known: KnownAgents = {};
  for (const [name, command] of Object.entries(parsed)) {
    if (!AGENT_NAME_RE.test(name))
      throw new HcxError(`bad agents file "${path}": bad agent name "${name}": must match ^[a-z0-9][a-z0-9-]*$`, {
        kind: "usage",
      });
    if (typeof command === "string") {
      if (command === "")
        throw new HcxError(`bad agents file "${path}": bad command for agent "${name}": must be a non-empty string or a non-empty array of non-empty strings`, {
          kind: "usage",
        });
      known[name] = [command];
    } else if (Array.isArray(command)) {
      if (command.length === 0 || command.some((part) => typeof part !== "string" || part === ""))
        throw new HcxError(`bad agents file "${path}": bad command for agent "${name}": must be a non-empty string or a non-empty array of non-empty strings`, {
          kind: "usage",
        });
      known[name] = [...(command as string[])];
    } else {
      throw new HcxError(`bad agents file "${path}": bad command for agent "${name}": must be a non-empty string or a non-empty array of non-empty strings`, {
        kind: "usage",
      });
    }
  }
  return known;
}

/** Built-ins merged with the user's agents file: configured entries override same-named built-ins. */
export function knownAgents(): KnownAgents {
  return { ...builtinAgents(), ...loadAgentsFile() };
}

/** The usage line for the given known agent names. */
export function spawnUsage(known: KnownAgents = builtinAgents()): string {
  return `usage: hcx spawn <${Object.keys(known).join("|")}> [--name N] [--space S] [--folder DIR] [--task TEXT] [--json] [agent flags...]`;
}

/**
 * The full `hcx spawn --help` text for the given known agents: the static help plus
 * which agents are known and where the agents file lives.
 */
export function spawnHelp(known: KnownAgents = builtinAgents(), file?: string): string {
  const path = file ?? agentsFilePath();
  return `${spawnUsage(known)}

Start an agent in a tab of its own (no parent terminal) through herdr-app do tab.new.
Only --name, --space, --folder (-C), --task and --json are hcx's own; every other flag
goes to the agent, and -- forces the rest to the agent. Values take a space or =:
--name Review, --space=SWE, --model provider/model. A value starting with - is refused.

opencode takes --model provider/model [--variant LEVEL] as hcx's own too: the model
is checked against the registry and switched before the tab opens. Extra agent flags
are kept after --session: hcx spawn opencode --model p/m -- --yolo.

Known agents: ${Object.keys(known).join(", ")}. The built-ins are ${Object.keys(AGENTS).join(", ")}.
Add more in ${path}: {"myagent": "mycmd"} or {"myagent": ["mycmd", "--flag"]} (an entry
with a built-in name overrides that built-in).`;
}

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

export const SPAWN_USAGE = `usage: hcx spawn <${Object.keys(AGENTS).join("|")}> [--name N] [--space S] [--folder DIR] [--task TEXT] [--json] [agent flags...]`;

/** hcx's own help for `spawn`, printed for `hcx spawn --help`. */
export const SPAWN_HELP = `${SPAWN_USAGE}

Start an agent in a tab of its own (no parent terminal) through herdr-app do tab.new.
Only --name, --space, --folder (-C), --task and --json are hcx's own; every other flag
goes to the agent, and -- forces the rest to the agent. Values take a space or =:
--name Review, --space=SWE, --model provider/model. A value starting with - is refused.

opencode takes --model provider/model [--variant LEVEL] as hcx's own too: the model
is checked against the registry and switched before the tab opens. Extra agent flags
are kept after --session: hcx spawn opencode --model p/m -- --yolo.`;

/**
 * `<agent> [--name N] [--folder DIR] [--task TEXT] [--space S] [--json] [agent flags...]`.
 * Only those are hcx's own; every other flag goes to the agent. For the agent named
 * opencode, `--model` and `--variant` are hcx's own too, because they choose the
 * session's model. `-h` and `--help` are not parsed here: `spawn` intercepts a leading
 * one (`spawn muse --help` still goes to the agent). `known` is the built-ins merged
 * with the user's agents file; it defaults to the built-ins so unit use stays hermetic.
 */
export function parseSpawn(args: string[], known: KnownAgents = builtinAgents()): SpawnPlan {
  const [agent, ...rest] = args;
  if (!agent) throw new HcxError(spawnUsage(known), { kind: "usage" });
  const entry = known[agent];
  if (entry === undefined)
    throw new HcxError(`unknown agent "${agent}"; known: ${Object.keys(known).join(", ")}`, { kind: "usage" });
  const prefix = Array.isArray(entry) ? entry : [entry];
  const plan: SpawnPlan = { agent, argv: [...prefix] };
  const value = (flag: string, raw: string | undefined, i: number) => {
    const v = raw ?? rest[i + 1];
    if (v === undefined || v.startsWith("-"))
      throw new HcxError(`${flag} needs a value`, { kind: "usage" });
    return v;
  };
  const split = (a: string): [string, string | undefined] => {
    const at = a.indexOf("=");
    return at < 0 ? [a, undefined] : [a.slice(0, at), a.slice(at + 1)];
  };
  for (let i = 0; i < rest.length; i++) {
    const [a, inline] = split(rest[i]);
    if (rest[i] === "--") { plan.argv.push(...rest.slice(i + 1)); break; }
    if (a === "--name") plan.name = inline === undefined ? value(a, undefined, i++) : value(a, inline, i);
    else if (a === "--folder" || rest[i] === "-C") plan.folder = inline === undefined ? value(a === "--folder" ? a : "-C", undefined, i++) : value(a, inline, i);
    else if (a === "--task") plan.task = inline === undefined ? value(a, undefined, i++) : value(a, inline, i);
    else if (a === "--space") plan.space = inline === undefined ? value(a, undefined, i++) : value(a, inline, i);
    else if (rest[i] === "--json") plan.json = true;
    else if (agent === "opencode" && a === "--model") plan.model = inline === undefined ? value(a, undefined, i++) : value(a, inline, i);
    else if (agent === "opencode" && a === "--variant") plan.variant = inline === undefined ? value(a, undefined, i++) : value(a, inline, i);
    else plan.argv.push(FLAG_ALIASES[rest[i]] ?? rest[i]);
  }
  if (plan.variant && !plan.model) throw new HcxError("--variant needs --model", { kind: "usage" });
  if (plan.name && (isAddress(plan.name) || /^\d+$/.test(plan.name) || /\s/.test(plan.name))) {
    throw new HcxError(
      `--name "${plan.name}" must not look like a terminal address, be all digits, or contain whitespace`,
      { kind: "usage" },
    );
  }
  return plan;
}

/** `provider/model`, split at the first slash: model ids may contain one. */
export function parseModel(spec: string): { providerID: string; id: string } {
  const at = spec.indexOf("/");
  if (at <= 0 || at === spec.length - 1) {
    throw new HcxError(`--model needs provider/model, such as "provider/model"; got "${spec}"`, { kind: "usage" });
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
