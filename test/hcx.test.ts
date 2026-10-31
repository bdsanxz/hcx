import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENTS,
  CAPABILITIES,
  CONTRACT_VERSION,
  HcxError,
  NOT_STARTED_NOTE,
  NO_STATUS_NOTE,
  OPENCODE_NOTE,
  QODER_NOTE,
  SEND_TIMEOUT_MS,
  TERMINAL_COMMANDS,
  agentOf,
  agentsFilePath,
  builtinAgents,
  checkModel,
  deliveryFields,
  firstPositional,
  formatTimeout,
  isAddress,
  knownAgents,
  loadAgentsFile,
  nameTaken,
  needsTabLookup,
  parseModel,
  parseSend,
  parseSpawn,
  parseSpaces,
  parseTabs,
  pickSpace,
  replyTarget,
  resolveArgs,
  resolveTarget,
  runArgs,
  sameModel,
  senderName,
  sendTimeoutMs,
  sessionModel,
  shellNote,
  spawnHelp,
  spawnUsage,
  withFooter,
} from "../src/lib";
import { isTimeoutError, sendTimeoutError } from "../src/passthrough";
import { resolveForegroundAgent } from "../src/herdr";

const ls = {
  spaces: [
    {
      tabs: [
        { name: "Vrax", terminals: [{ terminal: "t10", app: "claude-code" }] },
        { name: "Zytra", terminals: [{ terminal: "t4", app: null }, { terminal: "t3", app: "muse" }] },
        { name: "dup", terminals: [{ terminal: "t7" }] },
        { name: "123", terminals: [{ terminal: "t9" }] },
      ],
    },
    { tabs: [{ name: "dup", terminals: [{ terminal: "t8" }] }, { name: "empty", terminals: [] }] },
  ],
};
const tabs = parseTabs(ls);

describe("resolveTarget", () => {
  test("tab name, any case, picks the agent terminal", () => {
    expect(resolveTarget("zytra", tabs)).toBe("t3");
    expect(resolveTarget("Vrax", tabs)).toBe("t10");
  });
  test("unknown names and addresses pass through", () => {
    expect(resolveTarget("t42", tabs)).toBe("t42");
    expect(resolveTarget("machine/t42", tabs)).toBe("machine/t42");
    expect(resolveTarget("my-terminal", tabs)).toBe("my-terminal");
  });
  test("addresses and numeric names are never matched as tab names", () => {
    expect(resolveTarget("t10", tabs)).toBe("t10");
    expect(resolveTarget("123", tabs)).toBe("123");
  });
  test("ambiguous and empty tabs are refused", () => {
    expect(() => resolveTarget("dup", tabs)).toThrow(HcxError);
    expect(() => resolveTarget("empty", tabs)).toThrow(HcxError);
  });
});

describe("isAddress", () => {
  test("recognises terminal and machine addresses", () => {
    for (const address of ["t7", "t1b", "t2p", "machine/t7", "vps-1/t42"]) expect(isAddress(address)).toBe(true);
  });
  test("does not mistake names for addresses", () => {
    for (const name of ["Vrax", "t", "7", "T7", "machine/T7", "t-seven"]) expect(isAddress(name)).toBe(false);
  });
});

describe("firstPositional", () => {
  test("skips options and their values", () => {
    expect(firstPositional("get", ["--json", "Vrax"])).toBe(1);
    expect(firstPositional("read", ["--lines", "3", "Vrax"])).toBe(2);
    expect(firstPositional("attach", ["--history", "50", "Vrax"])).toBe(2);
    expect(firstPositional("wait", ["--output", "ready", "Zytra"])).toBe(2);
    expect(firstPositional("send", ["--if", "idle", "Vrax", "hello"])).toBe(2);
    expect(firstPositional("read", ["--lines=3", "Vrax"])).toBe(1);
  });
  test("handles no positional and the -- separator", () => {
    expect(firstPositional("get", [])).toBe(-1);
    expect(firstPositional("get", ["--json"])).toBe(-1);
    expect(firstPositional("get", ["--", "--json"])).toBe(1);
  });
});

describe("needsTabLookup", () => {
  test("only for terminal commands with a name-like target", () => {
    expect(needsTabLookup("get", ["Vrax"])).toBe(true);
    expect(needsTabLookup("get", ["unknown-name"])).toBe(true);
    expect(needsTabLookup("send", ["--wait", "Vrax", "hello"])).toBe(true);
    expect(needsTabLookup("get", ["t10"])).toBe(false);
    expect(needsTabLookup("get", ["123"])).toBe(false);
    expect(needsTabLookup("get", ["--json"])).toBe(false);
    expect(needsTabLookup("ls", ["Vrax"])).toBe(false);
    expect(needsTabLookup("run", ["Vrax"])).toBe(false);
  });
});

describe("resolveArgs", () => {
  test("resolves the first positional argument only", () => {
    expect(resolveArgs("get", ["--json", "zytra"], tabs)).toEqual(["--json", "t3"]);
    expect(resolveArgs("read", ["--lines", "3", "Vrax"], tabs)).toEqual(["--lines", "3", "t10"]);
    expect(resolveArgs("keys", ["Vrax", "Zytra", "enter"], tabs)).toEqual(["t10", "Zytra", "enter"]);
    expect(resolveArgs("label", ["Vrax", "k=v"], tabs)).toEqual(["t10", "k=v"]);
    expect(resolveArgs("send", ["--wait", "Vrax", "Zytra"], tabs)).toEqual(["--wait", "t10", "Zytra"]);
  });
  test("keeps addresses, numeric names, unknown names and non-terminal commands", () => {
    expect(resolveArgs("get", ["t10"], tabs)).toEqual(["t10"]);
    expect(resolveArgs("get", ["123"], tabs)).toEqual(["123"]);
    expect(resolveArgs("get", ["my-terminal"], tabs)).toEqual(["my-terminal"]);
    expect(resolveArgs("get", [], tabs)).toEqual([]);
    expect(resolveArgs("run", ["Vrax"], tabs)).toEqual(["Vrax"]);
  });
  test("supports the -- separator", () => {
    expect(resolveArgs("get", ["--", "Vrax"], tabs)).toEqual(["--", "t10"]);
  });
  test("propagates ambiguous and empty tabs", () => {
    expect(() => resolveArgs("get", ["dup"], tabs)).toThrow(HcxError);
    expect(() => resolveArgs("get", ["empty"], tabs)).toThrow(HcxError);
  });
  test("covers every terminal command", () => {
    for (const command of ["get", "attach", "read", "kill", "rm", "label", "keep", "keys", "interrupt", "wait", "put", "send"]) {
      expect(TERMINAL_COMMANDS.has(command)).toBe(true);
      expect(resolveArgs(command, ["Vrax"], tabs)).toEqual(["t10"]);
    }
    expect(TERMINAL_COMMANDS.has("run")).toBe(false);
  });
});

describe("runArgs", () => {
  test("adds --no-parent by default", () => {
    expect(runArgs([])).toEqual(["--no-parent"]);
    expect(runArgs(["--bg", "--name", "x", "sleep", "30"])).toEqual(["--no-parent", "--bg", "--name", "x", "sleep", "30"]);
  });
  test("respects an explicit parent choice", () => {
    expect(runArgs(["--parent", "t10", "sleep", "30"])).toEqual(["--parent", "t10", "sleep", "30"]);
    expect(runArgs(["--parent=t10", "sleep", "30"])).toEqual(["--parent=t10", "sleep", "30"]);
    expect(runArgs(["--no-parent", "sleep", "30"])).toEqual(["--no-parent", "sleep", "30"]);
  });
  test("ignores parent-looking program arguments after --", () => {
    expect(runArgs(["--", "--parent", "t10"])).toEqual(["--no-parent", "--", "--parent", "t10"]);
  });
});

describe("parseSend", () => {
  test("splits target and joins the rest as text", () => {
    expect(parseSend(["Vrax", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: [], raw: false, agentOnly: false });
    expect(parseSend(["Vrax", "hello", "world"])).toEqual({
      target: "Vrax",
      text: "hello world",
      flags: [],
      raw: false,
      agentOnly: false,
    });
    expect(parseSend(["Vrax", "Zytra"])).toEqual({ target: "Vrax", text: "Zytra", flags: [], raw: false, agentOnly: false });
  });
  test("takes hc send flags before the text", () => {
    expect(parseSend(["--wait", "--force", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--wait", "--force"],
      raw: false,
      agentOnly: false,
    });
    expect(parseSend(["Vrax", "--wait", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--wait"],
      raw: false,
      agentOnly: false,
    });
    expect(parseSend(["--json", "--if", "idle", "--timeout", "30", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--json", "--if", "idle", "--timeout", "30"],
      raw: false,
      agentOnly: false,
    });
    expect(parseSend(["--if=working", "--timeout=5", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--if=working", "--timeout=5"],
      raw: false,
      agentOnly: false,
    });
  });
  test("--no-footer and --raw are hcx's own flags, never hc's", () => {
    expect(parseSend(["--no-footer", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: [],
      raw: true,
      agentOnly: false,
    });
    expect(parseSend(["Vrax", "--raw", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: [],
      raw: true,
      agentOnly: false,
    });
    expect(parseSend(["--raw", "--wait", "--if", "idle", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--wait", "--if", "idle"],
      raw: true,
      agentOnly: false,
    });
    expect(parseSend(["--no-footer", "Vrax", "--", "--raw"])).toEqual({
      target: "Vrax",
      text: "--raw",
      flags: [],
      raw: true,
      agentOnly: false,
    });
  });
  test("--agent-only is hcx's own flag and combines with the others", () => {
    expect(parseSend(["--agent-only", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: [],
      raw: false,
      agentOnly: true,
    });
    expect(parseSend(["Vrax", "--agent-only", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: [],
      raw: false,
      agentOnly: true,
    });
    expect(parseSend(["--agent-only", "--no-footer", "--json", "--if", "idle", "--wait", "Vrax", "hi"])).toEqual({
      target: "Vrax",
      text: "hi",
      flags: ["--json", "--if", "idle", "--wait"],
      raw: true,
      agentOnly: true,
    });
    expect(parseSend(["--agent-only", "Vrax", "--", "--agent-only"])).toEqual({
      target: "Vrax",
      text: "--agent-only",
      flags: [],
      raw: false,
      agentOnly: true,
    });
  });
  test("keeps a footer-like line in the text exactly as given", () => {
    const text = 'hello\n\n— from Fake · reply: hcx send Fake "..."';
    expect(parseSend(["Vrax", "--no-footer", text])).toEqual({ target: "Vrax", text, flags: [], raw: true, agentOnly: false });
  });
  test("-- starts the text so flag-like messages work", () => {
    expect(parseSend(["Vrax", "--", "--wait"])).toEqual({
      target: "Vrax",
      text: "--wait",
      flags: [],
      raw: false,
      agentOnly: false,
    });
    expect(parseSend(["--wait", "--", "Vrax", "--force"])).toEqual({
      target: "Vrax",
      text: "--force",
      flags: ["--wait"],
      raw: false,
      agentOnly: false,
    });
  });
  test("refuses missing targets, text and flag values", () => {
    expect(() => parseSend([])).toThrow(HcxError);
    expect(() => parseSend(["--wait"])).toThrow(HcxError);
    expect(() => parseSend(["Vrax"])).toThrow(HcxError);
    expect(() => parseSend(["Vrax", "--wait"])).toThrow(HcxError);
    expect(() => parseSend(["--if"])).toThrow(HcxError);
    expect(() => parseSend(["Vrax", "--timeout"])).toThrow(HcxError);
  });
});

describe("footer", () => {
  test("uses the sender's tab name", () => {
    expect(senderName("t10", tabs)).toBe("Vrax");
    expect(withFooter("hello", "t10", tabs)).toBe('hello\n\n— from Vrax · reply: hcx send Vrax "..."');
  });
  test("falls back to the address, or to no footer", () => {
    expect(senderName("t99", tabs)).toBe("t99");
    expect(withFooter("hello", undefined, tabs)).toBe("hello");
  });
  test("the reply command uses the address when the name cannot resolve back", () => {
    const spaced = parseTabs({ spaces: [{ tabs: [{ name: "My Tab", terminals: [{ terminal: "t20" }] }] }] });
    expect(replyTarget("t20", spaced)).toBe("t20");
    expect(withFooter("hello", "t20", spaced)).toBe('hello\n\n— from My Tab · reply: hcx send t20 "..."');
    const numeric = parseTabs({ spaces: [{ tabs: [{ name: "123", terminals: [{ terminal: "t21" }] }] }] });
    expect(replyTarget("t21", numeric)).toBe("t21");
    const addressy = parseTabs({ spaces: [{ tabs: [{ name: "t7", terminals: [{ terminal: "t22" }] }] }] });
    expect(replyTarget("t22", addressy)).toBe("t22");
    expect(replyTarget("t99", tabs)).toBe("t99");
  });
  test("a twin name falls back to the address", () => {
    expect(replyTarget("t7", tabs)).toBe("t7");
    expect(withFooter("hello", "t7", tabs)).toBe('hello\n\n— from dup · reply: hcx send t7 "..."');
  });
});

describe("delivery fields", () => {
  test("a target that reports status confirms delivery", () => {
    expect(deliveryFields({ started: true, status: "idle", turn: 3 }, "muse", "hcx")).toEqual({
      delivered: true,
      route: "hcx",
      agent: "muse",
    });
    expect(deliveryFields({ started: false, status: "working", turn: 3 }, "muse", "hcx")).toEqual({
      delivered: false,
      route: "hcx",
      agent: "muse",
      note: NOT_STARTED_NOTE,
    });
  });
  test("no status leaves delivery unconfirmed, with a note naming the kind", () => {
    expect(deliveryFields({ started: null, status: null, turn: 0 }, "zsh", "hcx")).toEqual({
      delivered: null,
      route: "hcx",
      agent: "zsh",
      note: shellNote("zsh"),
    });
    expect(deliveryFields({ started: null, status: null, turn: 0 }, "zsh", "hcx", "vim")).toEqual({
      delivered: null,
      route: "hcx",
      agent: "zsh",
      program: "vim",
      note: shellNote("zsh"),
    });
    expect(deliveryFields({ started: null, status: null, turn: 0 }, "opencode", "hcx")).toEqual({
      delivered: null,
      route: "hcx",
      agent: "opencode",
      note: OPENCODE_NOTE,
    });
    expect(deliveryFields({ started: null, status: null, turn: 0 }, "qoder", "hcx")).toEqual({
      delivered: null,
      route: "hcx",
      agent: "qoder",
      note: QODER_NOTE,
    });
    expect(deliveryFields({}, null, "hcx-raw").note).toBe(NO_STATUS_NOTE);
    expect(deliveryFields({}, "muse", "hcx").note).toBe(NO_STATUS_NOTE);
  });
  test("the route says how the message was sent", () => {
    expect(deliveryFields({ started: true }, "muse", "hcx").route).toBe("hcx");
    expect(deliveryFields({ started: true }, "muse", "hcx-raw").route).toBe("hcx-raw");
  });
  test("agentOf reads the target's kind from hc ls, by address or name", () => {
    const agents = new Map([
      ["t10", "claude-code"],
      ["Lead", "claude-code"],
      ["lead", "claude-code"],
    ]);
    expect(agentOf(agents, "t10")).toBe("claude-code");
    expect(agentOf(agents, "lead")).toBe("claude-code");
    expect(agentOf(agents, "t99")).toBeNull();
  });
});

test("parseTabs survives missing data", () => {
  expect(parseTabs(null)).toEqual([]);
  expect(parseTabs({ spaces: [{}] })).toEqual([]);
});

describe("resolveForegroundAgent", () => {
  test("maps opencode and versioned qodercli to their agent kinds", () => {
    expect(resolveForegroundAgent("opencode")).toBe("opencode");
    expect(resolveForegroundAgent("qodercli")).toBe("qoder");
    expect(resolveForegroundAgent("qodercli-1.1.81")).toBe("qoder");
    expect(resolveForegroundAgent("QODERCLI-2")).toBe("qoder");
  });
  test("leaves anything else as a shell foreground", () => {
    for (const name of ["qodercliX", "qoder", "zsh", "vim", ""]) expect(resolveForegroundAgent(name)).toBeNull();
  });
});

describe("parseSpawn", () => {
  test("passes agent flags through", () => {
    expect(parseSpawn(["muse", "--yolo"]).argv).toEqual(["muse", "--yolo"]);
    expect(parseSpawn(["opencode"]).argv).toEqual(["opencode"]);
    expect(parseSpawn(["pi"]).argv).toEqual(["pi"]);
  });
  test("fixes the singular permission flag for claude", () => {
    expect(parseSpawn(["claude", "--dangerously-skip-permission"]).argv).toEqual(["claude", "--dangerously-skip-permissions"]);
  });
  test("takes hcx's own options and keeps the rest for the agent", () => {
    const plan = parseSpawn(["claude", "--name", "Audit", "-C", "/tmp/x", "--task", "check", "--model", "opus"]);
    expect(plan).toEqual({ agent: "claude", argv: ["claude", "--model", "opus"], name: "Audit", folder: "/tmp/x", task: "check" });
  });
  test("opencode takes --model and --variant as hcx's own", () => {
    const plan = parseSpawn(["opencode", "--model", "anthropic/x", "--variant", "high", "--name", "Probe", "--json"]);
    expect(plan).toEqual({
      agent: "opencode",
      argv: ["opencode"],
      name: "Probe",
      model: "anthropic/x",
      variant: "high",
      json: true,
    });
  });
  test("values take a space or =, and keep extra agent flags outside the model", () => {
    expect(parseSpawn(["muse", "--name=Audit", "--space=SWE", "--folder=/tmp/x", "--task=check"]).name).toBe("Audit");
    const plan = parseSpawn(["opencode", "--model=v/w", "--variant=high", "--name", "Probe"]);
    expect(plan).toEqual({ agent: "opencode", argv: ["opencode"], name: "Probe", model: "v/w", variant: "high" });
  });
  test("a value starting with - is refused", () => {
    for (const args of [
      ["muse", "--name", "--json"],
      ["muse", "--space", "--json"],
      ["pi", "--folder", "--name"],
      ["opencode", "--model", "--variant"],
      ["opencode", "--model=v/w", "--variant", "--json"],
    ]) {
      expect(() => parseSpawn(args)).toThrow(HcxError);
    }
  });
  test("names that cannot resolve are refused", () => {
    for (const name of ["t7", "t1b", "machine/t7", "123", "My Tab", "a b"]) {
      expect(() => parseSpawn(["muse", "--name", name])).toThrow(/must not look like/);
    }
    expect(parseSpawn(["muse", "--name", "Audit"]).name).toBe("Audit");
  });
  test("--variant needs --model", () => {
    expect(() => parseSpawn(["opencode", "--variant", "high"])).toThrow(/--variant needs --model/);
  });
  test("-- hands everything after it to the agent", () => {
    expect(parseSpawn(["muse", "--", "--name", "x"]).argv).toEqual(["muse", "--name", "x"]);
  });
  test("refuses unknown agents and missing values", () => {
    expect(() => parseSpawn(["gemini"])).toThrow(HcxError);
    expect(() => parseSpawn([])).toThrow(HcxError);
    expect(() => parseSpawn(["muse", "--name"])).toThrow(HcxError);
    expect(() => parseSpawn(["opencode", "--model"])).toThrow(HcxError);
  });
});

describe("opencode model", () => {
  test("parseModel splits provider and model at the first slash", () => {
    expect(parseModel("anthropic/claude-sonnet-4")).toEqual({ providerID: "anthropic", id: "claude-sonnet-4" });
    expect(parseModel("openrouter/anthropic/claude-3.5")).toEqual({ providerID: "openrouter", id: "anthropic/claude-3.5" });
  });
  test("parseModel refuses a spec without a provider or a model", () => {
    for (const spec of ["", "anthropic", "anthropic/", "/x"]) expect(() => parseModel(spec)).toThrow(HcxError);
  });
  test("sessionModel reads the session.list entry, defaulting the variant", () => {
    const listed = {
      data: [
        { id: "ses_a", model: { providerID: "vikey", id: "deepseek-v4-flash", variant: "high" } },
        { id: "ses_b", model: { providerID: "vikey", id: "deepseek-v4-flash" } },
      ],
    };
    expect(sessionModel(listed, "ses_a")).toEqual({ providerID: "vikey", id: "deepseek-v4-flash", variant: "high" });
    expect(sessionModel(listed, "ses_b")).toEqual({ providerID: "vikey", id: "deepseek-v4-flash", variant: "default" });
    expect(sessionModel(listed, "ses_missing")).toBeNull();
    expect(sessionModel(null, "ses_a")).toBeNull();
  });
  test("sameModel compares the model, and the variant when one was asked for", () => {
    const found = { providerID: "vikey", id: "deepseek-v4-flash", variant: "high" };
    expect(sameModel(found, { providerID: "vikey", id: "deepseek-v4-flash", variant: "high" })).toBe(true);
    expect(sameModel(found, { providerID: "vikey", id: "deepseek-v4-flash" })).toBe(true);
    expect(sameModel(found, { providerID: "vikey", id: "deepseek-v4-flash", variant: "default" })).toBe(false);
    expect(sameModel(found, { providerID: "vikey", id: "other" })).toBe(false);
    expect(sameModel(found, { providerID: "other", id: "deepseek-v4-flash" })).toBe(false);
  });
  test("checkModel accepts a model that exists, with or without a variant", () => {
    const list = {
      data: [
        { id: "deepseek-v4-flash", providerID: "vikey", enabled: true, variants: [{ id: "low" }, { id: "medium" }, { id: "high" }] },
        { id: "deepseek-r1", providerID: "vikey", variants: [{ id: "base" }] },
      ],
    };
    expect(checkModel(list, { providerID: "vikey", id: "deepseek-v4-flash", variant: "high" })).toEqual({ ok: true });
    expect(checkModel(list, { providerID: "vikey", id: "deepseek-v4-flash" })).toEqual({ ok: true });
    // A missing `enabled` field counts as available.
    expect(checkModel(list, { providerID: "vikey", id: "deepseek-r1", variant: "base" })).toEqual({ ok: true });
  });
  test("checkModel refuses unknown models and providers, naming only what was asked", () => {
    const list = { data: [{ id: "deepseek-v4-flash", providerID: "vikey", enabled: true, variants: [] }] };
    expect(checkModel(list, { providerID: "vikey", id: "no-such-model" })).toEqual({
      ok: false,
      reason: 'unknown opencode model "vikey/no-such-model"; run opencode and pick one with /models',
    });
    expect(checkModel(list, { providerID: "nope", id: "deepseek-v4-flash" })).toEqual({
      ok: false,
      reason: 'unknown opencode model "nope/deepseek-v4-flash"; run opencode and pick one with /models',
    });
    expect(checkModel(null, { providerID: "vikey", id: "deepseek-v4-flash" }).ok).toBe(false);
    expect(checkModel({}, { providerID: "vikey", id: "deepseek-v4-flash" }).ok).toBe(false);
  });
  test("checkModel refuses a disabled model", () => {
    const list = { data: [{ id: "claude-sonnet-4", providerID: "anthropic", enabled: false, variants: [] }] };
    expect(checkModel(list, { providerID: "anthropic", id: "claude-sonnet-4" })).toEqual({
      ok: false,
      reason: 'opencode model "anthropic/claude-sonnet-4" is disabled; run opencode and enable it first',
    });
  });
  test("checkModel refuses an unknown variant and lists the valid ids", () => {
    const list = { data: [{ id: "deepseek-v4-flash", providerID: "vikey", enabled: true, variants: [{ id: "low" }, { id: "medium" }, { id: "high" }] }] };
    expect(checkModel(list, { providerID: "vikey", id: "deepseek-v4-flash", variant: "max" })).toEqual({
      ok: false,
      reason: 'unknown variant "max" for vikey/deepseek-v4-flash; available: low, medium, high',
    });
    const bare = { data: [{ id: "deepseek-r1", providerID: "vikey", variants: [] }] };
    expect(checkModel(bare, { providerID: "vikey", id: "deepseek-r1", variant: "base" })).toEqual({
      ok: false,
      reason: 'unknown variant "base" for vikey/deepseek-r1; available: none',
    });
  });
});

describe("HcxError kinds and exit codes", () => {
  test("usage is 2, not_found is 3, plain_shell is 4, anything else is 1", () => {
    expect(new HcxError("x", { kind: "usage" }).exitCode).toBe(2);
    expect(new HcxError("x", { kind: "not_found" }).exitCode).toBe(3);
    expect(new HcxError("x", { kind: "plain_shell" }).exitCode).toBe(4);
    expect(new HcxError("x", { kind: "ambiguous" }).exitCode).toBe(1);
    expect(new HcxError("x", { kind: "timeout" }).exitCode).toBe(1);
    expect(new HcxError("x").exitCode).toBe(1);
    expect(new HcxError("x").kind).toBe("error");
  });
  test("parsers report usage, ambiguity and not_found", () => {
    try {
      parseSend([]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HcxError);
      expect((e as HcxError).kind).toBe("usage");
      expect((e as HcxError).exitCode).toBe(2);
    }
    try {
      resolveTarget("dup", tabs);
      expect.unreachable();
    } catch (e) {
      expect((e as HcxError).kind).toBe("ambiguous");
    }
    try {
      pickSpace("nope", "t3", parseSpaces({ spaces: [] }));
      expect.unreachable();
    } catch (e) {
      expect((e as HcxError).kind).toBe("not_found");
      expect((e as HcxError).exitCode).toBe(3);
    }
  });
});

describe("nameTaken", () => {
  test("finds a tab by name, any case", () => {
    expect(nameTaken("vrax", tabs)?.terminals).toEqual(["t10"]);
    expect(nameTaken("ZYTRA", tabs)?.name).toBe("Zytra");
  });
  test("is undefined for a free name", () => {
    expect(nameTaken("Kryx", tabs)).toBeUndefined();
  });
});

describe("pickSpace", () => {
  const spaces = parseSpaces({
    spaces: [
      { id: "spA", name: "SWE", tabs: [{ terminals: [{ terminal: "t3" }] }] },
      { id: "spB", name: "squad", tabs: [{ terminals: [{ terminal: "t5w" }, { terminal: "t65" }] }] },
    ],
  });
  test("--space by name (any case) or id", () => {
    expect(pickSpace("swe", "t5w", spaces)).toBe("spA");
    expect(pickSpace("spB", undefined, spaces)).toBe("spB");
  });
  test("defaults to the caller's space", () => {
    expect(pickSpace(undefined, "t5w", spaces)).toBe("spB");
    expect(pickSpace(undefined, "t3", spaces)).toBe("spA");
  });
  test("unknown caller leaves it to Herdr", () => {
    expect(pickSpace(undefined, undefined, spaces)).toBeUndefined();
    expect(pickSpace(undefined, "t99", spaces)).toBeUndefined();
  });
  test("unknown or ambiguous --space is an error", () => {
    expect(() => pickSpace("nope", "t3", spaces)).toThrow(/no space/);
    const dup = [...spaces, { id: "spC", name: "swe", terminals: [] }];
    expect(() => pickSpace("SWE", undefined, dup)).toThrow(/ambiguous/);
  });
  test("parseSpawn reads --space", () => {
    expect(parseSpawn(["pi", "--space", "SWE"]).space).toBe("SWE");
  });
});

describe("machine contract", () => {
  test("contract version and capabilities are stable", () => {
    expect(CONTRACT_VERSION).toBe(1);
    expect(CAPABILITIES).toEqual(["no-footer", "agent-only", "json-delivery"]);
  });
});

describe("spawn agents config", () => {
  test("defaults include agy and qoder with their commands", () => {
    expect(AGENTS.agy).toBe("agy");
    expect(AGENTS.qoder).toBe("qodercli");
    expect(parseSpawn(["agy", "--yolo"]).argv).toEqual(["agy", "--yolo"]);
    expect(parseSpawn(["qoder"]).argv).toEqual(["qodercli"]);
    expect(() => parseSpawn(["kiro-cli"])).toThrow(/unknown agent/);
  });

  test("agentsFilePath honours HCX_AGENTS_FILE", () => {
    const saved = process.env.HCX_AGENTS_FILE;
    try {
      process.env.HCX_AGENTS_FILE = "/tmp/custom-agents.json";
      expect(agentsFilePath()).toBe("/tmp/custom-agents.json");
    } finally {
      if (saved === undefined) delete process.env.HCX_AGENTS_FILE;
      else process.env.HCX_AGENTS_FILE = saved;
    }
  });

  test("agentsFilePath falls back to XDG_CONFIG_HOME then ~/.config", () => {
    const savedFile = process.env.HCX_AGENTS_FILE;
    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedHome = process.env.HOME;
    try {
      delete process.env.HCX_AGENTS_FILE;
      process.env.XDG_CONFIG_HOME = "/tmp/xdg";
      expect(agentsFilePath()).toBe("/tmp/xdg/hcx/agents.json");
      delete process.env.XDG_CONFIG_HOME;
      process.env.HOME = "/tmp/home";
      expect(agentsFilePath()).toBe("/tmp/home/.config/hcx/agents.json");
    } finally {
      if (savedFile === undefined) delete process.env.HCX_AGENTS_FILE;
      else process.env.HCX_AGENTS_FILE = savedFile;
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
    }
  });

  test("a missing agents file is fine", () => {
    const dir = mkdtempSync(join(tmpdir(), "hcx-agents-"));
    expect(loadAgentsFile(join(dir, "no-such-file.json"))).toEqual({});
  });

  test("string and array commands read as argv prefixes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hcx-agents-"));
    const file = join(dir, "agents.json");
    writeFileSync(file, JSON.stringify({ reviewer: "agy", builder: ["qodercli", "--some-flag"] }));
    expect(loadAgentsFile(file)).toEqual({ reviewer: ["agy"], builder: ["qodercli", "--some-flag"] });
  });

  test("each malformed case errors with the path and the key", () => {
    const dir = mkdtempSync(join(tmpdir(), "hcx-agents-"));
    const cases: [string, string, RegExp][] = [
      ["not json at all", "not json", /not JSON/],
      ['["agy"]', "array", /must be a JSON object/],
      ['"agy"', "string", /must be a JSON object/],
      ['{"Bad_Name": "agy"}', "name", /Bad_Name/],
      ['{"": "agy"}', "empty-name", /bad agent name/],
      ['{"reviewer": ""}', "reviewer", /reviewer/],
      ['{"reviewer": []}', "reviewer", /reviewer/],
      ['{"reviewer": ["agy", ""]}', "reviewer", /reviewer/],
      ['{"reviewer": ["agy", 3]}', "reviewer", /reviewer/],
      ['{"reviewer": 3}', "reviewer", /reviewer/],
      ['{"reviewer": null}', "reviewer", /reviewer/],
      ['{"reviewer": {"cmd": "agy"}}', "reviewer", /reviewer/],
    ];
    for (const [body, label, key] of cases) {
      const file = join(dir, `agents-${label}.json`);
      writeFileSync(file, body);
      try {
        loadAgentsFile(file);
        expect.unreachable(`expected ${label} to throw`);
      } catch (e) {
        expect(e).toBeInstanceOf(HcxError);
        expect((e as HcxError).kind).toBe("usage");
        expect((e as Error).message).toContain(file);
        expect((e as Error).message).toMatch(key);
      }
    }
  });

  test("configured agents merge over the built-ins", () => {
    const dir = mkdtempSync(join(tmpdir(), "hcx-agents-"));
    const file = join(dir, "agents.json");
    writeFileSync(file, JSON.stringify({ reviewer: "agy", muse: ["muse", "--flag"] }));
    const saved = process.env.HCX_AGENTS_FILE;
    try {
      process.env.HCX_AGENTS_FILE = file;
      const known = knownAgents();
      expect(known.reviewer).toEqual(["agy"]);
      expect(known.muse).toEqual(["muse", "--flag"]);
      expect(known.pi).toEqual(["pi"]);
    } finally {
      if (saved === undefined) delete process.env.HCX_AGENTS_FILE;
      else process.env.HCX_AGENTS_FILE = saved;
    }
  });

  test("parseSpawn runs configured agents and overridden built-ins", () => {
    const known = { ...builtinAgents(), reviewer: ["agy"], builder: ["qodercli", "--some-flag"], muse: ["muse", "--flag"] };
    expect(parseSpawn(["reviewer", "--yolo"], known).argv).toEqual(["agy", "--yolo"]);
    expect(parseSpawn(["builder", "--", "--yolo"], known).argv).toEqual(["qodercli", "--some-flag", "--yolo"]);
    expect(parseSpawn(["muse", "--name", "Audit"], known).argv).toEqual(["muse", "--flag"]);
    expect(parseSpawn(["opencode", "--model", "v/w"], known)).toEqual({
      agent: "opencode",
      argv: ["opencode"],
      model: "v/w",
    });
    expect(() => parseSpawn(["gemini"], known)).toThrow(/unknown agent "gemini"; known: .*reviewer/);
  });

  test("usage and help list the known agents and the file path", () => {
    const known = { ...builtinAgents(), reviewer: ["agy"] };
    expect(spawnUsage(known)).toContain("reviewer");
    const help = spawnHelp(known, "/tmp/custom-agents.json");
    expect(help).toContain("reviewer");
    expect(help).toContain("/tmp/custom-agents.json");
  });
});

describe("send timeout", () => {
  test("defaults to 30 s and formats durations", () => {
    delete process.env.HCX_SEND_TIMEOUT_MS;
    expect(SEND_TIMEOUT_MS).toBe(30000);
    expect(sendTimeoutMs()).toBe(30000);
    expect(formatTimeout(30000)).toBe("30 s");
    expect(formatTimeout(50)).toBe("50 ms");
  });
  test("a timeout error is kind timeout and warns against retrying", () => {
    const e = sendTimeoutError(30000);
    expect(e).toBeInstanceOf(HcxError);
    expect(e.kind).toBe("timeout");
    expect(e.exitCode).toBe(1);
    expect(e.message).toContain("may have landed");
    expect(e.message).toContain("do not retry");
    expect(isTimeoutError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTimeoutError(new Error("spawnSync hc ETIMEDOUT"))).toBe(true);
    expect(isTimeoutError(new Error("boom"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
