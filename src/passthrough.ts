import { spawnSync } from "node:child_process";
import { firstPositional, formatTimeout, HcxError, isRecord } from "./lib";
import { parseErrorDoc, renderGetLines, renderLsTable, reportHcError } from "./text";

/** Signal name → number, for the 128+n exit convention. */
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
  SIGSTKFLT: 16,
  SIGCHLD: 17,
  SIGCONT: 18,
  SIGSTOP: 19,
  SIGTSTP: 20,
  SIGTTIN: 21,
  SIGTTOU: 22,
  SIGURG: 23,
  SIGXCPU: 24,
  SIGXFSZ: 25,
  SIGVTALRM: 26,
  SIGPROF: 27,
  SIGWINCH: 28,
  SIGIO: 29,
  SIGPWR: 30,
  SIGSYS: 31,
};

/** Whether a spawnSync failure is the timeout firing (the child was killed). */
export function isTimeoutError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  if (code === "ETIMEDOUT") return true;
  const message = (e as { message?: unknown }).message;
  return typeof message === "string" && /ETIMEDOUT|timed out/i.test(message);
}

/** The timeout error for a killed `hc send`: the message may have landed, never retry. */
export function sendTimeoutError(timeoutMs: number): HcxError {
  return new HcxError(
    `hc send timed out after ${formatTimeout(timeoutMs)}; the message may have landed, do not retry automatically`,
    { kind: "timeout", hint: "read before resending; never retry a timed-out send blindly" },
  );
}

/**
 * Runs `hc ls|get|keys` for the default text output: hc is asked for JSON
 * (every hc command takes `--json`) and the result renders as text. An hc
 * `{"error":...}` document renders as hcx's own text error with hc's exit
 * code. Anything else hcx cannot render sensibly — output of an unknown shape —
 * falls back to hc's raw bytes and exit code, so data is never hidden.
 */
export function runTextCommand(command: "ls" | "get" | "keys", args: string[]): number {
  const p = spawnSync("hc", [command, "--json", ...args], { encoding: "utf8" });
  if (p.error) throw p.error;
  // An hc error document is text by default (same exit code); with --json the
  // caller forwards hc's bytes instead. Streams that are not the document are
  // still forwarded.
  const errDoc = parseErrorDoc(p.stdout) ?? parseErrorDoc(p.stderr);
  if (errDoc) {
    if (p.stderr && !parseErrorDoc(p.stderr)) process.stderr.write(p.stderr);
    if (p.stdout && !parseErrorDoc(p.stdout)) process.stdout.write(p.stdout);
    reportHcError(errDoc);
    return p.status ?? 1;
  }
  if (p.stderr) process.stderr.write(p.stderr);
  if (p.status !== 0) {
    if (p.stdout) process.stdout.write(p.stdout);
    return p.status ?? 1;
  }
  const rendered = renderCommandText(command, args, p.stdout);
  // A rendered line prints even when hc said nothing (a successful `keys`
  // ack is empty under the fake tools); otherwise hc's own bytes are kept.
  if (rendered !== null) process.stdout.write(rendered === "" ? "\n" : rendered + "\n");
  else if (p.stdout) process.stdout.write(p.stdout);
  return 0;
}

/**
 * The text for a successful `hc ls|get|keys --json` call, or null when it
 * cannot be rendered and hc's raw output must be kept.
 */
function renderCommandText(command: "ls" | "get" | "keys", args: string[], stdout: string): string | null {
  if (command === "keys") {
    // A successful `hc keys` pressed the keys; its ack (`{"status","turn"}`)
    // carries nothing to show, so the line names the terminal instead.
    const i = firstPositional("keys", args);
    return i < 0 ? null : `sent keys to ${args[i]}`;
  }
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || "error" in value) return null;
  return command === "ls" ? renderLsTable(value) : renderGetLines(value);
}

/**
 * Pass-through commands that are non-interactive and bounded: without --json
 * their output is captured so an hc `{"error":...}` document renders as hcx
 * text (same exit code); successful output passes through byte for byte.
 * Everything else (attach, run, wait, anything streaming or TTY-bound, and
 * unknown commands) keeps inheriting stdio untouched.
 */
export const TEXT_PASSTHROUGH_COMMANDS = new Set([
  "read",
  "kill",
  "rm",
  "label",
  "keep",
  "interrupt",
  "put",
]);

/**
 * Runs `hc` capturing stdout/stderr for a bounded one-shot pass-through. On
 * exit 0 both streams pass through byte for byte. On a non-zero exit, when
 * either stream is an hc `{"error":...}` document it renders as hcx's own
 * text error (same format as send/get/keys) with hc's exit code and the
 * document bytes are suppressed; anything else passes through unchanged.
 */
export function runTextPassthrough(command: string, args: string[]): number {
  const p = spawnSync("hc", [command, ...args]);
  if (p.error) throw p.error;
  if (p.signal) {
    if (p.stdout && p.stdout.length) process.stdout.write(p.stdout);
    if (p.stderr && p.stderr.length) process.stderr.write(p.stderr);
    return 128 + (SIGNAL_NUMBERS[p.signal] ?? 0);
  }
  const status = p.status ?? 1;
  if (status === 0) {
    if (p.stdout && p.stdout.length) process.stdout.write(p.stdout);
    if (p.stderr && p.stderr.length) process.stderr.write(p.stderr);
    return 0;
  }
  const outText = p.stdout?.toString("utf8") ?? "";
  const errText = p.stderr?.toString("utf8") ?? "";
  const errDoc = parseErrorDoc(outText) ?? parseErrorDoc(errText);
  if (errDoc) {
    if (p.stderr && p.stderr.length && !parseErrorDoc(errText)) process.stderr.write(p.stderr);
    if (p.stdout && p.stdout.length && !parseErrorDoc(outText)) process.stdout.write(p.stdout);
    reportHcError(errDoc);
    return status;
  }
  if (p.stdout && p.stdout.length) process.stdout.write(p.stdout);
  if (p.stderr && p.stderr.length) process.stderr.write(p.stderr);
  return status;
}

/** Runs `hc` with this process's stdio and returns its exit code (128+n on a signal). */
export function runHc(args: string[], env: NodeJS.ProcessEnv = process.env, timeoutMs?: number): number {
  const p = spawnSync("hc", args, { env, stdio: "inherit", ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}) });
  if (p.error) {
    if (timeoutMs !== undefined && isTimeoutError(p.error)) throw sendTimeoutError(timeoutMs);
    throw p.error;
  }
  if (p.signal) return 128 + (SIGNAL_NUMBERS[p.signal] ?? 0);
  return p.status ?? 1;
}
