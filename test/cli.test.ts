// End-to-end tests of the hcx CLI: hc, herdr-app and opencode are fake binaries on
// PATH that record what they were asked (test/fake-tool.ts) and answer from fixtures.

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const FAKE_TOOL = fileURLToPath(new URL("./fake-tool.ts", import.meta.url));

const TABS = JSON.stringify({
  spaces: [
    {
      id: "spA",
      name: "SWE",
      folder: "/tmp",
      tabs: [
        { id: "tab1", name: "Lead", terminals: [{ terminal: "t1", app: "claude-code" }] },
        { id: "tab2", name: "Mira", terminals: [{ terminal: "t5", app: "muse" }] },
        { id: "tab3", name: "Shell", terminals: [{ terminal: "t6", app: null }] },
      ],
    },
  ],
});

const AGENTS = JSON.stringify({
  terminals: [
    { address: "t1", agent: "claude-code" },
    { address: "t5", agent: "muse" },
    { address: "t6", agent: "zsh" },
  ],
});

interface Answer {
  out?: string;
  err?: string;
  exit?: number;
}

interface Call {
  tool: string;
  args: string[];
  caller: string | null;
  cwd: string;
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "hcx-cli-"));
  const bin = join(root, "bin");
  const fake = join(root, "fake");
  mkdirSync(bin);
  mkdirSync(fake);
  for (const tool of ["hc", "herdr-app", "opencode"]) {
    const path = join(bin, tool);
    writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_TOOL}" ${tool} "$@"\n`);
    chmodSync(path, 0o755);
  }
  const log = join(root, "calls.jsonl");

  const answer = (name: string, a: Answer = {}) => {
    if (a.out !== undefined) writeFileSync(join(fake, `${name}.out`), a.out);
    if (a.err !== undefined) writeFileSync(join(fake, `${name}.err`), a.err);
    if (a.exit !== undefined) writeFileSync(join(fake, `${name}.exit`), String(a.exit));
  };

  const run = (args: string[], env: Record<string, string> = {}) => {
    const base: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) base[key] = value;
    delete base.HC_TERMINAL_ID;
    delete base.FAKE_DIR;
    delete base.FAKE_LOG;
    const child = Bun.spawnSync([process.execPath, MAIN, ...args], {
      env: { ...base, PATH: `${bin}:${base.PATH}`, FAKE_DIR: fake, FAKE_LOG: log, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: child.exitCode,
      out: child.stdout?.toString() ?? "",
      err: child.stderr?.toString() ?? "",
    };
  };

  const calls = (): Call[] => {
    try {
      return readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call);
    } catch {
      return [];
    }
  };

  const call = (tool: string, command: string): Call | undefined =>
    calls().find((c) => c.tool === tool && c.args[0] === command);

  const folder = (name = "work") => {
    const path = join(root, name);
    mkdirSync(path);
    return path;
  };

  return { root, answer, run, calls, call, folder };
}

describe("hcx --version", () => {
  test("prints hcx's version, then hc's", () => {
    const s = sandbox();
    s.answer("hc.version", { out: "hc 9.9.9\n" });
    for (const flag of ["--version", "-V"]) {
      const r = s.run([flag]);
      expect(r.code).toBe(0);
      expect(r.out).toBe(`hcx ${VERSION}\nhc 9.9.9\n`);
    }
  });
});

describe("hcx send delivery status", () => {
  test("a target that reports status confirms delivery, with its agent kind", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":3}\n' });

    const r = s.run(["send", "--json", "Mira", "hello"], { HC_TERMINAL_ID: "t1" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      started: true,
      status: "idle",
      turn: 3,
      delivered: true,
      route: "hcx",
      agent: "muse",
    });
  });

  test("a target that reports no status is unconfirmed, with a note", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "Shell", "hello"]);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.delivered).toBeNull();
    expect(body.route).toBe("hcx");
    expect(body.agent).toBe("zsh");
    expect(body.note).toContain("hc reports no turn status");
  });

  test("the default output (piped) carries the fields too", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":2}\n' });

    const r = s.run(["send", "Mira", "hello"], { HC_TERMINAL_ID: "t1" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ turn: 2, delivered: true, route: "hcx", agent: "muse" });
  });

  test("a failed send keeps hc's error bytes and exit code", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.send", {
      err: '{"error":{"kind":"not_found","message":"no terminal \\"t5\\""}}\n',
      exit: 3,
    });

    const r = s.run(["send", "--json", "Mira", "hello"]);
    expect(r.code).toBe(3);
    expect(r.out).toBe("");
    expect(JSON.parse(r.err)).toEqual({ error: { kind: "not_found", message: 'no terminal "t5"' } });
  });
});

describe("hcx send --no-footer", () => {
  test("sends the text exactly as given, untagged, and reports the raw route", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":1}\n' });
    const text = 'line one\n\n— from Fake · reply: hcx send Fake "..."';

    const r = s.run(["send", "--no-footer", "--wait", "--force", "--if", "idle", "Mira", text], { HC_TERMINAL_ID: "t1" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ delivered: true, route: "hcx-raw", agent: "muse" });

    const send = s.call("hc", "send");
    expect(send?.args).toEqual(["send", "--wait", "--force", "--if", "idle", "--json", "t5", text]);
    expect(send?.caller).toBeNull();
  });

  test("--raw is the same flag", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "Shell", "--raw", "echo hi"]);
    expect(JSON.parse(r.out).route).toBe("hcx-raw");
    expect(s.call("hc", "send")?.args.at(-1)).toBe("echo hi");
  });

  test("without the flag the footer is still added and the tag is absent", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":1}\n' });

    const r = s.run(["send", "Mira", "hello"], { HC_TERMINAL_ID: "t1" });
    expect(JSON.parse(r.out).route).toBe("hcx");
    const send = s.call("hc", "send");
    expect(send?.args.at(-1)).toBe('hello\n\n— from Lead · reply: hcx send Lead "..."');
    expect(send?.caller).toBeNull();
  });
});

describe("hcx spawn opencode --model", () => {
  const model = "vikey/deepseek-v4-flash";

  // The fake model registry: fake ids only, no key-like fields, so nothing secret
  // ever reaches the tests. A missing `enabled` counts as available.
  const MODEL_LIST = JSON.stringify({
    location: {},
    data: [
      { id: "deepseek-v4-flash", providerID: "vikey", enabled: true, variants: [{ id: "low" }, { id: "medium" }, { id: "high" }] },
      { id: "claude-sonnet-4", providerID: "anthropic", enabled: false, variants: [] },
      { id: "deepseek-r1", providerID: "vikey", variants: [{ id: "base" }] },
    ],
  });

  function ready(s: ReturnType<typeof sandbox>) {
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });
    s.answer("opencode.model.list", { out: MODEL_LIST });
    s.answer("opencode.session.create", { out: '{"data":{"id":"ses_1"}}\n' });
    s.answer("opencode.session.switchModel", { out: "{}\n" });
    s.answer(
      "opencode.session.list",
      { out: `{"data":[{"id":"ses_1","model":{"providerID":"vikey","id":"deepseek-v4-flash","variant":"high"}}]}\n` },
    );
  }

  test("creates the session, switches and verifies the model, then starts the TUI on it", () => {
    const s = sandbox();
    ready(s);
    const folder = s.folder();

    const r = s.run(
      ["spawn", "opencode", "--model", model, "--variant", "high", "--name", "Probe", "--folder", folder, "--json"],
      { HC_TERMINAL_ID: "t1" },
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      name: "Probe",
      terminal: "t90",
      agent: "opencode",
      space: "spA",
      folder,
      model,
      variant: "high",
    });

    // The registry is consulted first, in the same folder, and nothing from it is printed.
    const apiCalls = s.calls().filter((c) => c.tool === "opencode" && c.args[0] === "api");
    const listed = apiCalls[0];
    expect(listed?.args).toEqual(["api", "model.list"]);
    expect(listed?.cwd).toBe(realpathSync(folder));

    const create = s.calls().find((c) => c.tool === "opencode" && c.args[1] === "session.create");
    expect(create?.args).toEqual([
      "api",
      "session.create",
      "-d",
      JSON.stringify({ title: "Probe", location: { directory: folder } }),
    ]);
    expect(create?.cwd).toBe(realpathSync(folder));

    const switched = s.calls().find((c) => c.tool === "opencode" && c.args[1] === "session.switchModel");
    expect(switched?.args).toEqual([
      "api",
      "session.switchModel",
      "--param",
      "sessionID=ses_1",
      "-d",
      JSON.stringify({ model: { providerID: "vikey", id: "deepseek-v4-flash", variant: "high" } }),
    ]);
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.list")).toBe(true);

    const tab = s.call("herdr-app", "do");
    expect(tab).toBeDefined();
    const argv = JSON.parse(tab!.args[tab!.args.indexOf("--argv") + 1]) as string[];
    expect(argv).toEqual(["opencode", "--session", "ses_1"]);
    expect(tab!.args[tab!.args.indexOf("--folder") + 1]).toBe(folder);
  });

  test("refuses a model the session does not report, before opening a tab", () => {
    const s = sandbox();
    ready(s);
    s.answer(
      "opencode.session.list",
      { out: '{"data":[{"id":"ses_1","model":{"providerID":"vikey","id":"another","variant":"default"}}]}\n' },
    );

    const r = s.run(["spawn", "opencode", "--model", model, "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("did not accept model");
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses when the OpenCode service is not running, before opening a tab", () => {
    const s = sandbox();
    ready(s);
    s.answer("opencode.model.list", { err: "connect ECONNREFUSED 127.0.0.1:49374\n", exit: 1 });

    const r = s.run(["spawn", "opencode", "--model", model, "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("check that OpenCode's background service is running");
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses an unknown model before any session or tab exists", () => {
    const s = sandbox();
    ready(s);

    const r = s.run(["spawn", "opencode", "--model", "vikey/no-such-model", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown opencode model "vikey/no-such-model"; run opencode and pick one with /models');
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses an unknown provider", () => {
    const s = sandbox();
    ready(s);

    const r = s.run(["spawn", "opencode", "--model", "nope/deepseek-v4-flash", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown opencode model "nope/deepseek-v4-flash"');
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses a disabled model", () => {
    const s = sandbox();
    ready(s);

    const r = s.run(["spawn", "opencode", "--model", "anthropic/claude-sonnet-4", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('opencode model "anthropic/claude-sonnet-4" is disabled');
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses an unknown variant and lists the model's variant ids", () => {
    const s = sandbox();
    ready(s);

    const r = s.run(["spawn", "opencode", "--model", model, "--variant", "max", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`unknown variant "max" for ${model}`);
    expect(r.err).toContain("available: low, medium, high");
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("a variant is valid when the entry has no enabled field", () => {
    const s = sandbox();
    ready(s);
    s.answer(
      "opencode.session.list",
      { out: '{"data":[{"id":"ses_1","model":{"providerID":"vikey","id":"deepseek-r1","variant":"base"}}]}\n' },
    );

    const r = s.run(["spawn", "opencode", "--model", "vikey/deepseek-r1", "--variant", "base", "--name", "Probe", "--folder", s.folder(), "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ model: "vikey/deepseek-r1", variant: "base" });
    const created = s.calls().find((c) => c.tool === "opencode" && c.args[1] === "session.create");
    expect(created).toBeDefined();
  });

  test("without --model the TUI starts unchanged", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });
    const folder = s.folder();

    const r = s.run(["spawn", "opencode", "--name", "Plain", "--folder", folder, "--json"], { HC_TERMINAL_ID: "t1" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ name: "Plain", terminal: "t90", agent: "opencode", space: "spA", folder });
    expect(s.calls().some((c) => c.tool === "opencode")).toBe(false);
    const argv = JSON.parse(s.call("herdr-app", "do")!.args[s.call("herdr-app", "do")!.args.indexOf("--argv") + 1]);
    expect(argv).toEqual(["opencode"]);
  });

  test("without --json spawn still prints its text line", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });

    const r = s.run(["spawn", "muse", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(0);
    expect(r.out).toBe('spawned Probe (t90, muse) · message it: hcx send Probe "..."\n');
  });
});

describe("hcx done", () => {
  test("kills then removes each tab, ignoring a finished one, and reports an unknown one", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("kill.t5", { out: '{"address":"t5"}\n' });
    s.answer("rm.t5", { out: '{"removed":"t5"}\n' });
    s.answer("kill.t6", { err: "terminal already finished\n", exit: 1 });
    s.answer("rm.t6", { out: '{"removed":"t6"}\n' });
    s.answer("kill.Ghost", { err: '{"error":{"kind":"not_found","message":"no terminal \\"Ghost\\""}}\n', exit: 3 });
    s.answer("rm.Ghost", { err: '{"error":{"kind":"not_found","message":"no terminal \\"Ghost\\""}}\n', exit: 3 });

    const r = s.run(["done", "Mira", "Shell", "Ghost"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("done Mira (t5)\ndone Shell (t6)\n");
    expect(r.err).toContain('hcx done: Ghost: no terminal "Ghost"');

    const hc = s.calls().filter((c) => c.tool === "hc").map((c) => c.args.join(" "));
    expect(hc).toEqual(["kill t5", "rm t5", "kill t6", "rm t6", "kill Ghost", "rm Ghost"]);
  });

  test("exits 0 when every tab is done", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("kill.t5", { out: "{}\n" });
    s.answer("rm.t5", { out: '{"removed":"t5"}\n' });

    const r = s.run(["done", "Mira"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("done Mira (t5)\n");
  });

  test("an address is used as is", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("kill.t42", { out: "{}\n" });
    s.answer("rm.t42", { out: '{"removed":"t42"}\n' });

    const r = s.run(["done", "t42"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("done t42\n");
  });

  test("no tab is a usage error", () => {
    const r = sandbox().run(["done"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage: hcx done <tab>...");
  });
});
