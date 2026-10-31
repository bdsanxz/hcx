# PLAN_05: hcx 0.3.0 - guard and machine contract for callers

Source: review report /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-review-peers-agentshell.md (Part 3 "hcx changes needed first"). Read it, then `README.md`, `ISSUES.md`, `src/*.ts`, `test/*.ts`.

Steps, each with tests:
1. ISSUES.md rows (reporter "owner review", version 0.2.0, "In progress (0.3.0)").
2. `hcx send --agent-only`: look up the target kind FIRST (also with `--no-footer`), refuse a plain shell or unknown kind before anything is sent. Combine with `--json`, `--if`, `--wait`.
3. Error kind `plain_shell` (not `usage`) for the shell refusal, with its own exit code (4); document in README/--help and keep it stable. Check existing exit codes first to avoid a clash.
4. Timeout on the `hc send` call (30 s default, `--timeout` still means the wait timeout; add a clear separate behaviour: on kill report `{"error":{"kind":"timeout",...}}` and note the message may have landed, never retry).
5. Raw sends (`--no-footer`) to a terminal address skip `herdr-app ls` (no sender name or resolution needed).
6. Machine contract: `hcx --version --json` prints `{"hcx":"<v>","hc":"<v>","contract":1,"capabilities":["no-footer","agent-only","json-delivery"]}`; document the `send --json` fields as a versioned interface in README.
7. Bump to 0.3.0, README, ISSUES "Fixed in 0.3.0".

## Rules
- Work only in /Users/budisantoso/Dev/bdsanxz/SWE/hcx. Read each file before editing; edit in place. English only. No secrets. No live agent sessions or real terminal messaging (stub as existing tests do). No commits, pushes, tags, installs.
- Run `bunx tsc --noEmit`, `bun test`, both builds twice (identical, report sha256 of dist/hcx and dist/hcx.js), `git diff --stat`.
- Write report to /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-hx05.md then: `hcx send --no-footer Zytra "hx05 done, report: /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-hx05.md"`
