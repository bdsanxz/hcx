// Human-readable text renderers: the default output without --json.
// --json keeps hc's/hcx's JSON documents byte for byte; these only render text.

import { isRecord } from "./lib";

/** One `hcx send` result as a single text line. */
export interface SendLine {
  /** The target as the user typed it (a tab name or an address). */
  target: string;
  /** The resolved terminal address the text went to. */
  address: string;
  /** The target's agent kind; null when it is not known. */
  agent: string | null;
  /** From `deliveryFields`: true/false, or null when unconfirmed. */
  delivered: boolean | null;
  /** hc's own status and turn, for context. */
  status: unknown;
  turn: unknown;
  /** Why delivery is unconfirmed, or why a confirmed send started no turn. */
  note?: string;
}

const MISSING = "unknown";

/**
 * `sent to Mira (t5, muse): delivered, status idle, turn 3`. When delivery is
 * unconfirmed or started no turn the note is appended: `...: not delivered,
 * status idle, turn 3: <note>` / `...: delivery unconfirmed, status unknown,
 * turn 0: <note>`. Missing fields render as `unknown`, never as blank.
 */
export function formatSendLine(s: SendLine): string {
  const agent = s.agent ?? MISSING;
  const status = typeof s.status === "string" && s.status !== "" ? s.status : MISSING;
  const turn = typeof s.turn === "number" ? String(s.turn) : MISSING;
  const verdict = s.delivered === true ? "delivered" : s.delivered === false ? "not delivered" : "delivery unconfirmed";
  const line = `sent to ${s.target} (${s.address}, ${agent}): ${verdict}, status ${status}, turn ${turn}`;
  return s.note ? `${line}: ${s.note}` : line;
}

/** One row of the `hcx ls` table. Missing fields render as `-`. */
export interface LsRow {
  address: string;
  agent: string;
  status: string;
  turn: string;
  where: string;
  cwd: string;
}

function cell(value: unknown): string {
  if (typeof value === "string") return value === "" ? "-" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "-";
}

/**
 * The `hcx ls` table: ADDRESS, AGENT, STATUS, TURN, WHERE, plus CWD when at
 * least one terminal reports one, then a `(+N hidden finished)` footer line
 * when hc reports finished terminals it hid. Returns null when the value is
 * not an `hc ls` listing, so the caller falls back to hc's raw output.
 */
export function renderLsTable(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.terminals)) return null;
  const rows: LsRow[] = [];
  for (const t of value.terminals) {
    if (!isRecord(t)) return null;
    rows.push({
      address: cell(t.address),
      agent: cell(t.agent),
      status: cell(t.status),
      turn: cell(t.turn),
      where: cell(t.where),
      cwd: typeof t.cwd === "string" ? t.cwd : "",
    });
  }
  const showCwd = rows.some((r) => r.cwd !== "");
  const header: LsRow = { address: "ADDRESS", agent: "AGENT", status: "STATUS", turn: "TURN", where: "WHERE", cwd: "CWD" };
  const widths = (key: keyof LsRow): number =>
    Math.max(header[key].length, ...rows.map((r) => (key === "cwd" && !showCwd ? 0 : r[key].length)));
  const columns: (keyof LsRow)[] = showCwd
    ? ["address", "agent", "status", "turn", "where", "cwd"]
    : ["address", "agent", "status", "turn", "where"];
  const line = (r: LsRow): string =>
    columns.map((key) => (key === "cwd" && !showCwd ? "" : r[key].padEnd(widths(key)))).join(" ").trimEnd();
  const lines = [line(header), ...rows.map(line)];
  if (typeof value.hidden_finished === "number" && value.hidden_finished > 0) {
    lines.push(`(+${value.hidden_finished} hidden finished)`);
  }
  return lines.join("\n");
}

/** An hc `{"error":{...}}` document carried in captured output. */
export interface HcErrorDoc {
  message: string;
  hint?: string;
}

/**
 * Reads an hc `{"error":{"kind","message","hint"}}` document out of captured
 * output (stdout or stderr), or null when the text is not one. Only `message`
 * (and `hint` when it is a string) is kept; hcx reprints those as text itself.
 */
export function parseErrorDoc(text: string): HcErrorDoc | null {
  let value: unknown;
  try {
    value = JSON.parse(text.trim()) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { message, hint } = value.error as { message?: unknown; hint?: unknown };
  if (typeof message !== "string") return null;
  return typeof hint === "string" ? { message, hint } : { message };
}

/** Prints an hc error document as hcx's own text error. */
export function reportHcError(doc: HcErrorDoc): void {
  console.error(`hcx: ${doc.message}`);
  if (doc.hint !== undefined) console.error(`hint: ${doc.hint}`);
}

/** Renders a scalar for `key: value` lines; objects stay compact JSON, null stays `-` (hc's own TTY style). */
function getCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value === "" ? "-" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * `hcx get` as `key: value` lines in hc's own key order; nested objects stay
 * compact JSON so nothing is hidden. Returns null for anything that is not a
 * plain object (and for hc's `{"error":...}` shape) so the caller falls back
 * to hc's raw output.
 */
export function renderGetLines(value: unknown): string | null {
  if (!isRecord(value) || "error" in value) return null;
  return Object.entries(value)
    .map(([key, v]) => `${key}: ${getCell(v)}`)
    .join("\n");
}
