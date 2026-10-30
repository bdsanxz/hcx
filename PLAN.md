# Plan: porting all `hc` commands to `hcx`

Goal: `hcx` becomes a full wrapper over `hc`. Everything `hc` can do works through `hcx`, with a few improvements to make it more flexible. `hcx` stays a single binary (bun, `bun build --compile`). Code lives in `src/`, tests in `test/`; run `bun test`, `bun run typecheck`, `bun run build`, `bun run install:local`.

## Behavior

1. **Pass through every command.** `hcx <command> [args...]` runs `hc <command> [args...]` as-is (inherited stdio, exit code forwarded, including bare `hc` with no arguments opening the interactive picker). Current `hc` commands: `run ls get attach read kill rm label keep send keys interrupt wait put exec file templates events server update machine connect schema`, plus `--help`, `-V`/`--version`, `--licenses`. Unknown commands are forwarded too, so `hc` reports the error.
2. **Tab names wherever `<terminal>` is accepted.** For `get attach read kill rm label keep keys interrupt wait put send`: the first positional argument that is NOT an address (`t7`, `t1b`, `machine/t7`) and matches exactly (case-insensitively) the name of a tab in `herdr-app ls` is replaced with that tab's agent terminal address (or its first terminal when it has no agent). Twin tab names: clear error asking for an address. A name matching no tab is left alone (terminal names from `hc run --name` keep working). Tab names made only of digits are never matched. `herdr-app ls` is only called when needed.
3. **`hcx run` with no parent by default.** When the arguments contain neither `--parent` nor `--no-parent`, add `--no-parent`, so an agent running `hcx run` does not become the parent of the new terminal. An explicit user `--parent X` is still honored. The rest is forwarded to `hc run`.
4. **`hcx send`** (already exists): no `<hc from>` tag, with footer, tab-name resolution. Also support hc send options before the text: `--wait`, `--force`, `--json`, `--if <idle|working>`, `--timeout <seconds>`. The text stays the remaining arguments joined together. Note in README: `--wait` does not link the reply turn because the caller is cleared.
5. **`hcx spawn`** (already exists): unchanged.
6. **`hcx` with no arguments / `--help`**: show the hcx help describing send, spawn, run, tab-name resolution, then "every other hc command is forwarded". Exit code 0.
7. **Errors:** `hc` failures are not swallowed; their exit code and stderr appear as-is.

## Code structure

- `src/lib.ts`: add pure functions `resolveArgs(command, args, tabs)` (point 2), `runArgs(args)` (point 3), `parseSend(args)` (point 4), constant `TERMINAL_COMMANDS`, `isAddress(s)`.
- `src/passthrough.ts`: runs `hc` with inherited stdio.
- `src/main.ts`: `send`, `spawn`, `run` dispatcher, otherwise passthrough with name resolution.
- New unit tests for every pure function; README updated.

## Done criteria (verified from the outside, without reading code)

- `bun test`, `bun run typecheck`, `bun run build`, `bun run install:local` are green.
- `hcx ls --json` produces the same output as `hc ls --json` (apart from time-varying fields).
- `hcx read <tab-name> --lines 3` and `hcx get <tab-name>` work with a real tab name; `hcx get t10` keeps working; twin tab names are refused.
- `hcx run --bg --name hcx-par-test sleep 30` from an agent terminal produces a terminal with null `parent` in `hc ls --json`; with `--parent t10` its parent is `t10`. Clean up with `hcx kill`.
- `hcx send <tab-name> "..."` to an agent arrives plain with a footer; `hcx send --wait` and `--force` flags are accepted.
- Bare `hcx` prints help; `hcx --version` prints the `hc` version; `hcx command-unknown` forwards the `hc` error.
- No files deleted outside `~/Dev/bdsanxz/SWE/hcx`, no commits, no pushes.
