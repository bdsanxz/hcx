import { spawnSync } from "node:child_process";
import { parseSpaces, parseTabs, type SpaceInfo, type TabInfo } from "./lib";

export function loadTabs(): TabInfo[] {
  try {
    const p = spawnSync("herdr-app", ["ls"], { encoding: "utf8" });
    return p.status === 0 ? parseTabs(JSON.parse(p.stdout)) : [];
  } catch {
    return []; // no Herdr app: plain addresses still work
  }
}

export function loadSpaces(): SpaceInfo[] {
  try {
    const p = spawnSync("herdr-app", ["ls"], { encoding: "utf8" });
    return p.status === 0 ? parseSpaces(JSON.parse(p.stdout)) : [];
  } catch {
    return [];
  }
}
