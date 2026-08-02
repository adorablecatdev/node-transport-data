import { run as runCtb } from "./companies/ctb/index.js";
import { runHKI as runGmbHKI, runKLN as runGmbKLN, runNT as runGmbNT } from "./companies/gmb/index.js";
import { run as runKmb } from "./companies/kmb/index.js";
import { run as runKmbCtb } from "./companies/kmbctb/index.js";
import { run as runLrt } from "./companies/lrt/index.js";
import { run as runMtr } from "./companies/mtr/index.js";
import { run as runMtrbus } from "./companies/mtrbus/index.js";
import { run as runNlb } from "./companies/nlb/index.js";
import { run as runFare } from "./fare/index.js";
import { parseAll } from "./parse.js";
import { run as runTimetable } from "./time_table/index.js";
import { run as runCtbTimetable } from "./time_table/ctb/index.js";
import { run as runKmbTimetable } from "./time_table/kmb/index.js";
import { run as runKmbctbTimetable } from "./time_table/kmbctb/index.js";

type RunOptions = { fresh?: boolean; test?: boolean };

const companies: Record<string, (options: RunOptions) => Promise<void>> = {
  kmb: () => runKmb(),
  ctb: (options) => runCtb(options),
  kmbctb: () => runKmbCtb(),
  mtrbus: () => runMtrbus(),
  mtr: () => runMtr(),
  lrt: () => runLrt(),
  gmbhki: (options) => runGmbHKI(options),
  gmbkln: (options) => runGmbKLN(options),
  gmbnt: (options) => runGmbNT(options),
  nlb: (options) => runNlb(options),
  timetable: () => runTimetable(),
  "kmb-timetable": (options) => runKmbTimetable({ fresh: options.fresh }),
  "ctb-timetable": (options) => runCtbTimetable({ fresh: options.fresh }),
  "kmbctb-timetable": (options) => runKmbctbTimetable({ fresh: options.fresh }),
  fare: () => runFare(),
};

const KNOWN_FLAGS = new Set(["--fresh", "--test", "--parse-output"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  const test = args.includes("--test");
  const parseOutput = args.includes("--parse-output");

  const targets: string[] = [];
  for (const a of args) {
    if (KNOWN_FLAGS.has(a)) continue;
    targets.push(a.startsWith("--") ? a.slice(2) : a);
  }

  const hasTargets = targets.length > 0;
  const finalTargets = hasTargets ? targets : Object.keys(companies);

  // Fetch when: no --parse-output, OR the user named specific targets.
  // (`--parse-output` alone with no targets means "just aggregate what's on disk".)
  const shouldFetch = hasTargets || !parseOutput;
  if (shouldFetch) {
    for (const name of finalTargets) {
      const runner = companies[name];
      if (!runner) {
        throw new Error(`Unknown company: ${name}. Available: ${Object.keys(companies).join(", ")}`);
      }
      await runner({ fresh, test });
    }
  }

  // parseAll runs when: no targets given (full pipeline), OR --parse-output was requested.
  const shouldParse = !hasTargets || parseOutput;
  if (shouldParse) await parseAll();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
