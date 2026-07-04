import { run as runCitybus } from "./companies/citybus/index.js";
import { run as runKmb } from "./companies/kmb/index.js";
import { run as runLightrail } from "./companies/lightrail/index.js";
import { run as runMtr } from "./companies/mtr/index.js";
import { run as runMtrbus } from "./companies/mtrbus/index.js";

type RunOptions = { resume?: boolean };

const companies: Record<string, (options: RunOptions) => Promise<void>> = {
  kmb: () => runKmb(),
  citybus: (options) => runCitybus(options),
  mtrbus: () => runMtrbus(),
  mtr: () => runMtr(),
  lightrail: () => runLightrail(),
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const positional = args.filter((a: string) => !a.startsWith("--"));
  const targets = positional.length > 0 ? positional : Object.keys(companies);

  for (const name of targets) {
    const runner = companies[name];
    if (!runner) {
      throw new Error(`Unknown company: ${name}. Available: ${Object.keys(companies).join(", ")}`);
    }
    await runner({ resume });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
