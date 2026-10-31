import { spawnSync } from "node:child_process";

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

/** Runs `hc` with this process's stdio and returns its exit code (128+n on a signal). */
export function runHc(args: string[], env: NodeJS.ProcessEnv = process.env): number {
  const p = spawnSync("hc", args, { env, stdio: "inherit" });
  if (p.error) throw p.error;
  if (p.signal) return 128 + (SIGNAL_NUMBERS[p.signal] ?? 0);
  return p.status ?? 1;
}
