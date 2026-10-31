# PLAN_06: hcx 0.4.0 - configurable spawn agents

Source: task file `task-hcx-agents.md` (read it, then `README.md`, `ISSUES.md`, `src/*.ts`, `test/*.ts`).

Steps, each with tests:
1. ISSUES.md row (reporter "owner request", version 0.3.0, "Fixed in 0.4.0").
2. Built-ins add `agy` (runs `agy`) and `qoder` (runs `qodercli`); opencode `--model`/`--variant` stays tied to the agent name `opencode`.
3. Agents file `$HCX_AGENTS_FILE`, else `${XDG_CONFIG_HOME:-~/.config}/hcx/agents.json`; missing file is fine; entries add agents and override same-named built-ins; string or non-empty string-array commands.
4. Malformed files throw usage errors naming the path and the offending name; only `spawn` reads the file.
5. `spawn --help` lists known agents and the resolved file path; README documents the format with one example; bump to 0.4.0.

## Rules
- Work only in /Users/budisantoso/Dev/bdsanxz/SWE/hcx. Read each file before editing; edit in place. English only. No secrets. No live agent sessions or real terminal messaging (stub as existing tests do). No commits, pushes, tags, installs.
- Run `bun test`, `bun run typecheck`, `bun run build`, `git diff --stat`.
