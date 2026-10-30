import { spawnSync } from "node:child_process";

/** Runs `hc` with this process's stdio and returns its exit code. */
export function runHc(args: string[], env: NodeJS.ProcessEnv = process.env): number {
  const p = spawnSync("hc", args, { env, stdio: "inherit" });
  if (p.error) throw p.error;
  return p.status ?? 1;
}
