// OpenCode's background service: create a session, switch its model, verify the switch.

import { spawnSync } from "node:child_process";
import { HcxError, checkModel, isRecord, parseModel, sameModel, sessionModel, type ModelSpec } from "./lib";

/**
 * Runs `opencode api <operation>` in `cwd` and returns its JSON. The service's
 * `model.list` output can hold API keys, so it is captured only: parsed for the spec
 * check, never printed, never logged, and never put in a message. Only the
 * operation's error text reaches a message.
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
 * OpenCode's background service: check the model against the registry, create a
 * session, switch it to `model` (and `variant`), and read the model back through
 * `session.list`: `session.get` fails on OpenCode 2.0.29 without a body. Returns the
 * session id for `opencode --session <id>`.
 */
export function prepareOpencodeSession(folder: string, title: string | undefined, model: string, variant: string | undefined): string {
  const wanted = parseModel(model);
  const expected: ModelSpec = { ...wanted, ...(variant ? { variant } : {}) };

  // Refuse before any session or tab exists. `model.list` is the only registry that
  // knows the real models, and its output may hold keys, so only its verdict (the
  // reason, which names nothing beyond the spec and the variant ids) reaches a message.
  const check = checkModel(opencodeApi(folder, "model.list"), expected);
  if (!check.ok) throw new HcxError(check.reason);

  const created = opencodeApi(folder, "session.create", {}, {
    title: title || "opencode",
    location: { directory: folder },
  });
  const session = isRecord(created) && isRecord(created.data) && typeof created.data.id === "string" ? created.data.id : "";
  if (!session) throw new HcxError("opencode api session.create returned no session id");

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
