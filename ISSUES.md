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
