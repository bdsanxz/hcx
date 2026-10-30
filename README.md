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
| `--from-source` | | | Build from the release source with Bun instead of downloading it. |
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

Run `hcx --help` to check that it runs. No compile step: `dist/hcx.js` is `src/` bundled with `bun build` for node.

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
hcx send [--wait] [--force] [--json] [--if idle|working] [--timeout SECONDS] <tab-name|tNN> "text"
```

Send a message to another terminal **without the `<hc from="…">` tag**, by tab name,
with a footer that names the sender.

- The core adds the tag only when it knows the caller (`HC_TERMINAL_ID`), so `hcx`
  clears that variable before `hc send`. The cost: `hc wait` and `hc send --wait` no
  longer tie the reply turn to the sender.
- The footer `— from <tab name> · reply: hcx send <tab name> "..."` is added when
  `HC_TERMINAL_ID` is set. Don't send to a plain shell: it would run the footer as a
  command.
- `hc send` flags go before the text: `--wait`, `--force`, `--json`, `--if <status>`,
  `--timeout <seconds>`. Use `--` if the message itself starts with a flag:
  `hcx send Vrax -- "--wait"`.

## `hcx spawn`

```sh
hcx spawn <muse|pi|claude|opencode> [--name N] [--space S] [--folder DIR] [--task TEXT] [agent flags...]
```

Start an agent in a tab of its own, in the current folder (or `--folder`). It goes
through `herdr-app do tab.new`, never `hc run`, so the new agent has **no parent
terminal**: it does not hang under the agent that started it, and it is not ended with
it.

```sh
hcx spawn muse --yolo
hcx spawn pi --space SWE   # open the tab in another space
hcx spawn claude --dangerously-skip-permissions   # the singular spelling is accepted too
hcx spawn opencode
hcx spawn pi --task "review src/"
```

The tab opens in the space of the terminal that runs `hcx spawn` (not whichever space is active); `--space` takes a space name or id to put it elsewhere.

Tab names never repeat: `--name` is checked against every existing tab (any case) before anything opens, and a name already in use is refused (`tab name "Vrax" is already used by t10; pick another --name`). Without `--name`, the auto-naming mod gives the tab a name that is not in use.

Only `--name`, `--folder` (`-C`) and `--task` are hcx's own; every other flag goes to
the agent, and `--` forces the rest to the agent. Prints the tab name once it is known,
so you can reply with `hcx send <name> "..."`.

## `hcx run`

```sh
hcx run [hc run args...]
```

Runs `hc run` with `--no-parent` added unless the arguments already contain `--parent`
(or `--no-parent`). An agent that runs `hcx run` therefore does not become the new
terminal's parent; pass `--parent t10` explicitly when you want one.

## Everything else

`hcx` with no arguments or `--help` prints hcx's own help. Every other command is
passed straight to `hc` with inherited stdio, so output, stderr and exit code are
`hc`'s own — including unknown commands (`hcx command-unknown` shows hc's error) and
`hcx --version`, `hcx --licenses`, `hcx ls --json`.

## Build

```sh
bun install
bun run build         # dist/hcx.js (node bundle)
bun run build:bin     # dist/hcx (standalone binary)
bun test && bun run typecheck
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
