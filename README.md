# hcx

Helper over `hc` for Herdr: send messages without the `<hc from>` tag, spawn agents in
their own tab, run with no parent by default, and reach terminals by **tab name**.
Everything else is passed through to `hc` unchanged.

## Install

On macOS arm64 nothing extra is needed, it gets a standalone binary; on every
other platform `hcx` runs with node (https://nodejs.org):

```bash
curl -fsSL https://raw.githubusercontent.com/bdsanxz/hcx/main/install.sh | sh
```

This downloads `hcx` from the latest release and checks its SHA-256. It installs
it as `~/.local/bin/hcx`. Options go after `sh -s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/bdsanxz/hcx/main/install.sh | sh -s -- --version v0.1.0 --dir ~/bin
```

| Option | Environment variable | Default | Use |
| --- | --- | --- | --- |
| `--version vX.Y.Z` | `HCX_VERSION` | `latest` | The release to install. |
| `--dir DIR` | `HCX_INSTALL_DIR` | `~/.local/bin` | Where the file goes. |
| `--from-source` | | | Build a standalone binary from source with Bun instead of downloading it (`latest` builds the default branch, a tag builds that tag). |
| `--force` | | | Replace the target even when it is a symlink (see below). |

When the target is a symlink — for example `~/.local/bin/hcx` linked to a repo
build by `bun run install:local` — the installer prints what it points to and
stops unless `--force` is given.

A private repository needs a token with read access: set `GITHUB_TOKEN`, or sign in with the GitHub CLI (`gh auth login`).

### From source

```bash
git clone https://github.com/bdsanxz/hcx.git
cd hcx
bun install
bun run build
cp dist/hcx.js ~/.local/bin/hcx
```

Run `hcx --help` to check that it runs. `dist/hcx.js` is `src/` bundled with `bun build` for node; `dist/hcx` is the standalone binary from `bun run build:bin`.

### Uninstall

```bash
rm ~/.local/bin/hcx
```

## Tab names

Anywhere `hc` takes a `<terminal>` — `get`, `attach`, `read`, `kill`, `rm`, `label`,
`keep`, `keys`, `interrupt`, `wait`, `put`, `send` — the first positional argument may
be a tab name instead of an address. A name matches in any case and becomes the tab's
agent terminal (or its first terminal when it has no agent).

- `hcx read Vrax --lines 3`, `hcx get zytra`, `hcx send Vrax "..."`.
- Addresses (`t7`, `t1b`, `machine/t7`) and numeric names pass through untouched, so
  terminals started with `hc run --name` still work.
- A name that is not a tab is also left alone.
- Two tabs with the same name are refused: use an address instead.
- `herdr-app ls` is only called when a name actually needs looking up.

## `hcx send`

```sh
hcx send [--wait] [--force] [--json] [--if idle|working] [--timeout SECONDS] [--no-footer] [--agent-only] <tab-name|tNN> "text"
```

Send a message to another terminal **without the `<hc from="…">` tag**, by tab name,
with a footer that names the sender.

- The core adds the tag only when it knows the caller (`HC_TERMINAL_ID`), so `hcx`
  clears that variable before `hc send`. The cost: `hc wait` and `hc send --wait` no
  longer tie the reply turn to the sender.
- The footer `— from <tab name> · reply: hcx send <tab name> "..."` is added when
  `HC_TERMINAL_ID` is set. The reply names the sender's tab only when that name
  resolves uniquely back to it; otherwise it names the sender's address, which
  always resolves.
- `hcx send --help` (and `hcx send <tab> --help`) prints hcx's own send help, not
  hc's. A text of `--help` still sends after an explicit `--`.
- Without `--no-footer` a plain shell is refused before anything is typed
  (kind `plain_shell`, exit 4):
  `tab "Shell" is a plain shell; use --no-footer to type a command`. Sending there
  would run the text and the footer as shell commands.
- `--agent-only` looks the target kind up first — also with `--no-footer` — and
  refuses a plain shell or an unknown kind before anything is sent
  (kind `plain_shell`, exit 4). It combines with the other flags:
  `hcx send --agent-only --json --if idle Vrax "check this"`.
- `hc send` flags go before the text: `--wait`, `--force`, `--json`, `--if <status>`,
  `--timeout <seconds>`. `--timeout` is hc's own wait timeout and is passed through;
  the `hc send` call itself is killed after 30 s (kind `timeout`: the message may have
  landed, never retry). `hc` always sees `--` before the target and the text, so a
  text starting with `-` works: `hcx send Vrax -- "- item"`, and a text starting with
  `--` works after an explicit `--`: `hcx send Vrax -- "--wait"`.
- `--no-footer` (alias `--raw`) sends the text **exactly as given**: no footer and no
  tag. It works for every target, including a plain shell or an opencode TUI, and
  combines with the other flags: `hcx send --no-footer --if idle Vrax "echo hi"`.
  A raw send to a terminal address (`t7`) skips `herdr-app ls`: no sender name or
  resolution is needed.

### Delivery status (contract 1, versioned)

`hcx send --json` is a versioned machine interface (contract 1; see
`hcx --version --json`). When hc prints JSON — with `--json`, or by default when
stdout is piped — `hcx send` adds fields next to hc's own and keeps hc's fields
(`status`, `turn`, `started`, …) and exit code as they are. The added fields are
stable within contract 1; new optional fields may be added, none removed:

- `delivered`: `true` when the target confirmed, `false` when it confirmed but
  started no turn (`started: false` — see below), `null` when it reports no status,
  so nobody can tell (a shell, an opencode TUI or a qoder tab).
- `route`: `hcx` for the untagged footer send, `hcx-raw` for `--no-footer`.
- `agent`: the target's agent kind. `hc ls` names it directly (by address and by
  terminal name) unless it reports a shell, in which case the foreground program
  from `hc get` names it only when it is a known agent (`opencode`, or a versioned
  `qodercli` such as `qodercli-1.1.81` reported as `qoder`); any other
  foreground program is reported in `program` and the agent keeps its shell kind
  (`zsh`, …).
- `note`: for `delivered: false`, `did not start a turn; it may still have arrived,
  read before resending` — do not blindly resend. For `delivered: null`,
  `opencode reports no turn status` for an opencode target, `target is a <kind>
  shell; hc reports no turn status` for a known shell kind, otherwise `target is an
  opencode TUI or a shell; hc reports no turn status`.

```sh
hcx send --json Vrax "check this"
{"status":"idle","turn":4,"started":true,"delivered":true,"route":"hcx","agent":"muse"}
```

In a terminal, without `--json`, the human line stays hc's own.

## `hcx spawn`

```sh
hcx spawn <muse|pi|claude|opencode|agy|qoder> [--name N] [--space S] [--folder DIR] [--task TEXT] [--json] [agent flags...]
```

Start an agent in a tab of its own, in the current folder (or `--folder`). It goes
through `herdr-app do tab.new`, never `hc run`, so the new agent has **no parent
terminal**: it does not hang under the agent that started it, and it is not ended with
it. The built-in agents are `muse`, `pi`, `claude`, `opencode`, `agy` (runs `agy`)
and `qoder` (runs `qodercli`).

```sh
hcx spawn muse --yolo
hcx spawn pi --space SWE   # open the tab in another space
hcx spawn claude --dangerously-skip-permissions   # the singular spelling is accepted too
hcx spawn opencode
hcx spawn agy --yolo
hcx spawn qoder
hcx spawn pi --task "review src/"
```

### Custom agents

Known agents are the built-ins merged with a JSON config file: `$HCX_AGENTS_FILE`
when set, else `${XDG_CONFIG_HOME:-~/.config}/hcx/agents.json`. A missing file is
fine. The file is a JSON object mapping an agent name (`^[a-z0-9][a-z0-9-]*$`) to a
command: either a string or a non-empty array of strings (the array is the argv
prefix before the user's agent flags). An entry with a built-in name overrides that
built-in.

```sh
# $HCX_AGENTS_FILE, or ~/.config/hcx/agents.json:
{"reviewer": "agy", "builder": ["qodercli", "--some-flag"]}
hcx spawn reviewer --name Audit   # runs: agy
hcx spawn builder -- --yolo       # runs: qodercli --some-flag --yolo
hcx spawn muse ...               # still runs: muse (override with {"muse": ["muse", "--flag"]})
```

A malformed file (bad JSON, wrong type, bad name, empty command) fails `hcx spawn`
with a `usage` error naming the file path and the offending name; `send`, `done`
and pass-through commands never read the file. `hcx spawn --help` lists the known
agents and prints the resolved file path.

The tab opens in the space of the terminal that runs `hcx spawn` (not whichever space is active); `--space` takes a space name or id to put it elsewhere.

Tab names never repeat: `--name` is checked against every existing tab (any case) before anything opens, and a name already in use is refused (`tab name "Vrax" is already used by t10; pick another --name`). Without `--name`, the auto-naming mod gives the tab a name that is not in use.

`hcx spawn --help` prints spawn help. Only `--name`, `--space`, `--folder` (`-C`),
`--task` and `--json` are hcx's own; every other flag goes to the agent, and `--`
forces the rest to the agent. Values take a space or `=`: `--name Review`,
`--space=SWE`. A value starting with `-` is refused (`--name --json` takes no name).
`--name` must not look like a terminal address, be all digits, or contain whitespace.
Prints the tab name once it is known, so you can reply with `hcx send <name> "..."`.

### OpenCode model

`hcx spawn opencode` also takes `--model provider/model` and `--variant level`. With
them, hcx first checks the model and the variant against the registry
(`opencode api model.list`) and refuses, before any session or tab exists, when the
model or variant is unknown or the model is disabled, or when the service is not
running. It then creates a session in the folder, switches its model through
OpenCode's background service, verifies the switch by reading
`opencode api session.list`, and starts `opencode --session <id>` on it:

```sh
hcx spawn opencode --model vikey/no-such-model
# unknown opencode model "vikey/no-such-model"; run opencode and pick one with /models
hcx spawn opencode --model vikey/deepseek-v4-flash --variant max
# unknown variant "max" for vikey/deepseek-v4-flash; available: low, medium, high
```

Without `--model`, `opencode` starts as before. Extra agent flags are kept after
`--session`: `hcx spawn opencode --model p/m -- --yolo` starts
`opencode --session <id> --yolo`. When a later step fails after the session exists,
the error names the session id for cleanup.

### JSON output

`--json` prints one object instead of the text line: `name`, `terminal`, `agent`,
`space`, `folder`, plus `model` and `variant` when they were given, `tab` when the
tab id is known, and the opencode `session` id when one was created.

```sh
hcx spawn muse --name Review --json
{"name":"Review","terminal":"t7","agent":"muse","space":"spA","folder":"/repo","tab":"tab9"}
```

## `hcx done`

```sh
hcx done [--self] [--json] <tab>...
```

Kill each named terminal's program, then remove the terminal. One line per tab
(`done Mira (t5)`). A tab whose program already finished is still removed; an unknown
tab is reported on stderr and the other tabs still go. Exits 1 when any tab failed.

`hcx done -h` and `--help` print help; any other flag is refused. A target that
equals the caller's own terminal (`HC_TERMINAL_ID`) is refused unless `--self` is
given. `--json` prints one JSON array with one object per tab
(`{"target","terminal","removed","error"?}`).

## `hcx run`

```sh
hcx run [hc run args...]
```

Runs `hc run` with `--no-parent` added unless the arguments already contain `--parent`
(or `--no-parent`). An agent that runs `hcx run` therefore does not become the new
terminal's parent; pass `--parent t10` explicitly when you want one.

## Everything else

`hcx` with no arguments or `--help` prints hcx's own help. `hcx --version` (`-V`)
prints `hcx <version>` on the first line and `hc <version>` on the second. Every other
command is passed straight to `hc` with inherited stdio, so output, stderr and exit
code are `hc`'s own — including unknown commands (`hcx command-unknown` shows hc's
error) and `hcx --licenses`, `hcx ls --json`.

## Machine contract

`hcx --version --json` prints one object for callers to gate on:

```sh
hcx --version --json
{"hcx":"0.4.1","hc":"0.1.15","contract":1,"capabilities":["no-footer","agent-only","json-delivery"]}
```

`contract` is 1 for this interface; `capabilities` lists what this hcx supports:
`no-footer` (raw sends), `agent-only` (the `--agent-only` guard), `json-delivery`
(the `send --json` fields). Callers should check `contract` and the capability they
need before using a flag an older hcx would read as text. The `send --json` fields
(`delivered`, `route`, `agent`, `program?`, `note?` next to hc's own fields) are part
of the same contract and stable within contract 1.

## Errors

hcx's own errors follow hc's shape: with `--json`, or whenever stderr is piped,
they print `{"error":{"kind","message","hint"}}` on stderr; in a terminal the human
`hcx: <message>` line stays. Kinds are `ambiguous` (a twin tab or space name),
`usage` (bad flags or targets), `not_found` (an unknown space), `plain_shell`
(a refused shell or, with `--agent-only`, an unknown kind) and `timeout`
(a killed `hc send`: the message may have landed, never retry), else `error`.
Exit codes are 2 for usage, 3 for not_found, 4 for plain_shell, 1 otherwise.
`plain_shell`, `timeout` and the exit codes are stable for callers.

## Build

```sh
bun install
bun run build         # dist/hcx.js (node bundle)
bun run build:bin     # dist/hcx (standalone binary)
bun test && bun run typecheck
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
