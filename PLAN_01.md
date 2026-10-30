# PLAN_01: hcx 0.1.3 - honest version and delivery status, footer-free send, opencode model, cleanup

Goal: seven small improvements found in review. Do them in the order below; each step gets its own tests.

## Background

`hcx` is a helper over `hc` (herdr-core CLI). Read `README.md`, `PLAN.md`, `src/*.ts`, `test/*.ts` and `hcx --help` first. Facts seen in use:

- `hcx --version` is passed through to `hc` and prints `hc 0.1.15`, not the `hcx` version.
- `hcx send` prints `{"started":null,"status":null,"turn":0}` for tabs that run an opencode TUI or a plain shell, so a caller cannot tell "delivered" from "failed".
- `hcx spawn opencode` cannot choose a model. The working recipe by hand: create a session with `opencode api session.create -d '{"title":"<name>","location":{"directory":"<dir>"}}'` (run in the folder), then `opencode api session.switchModel --param sessionID=<id> -d '{"model":{"providerID":"<provider>","id":"<model>","variant":"<level>"}}'`, then start the TUI with `opencode --session <id>`. `session.get` fails on OpenCode 2.0.29 without a body, so read back with `opencode api session.list` and look for the id. A reference implementation lives in `/Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/roster/src/launch.ts` (`hcMemberArgv` and the `switchModel` block around line 169).
- Cleaning up an agent always takes `hcx kill <tab>` then `hcx rm <tab>`; `rm` refuses a live terminal.
- `hcx spawn` prints only free text (`spawned <name> (<terminal>, <agent>) · message it: hcx send <name> "..."`).

## Steps

1. Create `ISSUES.md` (table: `#`, reported, reporter, version, issue, status; format as in `/Users/budisantoso/Dev/bdsanxz/SWE/peers/ISSUES.md`) with one row per step below, reporter "owner review", status "In progress (0.1.3)".
2. **Version.** `hcx --version` and `hcx -V` print `hcx <version>` (from `package.json`) on the first line and `hc <version>` on the second. The version must not be read from a path at runtime that breaks in the compiled binary; check how `build` produces `dist/hcx` and `dist/hcx.js`, and make both work.
3. **Delivery status.** `hcx send ... --json` (and the default output) gains explicit fields next to the existing ones: `delivered` (true / false / null when unconfirmed), `route` (`hcx` untagged, `hc` tagged), `agent` (the target's agent kind from `hc get`/`hc ls`), and `note` when unconfirmed (for example "target is an opencode TUI or a shell; hc reports no turn status"). Keep every existing field and the exit code behavior unchanged.
4. **opencode model.** `hcx spawn opencode` accepts `--model provider/model` and `--variant level`. When given, do the session.create + switchModel recipe above, verify the model through `opencode api session.list`, start the TUI with `--session <id>`, and refuse with a clear message when the model is unknown or the OpenCode service is not running. Without `--model`, behavior is unchanged. Do not print provider settings: `opencode api model.list` output contains API keys for some providers, so never print or log that output; extract only what you need in code.
5. **Cleanup.** New `hcx done <tab>...`: kills each live terminal (ignoring one that already finished), then removes it, and prints one line per tab. Unknown tabs are reported, not fatal for the others. Add it to `--help` and README.
6. **Spawn JSON.** `hcx spawn ... --json` prints one JSON object (`name`, `terminal`, `agent`, `space`, `folder`, and `model`/`variant` when set) instead of the text line.
7. **Footer-free send.** `hcx send` gets `--no-footer` (alias `--raw`): the text goes untagged exactly as given, with no sender footer and no `<hc from>` tag (run `hc send` with `HC_TERMINAL_ID` removed from its environment, as `hcx send` already does for the footer variant). It must work for every target kind, including a plain shell, where it types exactly the given text and presses enter. Combine with `--wait`, `--if`, `--force`, `--json` and the delivery fields from step 3 (`route` becomes `hcx-raw`). Without the flag nothing changes. Tests: footer absent and tag absent in the recorded `hc send` argv/env; the flag works with `--if idle`; text containing a footer-like line is sent as is. Add one `ISSUES.md` row for it (reporter "owner request"). Document it in README and `--help`.
8. Update `ISSUES.md` rows to "Fixed in 0.1.3", bump `package.json` to `0.1.3`, update README (version, send output, spawn options, done) and `--help`.
9. Run `bunx tsc --noEmit`, `bun test`, and the project's build (see `package.json` scripts) twice; the outputs must be byte-identical. Also run the new binary by hand for `--version` and `done` on a throwaway terminal you start yourself (`hcx spawn muse --name plan01-probe --folder /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/plan01-probe`, create the folder first) and then remove it with `hcx done plan01-probe`. No other live agent sessions.

## Rules for the worker

- Work only in `/Users/budisantoso/Dev/bdsanxz/SWE/hcx`. Read every file before changing it. Edit files in place; never overwrite a file wholesale.
- All text in the codebase (strings, comments, help, README, tests) is English.
- No secrets in code, tests, logs or the report. Never print environment values or `opencode api model.list` output.
- Do not touch other terminals (`hcx ls` shows the user's other work). Stub `hc`/`opencode` in tests as the existing tests do.
- No commits, pushes, tags, releases or installs: the lead does those. Do not install over `~/.local/bin/hcx`.
- Finish with `git diff --stat`.

## Report

Write the report (what changed per step, commands run and their output as printed, test counts, sha256 of the build outputs, open questions) to `/private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-plan01-hcx.md`, then run:
`hcx send Zytra "plan01-hcx done, report: /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-plan01-hcx.md"`
