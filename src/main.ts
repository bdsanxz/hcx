import { loadTabs } from "./herdr";
import { HcxError, needsTabLookup, resolveArgs, runArgs } from "./lib";
import { runHc } from "./passthrough";
import { send } from "./send";
import { spawn } from "./spawn";

const USAGE = `hcx — helper over hc for Herdr

  hcx send [--wait] [--force] [--json] [--if idle|working] [--timeout SECONDS] <tab-name|tNN> "text"
                                     send without the <hc from> tag, with a sender footer
  hcx spawn <muse|pi|claude|opencode> [--name N] [--folder DIR] [--task TEXT] [agent flags...]
                                     start the agent in a tab of its own (no parent terminal)
  hcx run [hc run args...]           run with --no-parent unless --parent or --no-parent is given

Tab names work anywhere hc takes a <terminal> (get attach read kill rm label keep keys
interrupt wait put send): a name, any case, becomes that tab's agent terminal (or its
first terminal). Twin names are refused; addresses and numeric names pass through.

Every other hc command is passed through unchanged, with its output, errors and exit
code: hcx ls --json, hcx read Vrax, hcx --version, hcx command...

  hcx spawn muse --yolo
  hcx send Vrax "check this"
`;

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (command === "send") {
    process.exit(send(args));
  } else if (command === "spawn") {
    process.exit(spawn(args));
  } else if (command === "run") {
    process.exit(runHc(["run", ...runArgs(args)]));
  } else {
    const tabs = needsTabLookup(command, args) ? loadTabs() : [];
    process.exit(runHc([command, ...resolveArgs(command, args, tabs)]));
  }
} catch (e) {
  console.error(`hcx: ${e instanceof HcxError ? e.message : String(e)}`);
  process.exit(1);
}
