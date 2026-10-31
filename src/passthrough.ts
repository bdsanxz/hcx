import { spawnSync } from "node:child_process";
import { formatTimeout, HcxError } from "./lib";

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
