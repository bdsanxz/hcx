import { describe, expect, test } from "bun:test";
import {
  HcxError,
  NO_STATUS_NOTE,
  TERMINAL_COMMANDS,
  agentOf,
  checkModel,
  deliveryFields,
  firstPositional,
  isAddress,
  nameTaken,
  needsTabLookup,
  parseModel,
  parseSend,
  parseSpawn,
  parseSpaces,
  parseTabs,
  pickSpace,
  resolveArgs,
  resolveTarget,
  runArgs,
  sameModel,
  senderName,
  sessionModel,
  withFooter,
} from "../src/lib";

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
    expect(parseSend(["Vrax", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: [], raw: false });
    expect(parseSend(["Vrax", "hello", "world"])).toEqual({ target: "Vrax", text: "hello world", flags: [], raw: false });
    expect(parseSend(["Vrax", "Zytra"])).toEqual({ target: "Vrax", text: "Zytra", flags: [], raw: false });
  });
  test("takes hc send flags before the text", () => {
    expect(parseSend(["--wait", "--force", "Vrax", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: ["--wait", "--force"], raw: false });
    expect(parseSend(["Vrax", "--wait", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: ["--wait"], raw: false });
    expect(parseSend(["--json", "--if", "idle", "--timeout", "30", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--json", "--if", "idle", "--timeout", "30"],
      raw: false,
    });
    expect(parseSend(["--if=working", "--timeout=5", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--if=working", "--timeout=5"],
      raw: false,
    });
  });
  test("--no-footer and --raw are hcx's own flags, never hc's", () => {
    expect(parseSend(["--no-footer", "Vrax", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: [], raw: true });
    expect(parseSend(["Vrax", "--raw", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: [], raw: true });
    expect(parseSend(["--raw", "--wait", "--if", "idle", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--wait", "--if", "idle"],
      raw: true,
    });
    expect(parseSend(["--no-footer", "Vrax", "--", "--raw"])).toEqual({ target: "Vrax", text: "--raw", flags: [], raw: true });
  });
  test("keeps a footer-like line in the text exactly as given", () => {
    const text = 'hello\n\n— from Fake · reply: hcx send Fake "..."';
    expect(parseSend(["Vrax", "--no-footer", text])).toEqual({ target: "Vrax", text, flags: [], raw: true });
  });
  test("-- starts the text so flag-like messages work", () => {
    expect(parseSend(["Vrax", "--", "--wait"])).toEqual({ target: "Vrax", text: "--wait", flags: [], raw: false });
    expect(parseSend(["--wait", "--", "Vrax", "--force"])).toEqual({ target: "Vrax", text: "--force", flags: ["--wait"], raw: false });
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
});

describe("delivery fields", () => {
  test("a target that reports status confirms delivery", () => {
    expect(deliveryFields({ started: true, status: "idle", turn: 3 }, "muse", "hcx")).toEqual({
      delivered: true,
      route: "hcx",
      agent: "muse",
    });
    expect(deliveryFields({ started: false, status: "working", turn: 3 }, "muse", "hcx").delivered).toBe(false);
  });
  test("no status leaves delivery unconfirmed, with a note", () => {
    expect(deliveryFields({ started: null, status: null, turn: 0 }, "zsh", "hcx")).toEqual({
      delivered: null,
      route: "hcx",
      agent: "zsh",
      note: NO_STATUS_NOTE,
    });
    expect(deliveryFields({}, null, "hcx-raw").note).toBe(NO_STATUS_NOTE);
  });
  test("the route says how the message was sent", () => {
    expect(deliveryFields({ started: true }, "muse", "hcx").route).toBe("hcx");
    expect(deliveryFields({ started: true }, "muse", "hc").route).toBe("hc");
    expect(deliveryFields({ started: true }, "muse", "hcx-raw").route).toBe("hcx-raw");
  });
  test("agentOf reads the target's kind from hc ls", () => {
    const agents = new Map([["t10", "claude-code"]]);
    expect(agentOf(agents, "t10")).toBe("claude-code");
    expect(agentOf(agents, "t99")).toBeNull();
  });
});

test("parseTabs survives missing data", () => {
  expect(parseTabs(null)).toEqual([]);
  expect(parseTabs({ spaces: [{}] })).toEqual([]);
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
