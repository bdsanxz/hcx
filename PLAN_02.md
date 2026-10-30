# PLAN_02: hcx 0.1.4 - refuse an unknown opencode model

Goal: `hcx spawn opencode --model provider/model [--variant level]` must refuse, before any session or tab is created, when the model (or variant) does not exist. Found in a live test on OpenCode 2.0.29: `--model vikey/no-such-model` created a session and opened a TUI on "no-such-model (unavailable)", because `session.switchModel` accepts anything and the `session.list` read-back only echoes what was stored.

## Facts

- `opencode api model.list` (run in any folder) prints `{"location":{...},"data":[{"id","modelID","providerID","variants":[{"id",...}],"enabled",...}, ...]}`. About 106 entries. **The output contains API keys for some providers: never print it, never log it, never put it in a test fixture or the report.** Parse it in code and keep only `providerID`, `id`, `enabled` and the `variants[].id` list.
- A valid model is an entry whose `providerID` and `id` match `--model provider/model`. A `--variant` is valid when it appears in that entry's `variants[].id`. Treat `enabled === false` as unavailable; a missing `enabled` field counts as available.

## Steps

1. Read `src/opencode.ts`, `src/lib.ts` (`parseModel`, `sessionModel`, `sameModel`), `src/spawn.ts`, `test/cli.test.ts` (the `hcx spawn opencode --model` block, `test/fake-tool.ts`), README, `ISSUES.md` (row 7 already exists).
2. In `src/opencode.ts`, before `session.create`, call `model.list` through the same `opencodeApi` helper (capture only; its stdout must never reach a message) and check the model exists and is enabled, and the variant exists when given. Refuse with a clear message that lists no provider data beyond what the user typed, for example `unknown opencode model "vikey/no-such-model"; run opencode and pick one with /models`, and `unknown variant "x" for vikey/deepseek-v4-flash; available: low, medium, high`. The variant list in that message is allowed (variant ids hold no secrets). No session and no tab may be created on refusal.
3. Put the pure matching in `src/lib.ts` as an exported helper (e.g. `checkModel(list, spec)` returning ok or a reason) so it is unit tested without opencode.
4. Tests: fake `model.list` JSON in tests contains only fake ids and NO key-like fields; cases: valid model, unknown model, unknown provider, disabled model, valid variant, unknown variant (message lists variants), model.list failing (service down), and that `session.create` is never called on refusal (recorded argv). Keep the existing tests passing; update the fake tool setup where the sequence of `opencode api` calls now starts with `model.list`.
5. README: describe that the model and variant are checked first. `ISSUES.md` row 7 -> `Fixed in 0.1.4`. Bump `package.json` to `0.1.4`.
6. `bunx tsc --noEmit`, `bun test`, `bun run build` twice and `bun run build:bin` twice (identical sha256 each). Real check, using only this exact pair of commands and printing only the exit code and the first line of stderr: `hcx`-built `node dist/hcx.js spawn opencode --model vikey/no-such-model --name plan02-probe --folder /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/model-probe` must exit non-zero and open no tab (`hc ls` must not show `plan02-probe`). Do not start any real agent.

## Rules for the worker

- Work only in `/Users/budisantoso/Dev/bdsanxz/SWE/hcx`. Read every file before changing it. Edit in place; never overwrite a file wholesale.
- All text in the codebase is English.
- No secrets anywhere (code, tests, logs, report). Never print `opencode api model.list` output; never run it from a shell command whose output you show.
- No commits, pushes, tags, releases or installs: the lead does those.
- Finish with `git diff --stat`.

## Report

Write the report (what changed, commands and outputs as printed, test counts, sha256 of dist/hcx.js and dist/hcx, open questions) to `/private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-plan02-hcx.md`, then run:
`hcx send Zytra "plan02-hcx done, report: /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-plan02-hcx.md"`
