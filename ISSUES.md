# Issues

Every issue reported against `hcx` is logged here first, then worked. Newest last.

| # | Reported | Reporter | Version | Issue | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-10-31 | owner review | 0.1.2 | `hcx --version` and `hcx -V` print only `hc`'s version (`hc 0.1.15`), never the `hcx` version. | Fixed in 0.1.3 |
| 2 | 2026-10-31 | owner review | 0.1.2 | `hcx send` prints `{"started":null,"status":null,"turn":0}` for tabs that run an opencode TUI or a plain shell, so a caller cannot tell delivered from failed. | Fixed in 0.1.3 |
| 3 | 2026-10-31 | owner review | 0.1.2 | `hcx spawn opencode` cannot choose a model; the session has to be created and its model switched by hand. | Fixed in 0.1.3 |
| 4 | 2026-10-31 | owner review | 0.1.2 | Cleaning up an agent always takes `hcx kill <tab>` then `hcx rm <tab>`; `rm` refuses a live terminal. | Fixed in 0.1.3 |
| 5 | 2026-10-31 | owner review | 0.1.2 | `hcx spawn` prints only free text, so a caller cannot parse the new tab's name, terminal, agent or space. | Fixed in 0.1.3 |
| 6 | 2026-10-31 | owner request | 0.1.2 | `hcx send` always adds the sender footer, so it cannot send text as given to a plain shell or an opencode TUI, where the footer would be typed as a command. | Fixed in 0.1.3 |
| 7 | 2026-10-31 | owner live test | 0.1.3 | `hcx spawn opencode --model vikey/no-such-model` is not refused: `session.switchModel` accepts any model and the read-back only echoes it, so the TUI opens on `no-such-model (unavailable)`. | Fixed in 0.1.4 |
| 8 | 2026-10-31 | owner review | 0.1.4 | `hc` classifies an opencode tab as zsh, so hcx send reports agent zsh and the note says the target may be a shell. | Fixed in 0.1.5 |
| 9 | 2026-10-31 | opus review | 0.1.5 | Any message starting with `-` fails, including the documented `--` form; `hcx send Vrax --help` treats `--help` as the message. | Fixed in 0.2.0 |
| 10 | 2026-10-31 | opus review | 0.1.5 | The default send can type its text and footer into a plain shell; the target kind is only looked up after the send. | Fixed in 0.2.0 |
| 11 | 2026-10-31 | opus review | 0.1.5 | A failed `opencode api model.list` can print its stdout (which may hold API keys) as error detail. | Fixed in 0.2.0 |
| 12 | 2026-10-31 | opus review | 0.1.5 | `spawn` flag parsing starts or changes the wrong thing silently (`--help`, `--name=X`, `--model`, dropped agent flags, late `--space` check, orphan session). | Fixed in 0.2.0 |
| 13 | 2026-10-31 | opus review | 0.1.5 | `--name` is never validated and the footer can print a reply command that cannot resolve (address-like, numeric, whitespace, twin names). | Fixed in 0.2.0 |
| 14 | 2026-10-31 | opus review | 0.1.5 | `hcx done --help` reports success, `done` has no self-protection, discards the `hc kill` result and has no `--json`. | Fixed in 0.2.0 |
| 15 | 2026-10-31 | opus review | 0.1.5 | `delivered: false` misreports hc `started: false`, `loadAgents` misses names, `agent` reports any foreground program, and the `hc` route is never produced. | Fixed in 0.2.0 |
| 16 | 2026-10-31 | opus review | 0.1.5 | Herdr failures are silent, a missing tool gives a raw TypeError, lookups have no timeout, `runHc` loses the signal exit, and duplicate reads/sleep cost calls. | Fixed in 0.2.0 |
| 17 | 2026-10-31 | opus review | 0.1.5 | hcx errors do not follow hc's format or exit codes, and `spawn --json` omits the tab and session ids. | Fixed in 0.2.0 |
| 18 | 2026-10-31 | opus review | 0.1.5 | Installer puts the token on the command line, `--from-source` needs node and installs `hcx.js`, plus smaller trap/version/latest issues. | Fixed in 0.2.0 |
| 19 | 2026-10-31 | opus review | 0.1.5 | Test gaps (`run`, passthrough names, duplicate `--name`, unknown `--space`, auto-name polling, `herdr-app do` failure, twin names) and a confusing README line. | Fixed in 0.2.0 |
| 20 | 2026-10-31 | owner review | 0.2.0 | `hcx send --no-footer` can type into a plain shell with no guard for callers; there is no flag that refuses shells and unknown kinds before sending. | Fixed in 0.3.0 |
| 21 | 2026-10-31 | owner review | 0.2.0 | The shell refusal uses kind `usage`, so callers cannot tell it apart from bad flags; it needs its own kind and exit code. | Fixed in 0.3.0 |
| 22 | 2026-10-31 | owner review | 0.2.0 | The `hc send` subprocess has no timeout, so a hung send blocks forever. | Fixed in 0.3.0 |
| 23 | 2026-10-31 | owner review | 0.2.0 | Raw sends (`--no-footer`) to a terminal address still call `herdr-app ls` although no sender name or resolution is needed. | Fixed in 0.3.0 |
| 24 | 2026-10-31 | owner review | 0.2.0 | No machine-readable version/capability check and the `send --json` fields are not a documented versioned interface. | Fixed in 0.3.0 |
| 25 | 2026-10-31 | owner request | 0.3.0 | `hcx spawn` agents are a hardcoded list, so `agy`, `qoder` and user agents need a code change to run. | Fixed in 0.4.0 |
| 26 | 2026-10-31 | owner request | 0.4.0 | a qoder tab behind a shell wrapper is seen as a plain shell (`qodercli-1.1.81` foreground), so `hcx send --agent-only` refuses it. | Fixed in 0.4.1 |
| 27 | 2026-10-31 | owner request | 0.4.1 | qoder delivery note names an opencode TUI (`target is an opencode TUI or a shell; hc reports no turn status` instead of a qoder note). | Fixed in 0.4.2 |
| 28 | 2026-10-31 | owner request | 0.4.2 | Default output is JSON (hcx forwards hc's JSON-first output for `send`, `ls`, `get`, `keys` and other pass-throughs) and errors are JSON whenever stderr is piped; default should be human-readable text, JSON only with `--json`. | Fixed in 0.5.0 |
| 29 | 2026-10-31 | owner request | 0.5.0 | `hcx read Mira` (and `kill`, `rm`, `label`, `keep`, `interrupt`, `put`) print hc's raw JSON error document instead of hcx text; bounded one-shot pass-throughs should render hc errors as text like `send`/`get`/`keys` in 0.5.0, while interactive and long-running commands keep inherited stdio. | Fixed in 0.5.1 |
