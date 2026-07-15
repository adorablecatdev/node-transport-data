import { run as runCitybus } from "./companies/citybus/index.js";
import { runHKI as runGmbHKI, runKLN as runGmbKLN, runNT as runGmbNT } from "./companies/gmb/index.js";
import { run as runKmb } from "./companies/kmb/index.js";
import { run as runKmbCtb } from "./companies/kmbctb/index.js";
import { run as runLightrail } from "./companies/lightrail/index.js";
import { run as runMtr } from "./companies/mtr/index.js";
import { run as runMtrbus } from "./companies/mtrbus/index.js";
import { run as runNlb } from "./companies/nlb/index.js";
import { parseAll } from "./parse.js";

type RunOptions = { resume?: boolean; test?: boolean; keepCache?: boolean };

const companies: Record<string, (options: RunOptions) => Promise<void>> = {
  kmb: () => runKmb(),
  citybus: (options) => runCitybus(options),
  kmbctb: () => runKmbCtb(),
  mtrbus: () => runMtrbus(),
  mtr: () => runMtr(),
  lightrail: () => runLightrail(),
  gmbhki: (options) => runGmbHKI(options),
  gmbkln: (options) => runGmbKLN(options),
  gmbnt: (options) => runGmbNT(options),
  nlb: (options) => runNlb(options),
};

const KNOWN_FLAGS = new Set([
  "--resume",
  "--test",
  "--parse-only",
  "--no-parse",
  "--keep-cache",
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const test = args.includes("--test");
  const parseOnly = args.includes("--parse-only");
  const noParse = args.includes("--no-parse");
  const keepCache = args.includes("--keep-cache");

  const targets: string[] = [];
  for (const a of args) {
    if (KNOWN_FLAGS.has(a)) continue;
    targets.push(a.startsWith("--") ? a.slice(2) : a);
  }

  if (!parseOnly) {
    const finalTargets = targets.length > 0 ? targets : Object.keys(companies);
    for (const name of finalTargets) {
      const runner = companies[name];
      if (!runner) {
        throw new Error(`Unknown company: ${name}. Available: ${Object.keys(companies).join(", ")}`);
      }
      await runner({ resume, test, keepCache });
    }
  }

  if (!noParse) {
    await parseAll();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
