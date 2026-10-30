// OpenCode's background service: create a session, switch its model, verify the switch.

import { spawnSync } from "node:child_process";
import { HcxError, isRecord, parseModel, sameModel, sessionModel, type ModelSpec } from "./lib";

/**
 * Runs `opencode api <operation>` in `cwd` and returns its JSON. The service's
 * `model.list` output can hold API keys, so this module never asks for it and never
 * prints any API output: only the operation's error text reaches a message.
 */
function opencodeApi(cwd: string, operation: string, params: Record<string, string> = {}, data?: unknown): unknown {
  const args = ["api", operation];
  for (const [key, value] of Object.entries(params)) args.push("--param", `${key}=${value}`);
  if (data !== undefined) args.push("-d", JSON.stringify(data));
  const p = spawnSync("opencode", args, { cwd, encoding: "utf8" });
  if (p.error) throw new HcxError(`could not run opencode: ${p.error.message}`);
  if (p.status !== 0) {
    const detail = (p.stderr || p.stdout).trim();
    throw new HcxError(
      `opencode api ${operation} failed${detail ? `: ${detail}` : ` (exit ${p.status})`}; ` +
        "check that OpenCode's background service is running and the model is known",
    );
  }
  try {
    return JSON.parse(p.stdout || "{}") as unknown;
  } catch {
    throw new HcxError(`opencode api ${operation} printed no JSON`);
  }
}

/**
 * Creates an OpenCode session in `folder`, switches it to `model` (and `variant`),
 * and reads the model back through `session.list`: `session.get` fails on OpenCode
 * 2.0.29 without a body. Returns the session id for `opencode --session <id>`.
 */
export function prepareOpencodeSession(folder: string, title: string | undefined, model: string, variant: string | undefined): string {
  const wanted = parseModel(model);
  const created = opencodeApi(folder, "session.create", {}, {
    title: title || "opencode",
    location: { directory: folder },
  });
  const session = isRecord(created) && isRecord(created.data) && typeof created.data.id === "string" ? created.data.id : "";
  if (!session) throw new HcxError("opencode api session.create returned no session id");

  const expected: ModelSpec = { ...wanted, ...(variant ? { variant } : {}) };
  opencodeApi(folder, "session.switchModel", { sessionID: session }, { model: expected });

  const found = sessionModel(opencodeApi(folder, "session.list"), session);
  if (!found) {
    throw new HcxError(`opencode has no session ${session} after switching its model; is "${model}" a known model?`);
  }
  if (!sameModel(found, expected)) {
    const reports = `${found.providerID}/${found.id} (variant ${found.variant})`;
    const asked = variant ? `"${model}" with variant ${variant}` : `"${model}"`;
    throw new HcxError(`opencode did not accept model ${asked}: session ${session} reports ${reports}; check the model name and variant`);
  }
  return session;
}
