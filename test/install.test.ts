import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INSTALL = fileURLToPath(new URL("../install.sh", import.meta.url));

// The asset install.sh picks on this machine: the standalone binary on macOS
// arm64, the node bundle everywhere else.
const NATIVE_ASSET = process.platform === "darwin" && process.arch === "arm64" ? "hcx-darwin-arm64" : "hcx.js";

function fakeAsset(name: string): string {
  if (name === "hcx.js") return '#!/usr/bin/env node\nconsole.log("hcx \u2014 helper over hc for Herdr");\n';
  return '#!/bin/sh\nprintf "hcx \u2014 helper over hc for Herdr\\n"\n';
}

function sha256Hex(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

// A fake release: a directory with the asset and its SHA256SUMS, fetched via
// the HCX_BASE_URL test hook as file://<dir>.
function makeRelease(asset: string, body: string, sums?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hcx-fake-release-"));
  writeFileSync(join(dir, asset), body);
  chmodSync(join(dir, asset), 0o755);
  writeFileSync(join(dir, "SHA256SUMS"), sums ?? `${sha256Hex(body)}  ${asset}\n`);
  return dir;
}

function testEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.HCX_VERSION;
  delete env.HCX_INSTALL_DIR;
  delete env.HCX_FORCE;
  delete env.HCX_ASSET;
  delete env.HCX_BASE_URL;
  return Object.assign(env, extra);
}

function runInstaller(args: string[], extraEnv: Record<string, string>): { code: number; out: string; err: string } {
  const proc = Bun.spawnSync(["sh", INSTALL, ...args], {
    env: testEnv(extraEnv),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, out: proc.stdout?.toString() ?? "", err: proc.stderr?.toString() ?? "" };
}

describe("install.sh against a fake release", () => {
  test("installs the asset when the hash matches", () => {
    const body = fakeAsset(NATIVE_ASSET);
    const release = makeRelease(NATIVE_ASSET, body);
    const dir = mkdtempSync(join(tmpdir(), "hcx-install-"));
    const run = runInstaller(["--dir", dir], { HCX_BASE_URL: `file://${release}` });
    expect(run.code).toBe(0);
    expect(run.err).toContain(`installed ${dir}/hcx`);
    expect(run.err).toContain("not on PATH");
    expect(run.out).toContain("hcx \u2014 helper");
    expect(readFileSync(join(dir, "hcx"), "utf8")).toBe(body);
    expect(statSync(join(dir, "hcx")).mode & 0o111).not.toBe(0);
  });

  test("a hash mismatch refuses and leaves the old file untouched", () => {
    const release = makeRelease(NATIVE_ASSET, fakeAsset(NATIVE_ASSET), `${"0".repeat(64)}  ${NATIVE_ASSET}\n`);
    const dir = mkdtempSync(join(tmpdir(), "hcx-install-"));
    writeFileSync(join(dir, "hcx"), "old hcx\n");
    const run = runInstaller(["--dir", dir], { HCX_BASE_URL: `file://${release}` });
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("checksum mismatch");
    expect(readFileSync(join(dir, "hcx"), "utf8")).toBe("old hcx\n");
  });

  test("a foreign symlink needs --force", () => {
    const body = fakeAsset(NATIVE_ASSET);
    const release = makeRelease(NATIVE_ASSET, body);
    const dir = mkdtempSync(join(tmpdir(), "hcx-install-"));
    const target = join(dir, "dev-hcx");
    writeFileSync(target, "dev build\n");
    symlinkSync(target, join(dir, "hcx"));
    const refused = runInstaller(["--dir", dir], { HCX_BASE_URL: `file://${release}` });
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain("symlink");
    expect(refused.err).toContain(target);
    expect(lstatSync(join(dir, "hcx")).isSymbolicLink()).toBe(true);
    const forced = runInstaller(["--dir", dir, "--force"], { HCX_BASE_URL: `file://${release}` });
    expect(forced.code).toBe(0);
    expect(lstatSync(join(dir, "hcx")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, "hcx"), "utf8")).toBe(body);
  });

  test("hcx.js without node on PATH is a clear error", () => {
    const release = makeRelease("hcx.js", fakeAsset("hcx.js"));
    const base = { HCX_BASE_URL: `file://${release}`, HCX_ASSET: "hcx.js" };
    const dir = mkdtempSync(join(tmpdir(), "hcx-install-"));
    const plain = runInstaller(["--dir", dir], { ...base, PATH: "/usr/bin:/bin:/sbin" });
    expect(plain.code).not.toBe(0);
    expect(plain.err).toContain("node is required");
    expect(plain.err).not.toContain("--from-source");
    expect(existsSync(join(dir, "hcx"))).toBe(false);
    // With Bun around, the error points at --from-source instead.
    const bun = Bun.which("bun");
    if (bun) {
      const dir2 = mkdtempSync(join(tmpdir(), "hcx-install-"));
      const withBun = runInstaller(["--dir", dir2], { ...base, PATH: `${dirname(bun)}:/usr/bin:/bin:/sbin` });
      expect(withBun.code).not.toBe(0);
      expect(withBun.err).toContain("node is required");
      expect(withBun.err).toContain("--from-source");
      expect(existsSync(join(dir2, "hcx"))).toBe(false);
    }
  });
});
