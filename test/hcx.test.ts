import { describe, expect, test } from "bun:test";
import {
  HcxError,
  TERMINAL_COMMANDS,
  firstPositional,
  isAddress,
  nameTaken,
  needsTabLookup,
  parseSend,
  parseSpawn,
  parseTabs,
  resolveArgs,
  resolveTarget,
  runArgs,
  senderName,
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
    expect(parseSend(["Vrax", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: [] });
    expect(parseSend(["Vrax", "hello", "world"])).toEqual({ target: "Vrax", text: "hello world", flags: [] });
    expect(parseSend(["Vrax", "Zytra"])).toEqual({ target: "Vrax", text: "Zytra", flags: [] });
  });
  test("takes hc send flags before the text", () => {
    expect(parseSend(["--wait", "--force", "Vrax", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: ["--wait", "--force"] });
    expect(parseSend(["Vrax", "--wait", "hello"])).toEqual({ target: "Vrax", text: "hello", flags: ["--wait"] });
    expect(parseSend(["--json", "--if", "idle", "--timeout", "30", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--json", "--if", "idle", "--timeout", "30"],
    });
    expect(parseSend(["--if=working", "--timeout=5", "Vrax", "hello"])).toEqual({
      target: "Vrax",
      text: "hello",
      flags: ["--if=working", "--timeout=5"],
    });
  });
  test("-- starts the text so flag-like messages work", () => {
    expect(parseSend(["Vrax", "--", "--wait"])).toEqual({ target: "Vrax", text: "--wait", flags: [] });
    expect(parseSend(["--wait", "--", "Vrax", "--force"])).toEqual({ target: "Vrax", text: "--force", flags: ["--wait"] });
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
  test("-- hands everything after it to the agent", () => {
    expect(parseSpawn(["muse", "--", "--name", "x"]).argv).toEqual(["muse", "--name", "x"]);
  });
  test("refuses unknown agents and missing values", () => {
    expect(() => parseSpawn(["gemini"])).toThrow(HcxError);
    expect(() => parseSpawn([])).toThrow(HcxError);
    expect(() => parseSpawn(["muse", "--name"])).toThrow(HcxError);
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
