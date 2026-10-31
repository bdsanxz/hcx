// End-to-end tests of the hcx CLI: hc, herdr-app and opencode are fake binaries on
// PATH that record what they were asked (test/fake-tool.ts) and answer from fixtures.

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPENCODE_NOTE, QODER_NOTE } from "../src/lib";
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
        { id: "tab4", name: "Bot", terminals: [{ terminal: "t7", app: null }] },
      ],
    },
  ],
});

const AGENTS = JSON.stringify({
  terminals: [
    { address: "t1", agent: "claude-code" },
    { address: "t5", agent: "muse" },
    { address: "t6", agent: "zsh" },
    { address: "t7", agent: "zsh" },
  ],
});

interface Answer {
  out?: string;
  err?: string;
  exit?: number;
  delay?: string;
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
    if (a.delay !== undefined) writeFileSync(join(fake, `${name}.delay`), a.delay);
  };

  const run = (args: string[], env: Record<string, string> = {}) => {
    const base: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) base[key] = value;
    delete base.HC_TERMINAL_ID;
    delete base.FAKE_DIR;
    delete base.FAKE_LOG;
    delete base.HCX_SEND_TIMEOUT_MS;
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

  test("--json prints the machine contract", () => {
    const s = sandbox();
    s.answer("hc.version", { out: "hc 9.9.9\n" });
    for (const flag of ["--version", "-V"]) {
      const r = s.run([flag, "--json"]);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.out)).toEqual({
        hcx: VERSION,
        hc: "9.9.9",
        contract: 1,
        capabilities: ["no-footer", "agent-only", "json-delivery"],
      });
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

  test("a real shell keeps its shell kind and the shell note", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t6", { out: '{"foreground":{"name":"zsh","argv":["zsh"],"pid":1}}\n' });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "--no-footer", "Shell", "hello"]);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.delivered).toBeNull();
    expect(body.route).toBe("hcx-raw");
    expect(body.agent).toBe("zsh");
    expect(body.note).toBe("target is a zsh shell; hc reports no turn status");
    expect(s.call("hc", "get")?.args).toEqual(["get", "t6"]);
  });

  test("a plain shell is refused without --no-footer, before sending", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "Shell", "hello"]);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.err)).toEqual({
      error: { kind: "plain_shell", message: 'tab "Shell" is a plain shell; use --no-footer to type a command' },
    });
    expect(s.calls().some((c) => c.tool === "hc" && c.args[0] === "send")).toBe(false);
  });

  test("a shell running another program reports the program and keeps the shell kind", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t6", { out: '{"foreground":{"name":"vim","argv":["vim"],"pid":9}}\n' });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "--no-footer", "Shell", "hello"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ delivered: null, agent: "zsh", program: "vim" });
  });

  test("an opencode tab behind a shell wrapper is reported as opencode", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t7", { out: '{"foreground":{"name":"opencode","argv":["opencode"],"pid":2}}\n' });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "Bot", "hello"]);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.delivered).toBeNull();
    expect(body.route).toBe("hcx");
    expect(body.agent).toBe("opencode");
    expect(body.note).toBe(OPENCODE_NOTE);
    expect(s.call("hc", "get")?.args).toEqual(["get", "t7"]);
  });

  test("a qoder tab behind a shell wrapper is reported as qoder", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t7", { out: '{"foreground":{"name":"qodercli-1.1.81","argv":["qodercli"],"pid":4}}\n' });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "--agent-only", "Bot", "hello"]);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.delivered).toBeNull();
    expect(body.route).toBe("hcx");
    expect(body.agent).toBe("qoder");
    expect(body.note).toBe(QODER_NOTE);
    expect(s.call("hc", "get")?.args).toEqual(["get", "t7"]);
  });

  test("a wrapper running something else stays a plain shell", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t7", { out: '{"foreground":{"name":"qodercliX","argv":["qodercliX"],"pid":5}}\n' });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "--agent-only", "Bot", "hello"]);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.err).error.kind).toBe("plain_shell");
    expect(s.calls().some((c) => c.tool === "hc" && c.args[0] === "send")).toBe(false);
  });

  test("a non-shell agent is used as is, without asking hc get", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    // claude-code's foreground is a version string; it must never become the kind.
    s.answer("hc.get.t1", { out: '{"foreground":{"name":"2.1.314","argv":["claude"],"pid":3}}\n' });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":2}\n' });

    const r = s.run(["send", "--json", "Lead", "hello"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ delivered: true, route: "hcx", agent: "claude-code" });
    expect(s.calls().some((c) => c.tool === "hc" && c.args[0] === "get")).toBe(false);
  });

  test("a failed hc get keeps the shell kind", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t6", { err: '{"error":{"kind":"not_found","message":"no terminal \\"t6\\""}}\n', exit: 1 });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "--no-footer", "Shell", "hello"]);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.agent).toBe("zsh");
    expect(body.note).toBe("target is a zsh shell; hc reports no turn status");
  });

  test("unparseable hc get output keeps the shell kind", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t6", { out: "not json at all\n" });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "--no-footer", "Shell", "hello"]);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.agent).toBe("zsh");
    expect(body.note).toBe("target is a zsh shell; hc reports no turn status");
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
    expect(send?.args).toEqual(["send", "--wait", "--force", "--if", "idle", "--json", "--", "t5", text]);
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

  test("hcx's own send help, and a leading dash still reaches hc", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":3}\n' });

    for (const args of [["--help"], ["-h"]]) {
      const help = s.run(["send", ...args]);
      expect(help.code).toBe(0);
      expect(help.out).toContain("--no-footer");
      expect(help.out).toContain("footer");
    }
    const named = s.run(["send", "Mira", "--help"]);
    expect(named.code).toBe(0);
    expect(named.out).toContain("--no-footer");

    const waited = s.run(["send", "--json", "--no-footer", "Mira", "--", "--wait"]);
    expect(waited.code).toBe(0);
    expect(s.calls().filter((c) => c.tool === "hc" && c.args[0] === "send").at(-1)?.args).toEqual([
      "send",
      "--json",
      "--",
      "t5",
      "--wait",
    ]);

    const bullet = s.run(["send", "--json", "--no-footer", "t6", "- item one"]);
    expect(bullet.code).toBe(0);
    expect(s.calls().filter((c) => c.tool === "hc" && c.args[0] === "send").at(-1)?.args).toEqual([
      "send",
      "--json",
      "--",
      "t6",
      "- item one",
    ]);
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
      tab: "tab9",
      session: "ses_1",
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
    expect(JSON.parse(r.err)).toEqual({
      error: {
        kind: "error",
        message: 'unknown opencode model "vikey/no-such-model"; run opencode and pick one with /models',
      },
    });
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses an unknown provider", () => {
    const s = sandbox();
    ready(s);

    const r = s.run(["spawn", "opencode", "--model", "nope/deepseek-v4-flash", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error.message).toContain('unknown opencode model "nope/deepseek-v4-flash"');
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses a disabled model", () => {
    const s = sandbox();
    ready(s);

    const r = s.run(["spawn", "opencode", "--model", "anthropic/claude-sonnet-4", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error.message).toContain('opencode model "anthropic/claude-sonnet-4" is disabled');
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("refuses an unknown variant and lists the model's variant ids", () => {
    const s = sandbox();
    ready(s);

    const r = s.run(["spawn", "opencode", "--model", model, "--variant", "max", "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error.message).toContain(`unknown variant "max" for ${model}`);
    expect(r.err).toContain("available: low, medium, high");
    expect(s.calls().some((c) => c.tool === "opencode" && c.args[1] === "session.create")).toBe(false);
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("stdout from a failed model.list never reaches the error", () => {
    const s = sandbox();
    ready(s);
    s.answer("opencode.model.list", { out: "CANARY-SECRET-MODELS\n", exit: 1 });

    const r = s.run(["spawn", "opencode", "--model", model, "--name", "Probe", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).not.toContain("CANARY");
    expect(r.out).not.toContain("CANARY");
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
    expect(JSON.parse(r.out)).toEqual({ name: "Plain", terminal: "t90", agent: "opencode", space: "spA", folder, tab: "tab9" });
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
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err)).toEqual({ error: { kind: "usage", message: "usage: hcx done [--self] [--json] <tab>..." } });
  });

  test("-h and --help print help, and other flags are refused", () => {
    for (const flag of ["-h", "--help"]) {
      const r = sandbox().run(["done", flag]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("usage: hcx done");
    }
    const r = sandbox().run(["done", "--force", "Mira"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err).error.kind).toBe("usage");
  });

  test("refuses its own terminal unless --self is given", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("kill.t1", { out: "{}\n" });
    s.answer("rm.t1", { out: '{"removed":"t1"}\n' });

    const refused = s.run(["done", "Lead"], { HC_TERMINAL_ID: "t1" });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--self");
    expect(s.calls().filter((c) => c.tool === "hc").length).toBe(0);

    const allowed = s.run(["done", "--self", "Lead"], { HC_TERMINAL_ID: "t1" });
    expect(allowed.code).toBe(0);
    expect(allowed.out).toBe("done Lead (t1)\n");
  });

  test("--json prints one object per tab", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("kill.t5", { out: '{"address":"t5"}\n' });
    s.answer("rm.t5", { out: '{"removed":"t5"}\n' });
    s.answer("kill.Ghost", { err: '{"error":{"kind":"not_found","message":"no terminal \\"Ghost\\""}}\n', exit: 3 });
    s.answer("rm.Ghost", { err: '{"error":{"kind":"not_found","message":"no terminal \\"Ghost\\""}}\n', exit: 3 });

    const r = s.run(["done", "--json", "Mira", "Ghost"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toEqual([
      { target: "Mira", terminal: "t5", removed: true },
      { target: "Ghost", terminal: "Ghost", removed: false, error: 'no terminal "Ghost"' },
    ]);
  });
});

describe("hcx run", () => {
  test("adds --no-parent unless the arguments choose a parent", () => {
    const s = sandbox();

    const r = s.run(["run", "--bg", "--name", "x", "sleep", "30"]);
    expect(r.code).toBe(0);
    expect(s.call("hc", "run")?.args).toEqual(["run", "--no-parent", "--bg", "--name", "x", "sleep", "30"]);

    const kept = s.run(["run", "--parent", "t10", "sleep", "30"]);
    expect(kept.code).toBe(0);
    expect(s.calls().filter((c) => c.tool === "hc" && c.args[0] === "run").at(-1)?.args).toEqual([
      "run",
      "--parent",
      "t10",
      "sleep",
      "30",
    ]);
  });
});

describe("passthrough name resolution", () => {
  test("a tab name becomes its agent terminal for hc's terminal commands", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });

    const r = s.run(["get", "Mira"]);
    expect(r.code).toBe(0);
    expect(s.call("hc", "get")?.args).toEqual(["get", "t5"]);
  });
});

describe("hcx send twin names", () => {
  const TWINS = JSON.stringify({
    spaces: [
      {
        id: "spA",
        name: "SWE",
        tabs: [
          { id: "tab1", name: "Twin", terminals: [{ terminal: "t1", app: "muse" }] },
          { id: "tab2", name: "Twin", terminals: [{ terminal: "t2", app: "muse" }] },
        ],
      },
    ],
  });

  test("a twin name is refused with the ambiguous kind", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TWINS });

    const r = s.run(["send", "Twin", "hello"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toEqual({
      error: { kind: "ambiguous", message: 'tab name "Twin" is ambiguous; use an address like t7' },
    });
    expect(s.calls().some((c) => c.tool === "hc" && c.args[0] === "send")).toBe(false);
  });
});

describe("hcx spawn guards", () => {
  test("--help prints spawn help without touching anything", () => {
    const s = sandbox();

    for (const flag of ["--help", "-h"]) {
      const r = s.run(["spawn", flag]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("--name");
      expect(r.out).toContain("--model");
    }
    expect(s.calls().length).toBe(0);
  });

  test("a duplicate --name is refused before anything opens", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });

    const r = s.run(["spawn", "muse", "--name", "Mira", "--folder", s.folder()]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err).error).toMatchObject({ kind: "usage" });
    expect(JSON.parse(r.err).error.message).toContain('tab name "Mira" is already used by t5');
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("--name taking a flag is refused", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });

    const r = s.run(["spawn", "muse", "--name", "--json"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err).error).toMatchObject({ kind: "usage", message: "--name needs a value" });
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("an unknown --space is refused before any session or tab exists", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });

    const r = s.run(["spawn", "pi", "--space", "nope", "--name", "Fresh", "--folder", s.folder()]);
    expect(r.code).toBe(3);
    expect(JSON.parse(r.err).error).toMatchObject({ kind: "not_found" });
    expect(JSON.parse(r.err).error.message).toContain('no space "nope"');
    expect(s.call("herdr-app", "do")).toBeUndefined();
  });

  test("extra agent flags survive --model", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });
    s.answer("opencode.model.list", {
      out: '{"data":[{"id":"m","providerID":"v","enabled":true,"variants":[]}]}\n',
    });
    s.answer("opencode.session.create", { out: '{"data":{"id":"ses_9"}}\n' });
    s.answer("opencode.session.switchModel", { out: "{}\n" });
    s.answer("opencode.session.list", { out: '{"data":[{"id":"ses_9","model":{"providerID":"v","id":"m"}}]}\n' });
    const folder = s.folder();

    const r = s.run(["spawn", "opencode", "--model", "v/m", "--name", "Kept", "--folder", folder, "--", "--yolo"]);
    expect(r.code).toBe(0);
    const tab = s.call("herdr-app", "do");
    expect(JSON.parse(tab!.args[tab!.args.indexOf("--argv") + 1])).toEqual(["opencode", "--session", "ses_9", "--yolo"]);
  });

  test("a herdr-app do failure after a session exists names the session", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"error":"boom"}\n', exit: 1 });
    s.answer("opencode.model.list", {
      out: '{"data":[{"id":"m","providerID":"v","enabled":true,"variants":[]}]}\n',
    });
    s.answer("opencode.session.create", { out: '{"data":{"id":"ses_9"}}\n' });
    s.answer("opencode.session.switchModel", { out: "{}\n" });
    s.answer("opencode.session.list", { out: '{"data":[{"id":"ses_9","model":{"providerID":"v","id":"m"}}]}\n' });

    const r = s.run(["spawn", "opencode", "--model", "v/m", "--name", "Kept", "--folder", s.folder()]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("boom");
    expect(r.err).toContain("ses_9");
  });

  test("a missing herdr-app says so", () => {
    const s = sandbox();
    unlinkSync(join(s.root, "bin", "herdr-app"));
    // Only the sandbox bin on PATH, so no real herdr-app can stand in.
    const path = `${join(s.root, "bin")}:/usr/bin:/bin`;

    const r = s.run(["spawn", "muse", "--folder", s.folder()], { PATH: path });
    expect(r.code).toBe(1);
    expect(r.err).toContain("herdr-app not found");
  });

  test("a refused protective check is not silently skipped", () => {
    const s = sandbox();
    s.answer("herdr.ls", { err: "connection refused\n", exit: 1 });

    const named = s.run(["spawn", "muse", "--name", "Fresh", "--folder", s.folder("work-a")]);
    expect(named.code).toBe(1);
    expect(JSON.parse(named.err).error.message).toContain('could not check --name "Fresh"');

    const spaced = s.run(["spawn", "pi", "--space", "SWE", "--folder", s.folder("work-b")]);
    expect(spaced.code).toBe(1);
    expect(JSON.parse(spaced.err).error.message).toContain('could not list spaces for --space "SWE"');
  });

  test("the auto-naming poll picks up a real name", () => {
    const withFresh = JSON.stringify({
      spaces: [
        {
          id: "spA",
          name: "SWE",
          tabs: [{ id: "tab9", name: "Fresh", terminals: [{ terminal: "t90", app: "muse" }] }],
        },
      ],
    });
    const s = sandbox();
    s.answer("herdr.ls", { out: withFresh });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });

    const r = s.run(["spawn", "muse", "--folder", s.folder()]);
    expect(r.code).toBe(0);
    expect(r.out).toBe('spawned Fresh (t90, muse) · message it: hcx send Fresh "..."\n');
  });
});

describe("hcx send started:false", () => {
  test("a confirmed send that started no turn warns against resending", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":false,"status":"idle","turn":3}\n' });

    const r = s.run(["send", "--json", "Mira", "hello"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({
      delivered: false,
      route: "hcx",
      agent: "muse",
      note: "did not start a turn; it may still have arrived, read before resending",
    });
  });
});

describe("hcx send --agent-only", () => {
  test("refuses a plain shell before sending, even with --no-footer", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.get.t6", { out: '{"foreground":{"name":"zsh","argv":["zsh"],"pid":1}}\n' });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    for (const extra of [[], ["--no-footer"]]) {
      const r = s.run(["send", "--json", "--agent-only", ...extra, "Shell", "hello"]);
      expect(r.code).toBe(4);
      expect(JSON.parse(r.err).error.kind).toBe("plain_shell");
    }
    expect(s.calls().some((c) => c.tool === "hc" && c.args[0] === "send")).toBe(false);
  });

  test("refuses an unknown kind before sending", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":1}\n' });

    const r = s.run(["send", "--json", "--agent-only", "Ghost", "hello"]);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.err).error.kind).toBe("plain_shell");
    expect(s.calls().some((c) => c.tool === "hc" && c.args[0] === "send")).toBe(false);
  });

  test("combines with --json, --if and --wait for an agent", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":3}\n' });

    const r = s.run(
      ["send", "--agent-only", "--json", "--if", "idle", "--wait", "--timeout", "5", "Mira", "hello"],
      { HC_TERMINAL_ID: "t1" },
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ delivered: true, route: "hcx", agent: "muse" });
    const sent = s.call("hc", "send");
    expect(sent?.args).toContain("--if");
    expect(sent?.args).toContain("--wait");
    expect(sent?.args).toContain("--timeout");
    expect(sent?.args).not.toContain("--agent-only");
    expect(sent?.args).not.toContain("--no-footer");
  });

  test("a raw agent-only send to an agent reports the raw route", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":1}\n' });

    const r = s.run(["send", "--json", "--agent-only", "--no-footer", "Mira", "echo hi"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ delivered: true, route: "hcx-raw", agent: "muse" });
    const sent = s.call("hc", "send");
    expect(sent?.args.at(-1)).toBe("echo hi");
  });
});

describe("hcx send raw address", () => {
  test("skips herdr-app ls when there is nothing to resolve", () => {
    const s = sandbox();
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":null,"status":null,"turn":0}\n' });

    const r = s.run(["send", "--json", "--no-footer", "t6", "echo hi"], { HC_TERMINAL_ID: "t1" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ route: "hcx-raw" });
    expect(s.calls().some((c) => c.tool === "herdr-app")).toBe(false);
    expect(s.call("hc", "send")?.args).toContain("t6");
  });
});

describe("hcx spawn agents file", () => {
  test("a configured agent runs with its command", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });
    const agents = join(s.root, "agents.json");
    writeFileSync(agents, JSON.stringify({ reviewer: "agy" }));

    const r = s.run(["spawn", "reviewer", "--name", "Audit", "--folder", s.folder(), "--json"], { HCX_AGENTS_FILE: agents });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ agent: "reviewer", name: "Audit", terminal: "t90" });
    const tab = s.call("herdr-app", "do");
    expect(JSON.parse(tab!.args[tab!.args.indexOf("--argv") + 1])).toEqual(["agy"]);
  });

  test("an array command is the argv prefix, and overrides a built-in", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });
    const agents = join(s.root, "agents.json");
    writeFileSync(agents, JSON.stringify({ muse: ["muse", "--flag"], builder: ["qodercli", "--some-flag"] }));
    const folder = s.folder();

    const overridden = s.run(["spawn", "muse", "--name", "Kept", "--folder", folder, "--", "--yolo"], {
      HCX_AGENTS_FILE: agents,
    });
    expect(overridden.code).toBe(0);
    const first = s.calls().filter((c) => c.tool === "herdr-app" && c.args[0] === "do");
    expect(JSON.parse(first[0]!.args[first[0]!.args.indexOf("--argv") + 1])).toEqual(["muse", "--flag", "--yolo"]);

    const added = s.run(["spawn", "builder", "--name", "Kept2", "--folder", folder], { HCX_AGENTS_FILE: agents });
    expect(added.code).toBe(0);
    const both = s.calls().filter((c) => c.tool === "herdr-app" && c.args[0] === "do");
    expect(JSON.parse(both[1]!.args[both[1]!.args.indexOf("--argv") + 1])).toEqual(["qodercli", "--some-flag"]);
  });

  test("a missing agents file is fine", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });

    const r = s.run(["spawn", "agy", "--name", "Fresh", "--folder", s.folder()], {
      HCX_AGENTS_FILE: join(s.root, "no-such.json"),
    });
    expect(r.code).toBe(0);
    expect(r.out).toBe('spawned Fresh (t90, agy) · message it: hcx send Fresh "..."\n');
  });

  test("malformed files fail spawn with the path and the key", () => {
    const bodies: [string, RegExp | null][] = [
      ["not json at all", null],
      ['["agy"]', null],
      ['{"Bad_Name": "agy"}', /Bad_Name/],
      ['{"reviewer": ""}', /reviewer/],
      ['{"reviewer": []}', /reviewer/],
      ['{"reviewer": 3}', /reviewer/],
    ];
    for (const [index, [body, key]] of bodies.entries()) {
      const s = sandbox();
      s.answer("herdr.ls", { out: TABS });
      const agents = join(s.root, `agents-${index}.json`);
      writeFileSync(agents, body);

      const r = s.run(["spawn", "--json", "muse", "--name", "Fresh", "--folder", s.folder()], { HCX_AGENTS_FILE: agents });
      expect(r.code).toBe(2);
      const err = JSON.parse(r.err);
      expect(err.error.kind).toBe("usage");
      expect(err.error.message).toContain(agents);
      if (key) expect(err.error.message).toMatch(key);
      expect(s.call("herdr-app", "do")).toBeUndefined();
    }
  });

  test("HCX_AGENTS_FILE wins and XDG_CONFIG_HOME resolves the default", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });
    const xdg = join(s.root, "xdg");
    mkdirSync(join(xdg, "hcx"), { recursive: true });
    writeFileSync(join(xdg, "hcx", "agents.json"), JSON.stringify({ xdger: "agy" }));

    const fromXdg = s.run(["spawn", "xdger", "--name", "X1", "--folder", s.folder("w1")], {
      HCX_AGENTS_FILE: "",
      XDG_CONFIG_HOME: xdg,
    });
    expect(fromXdg.code).toBe(0);

    const other = join(s.root, "other.json");
    writeFileSync(other, JSON.stringify({ other: "agy" }));
    const fromOverride = s.run(["spawn", "other", "--name", "X2", "--folder", s.folder("w2")], {
      HCX_AGENTS_FILE: other,
      XDG_CONFIG_HOME: xdg,
    });
    expect(fromOverride.code).toBe(0);

    const missing = s.run(["spawn", "xdger", "--name", "X3", "--folder", s.folder("w3")], {
      HCX_AGENTS_FILE: other,
      XDG_CONFIG_HOME: xdg,
    });
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.err).error.message).toContain("unknown agent");
  });

  test("a broken agents file does not break send, done or pass-through", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":1}\n' });
    s.answer("kill.t5", { out: "{}\n" });
    s.answer("rm.t5", { out: '{"removed":"t5"}\n' });
    const agents = join(s.root, "agents.json");
    writeFileSync(agents, "not json");
    const env = { HCX_AGENTS_FILE: agents };

    expect(s.run(["send", "--json", "Mira", "hello"], env).code).toBe(0);
    expect(s.run(["done", "Mira"], env).code).toBe(0);
    const get = s.run(["get", "Mira"], env);
    expect(get.code).toBe(0);
    expect(s.call("hc", "get")?.args).toEqual(["get", "t5"]);
  });

  test("--help lists configured agents and the file path", () => {
    const s = sandbox();
    const agents = join(s.root, "agents.json");
    writeFileSync(agents, JSON.stringify({ reviewer: "agy" }));

    const r = s.run(["spawn", "--help"], { HCX_AGENTS_FILE: agents });
    expect(r.code).toBe(0);
    expect(r.out).toContain("reviewer");
    expect(r.out).toContain("agy");
    expect(r.out).toContain(agents);
    expect(s.calls().length).toBe(0);
  });

  test("opencode --model still works alongside configured agents", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("herdr.do", { out: '{"tab":"tab9","terminal":"t90"}\n' });
    s.answer("opencode.model.list", { out: '{"data":[{"id":"m","providerID":"v","enabled":true,"variants":[]}]}\n' });
    s.answer("opencode.session.create", { out: '{"data":{"id":"ses_9"}}\n' });
    s.answer("opencode.session.switchModel", { out: "{}\n" });
    s.answer("opencode.session.list", { out: '{"data":[{"id":"ses_9","model":{"providerID":"v","id":"m"}}]}\n' });
    const agents = join(s.root, "agents.json");
    writeFileSync(agents, JSON.stringify({ reviewer: "agy", opencode: ["opencode", "--flag"] }));
    const folder = s.folder();

    const r = s.run(["spawn", "opencode", "--model", "v/m", "--name", "Kept", "--folder", folder, "--json"], {
      HCX_AGENTS_FILE: agents,
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ agent: "opencode", model: "v/m", session: "ses_9" });
    const tab = s.call("herdr-app", "do");
    expect(JSON.parse(tab!.args[tab!.args.indexOf("--argv") + 1])).toEqual(["opencode", "--session", "ses_9", "--flag"]);
  });
});

describe("hcx send timeout", () => {
  test("a hung hc send is killed and reports kind timeout without retrying", () => {
    const s = sandbox();
    s.answer("herdr.ls", { out: TABS });
    s.answer("hc.ls", { out: AGENTS });
    s.answer("hc.send", { out: '{"started":true,"status":"idle","turn":1}\n', delay: "500" });

    const r = s.run(["send", "--json", "Mira", "hello"], { HCX_SEND_TIMEOUT_MS: "50" });
    expect(r.code).toBe(1);
    const body = JSON.parse(r.err);
    expect(body.error.kind).toBe("timeout");
    expect(body.error.message).toContain("may have landed");
    expect(body.error.message).toContain("do not retry");
  });
});
