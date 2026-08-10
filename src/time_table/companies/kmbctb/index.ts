import { Company } from "../../../types.js";
import { readJsonIfExists, removeDirIfExists, writeJson } from "../../../lib/io.js";
import { fetchAllSchedules } from "./api.js";
import { transformKmbCtb, type KmbCtbRouteRecord } from "./transform.js";

export const company = Company.KMBCTB;

const KMBCTB_ROUTES_JSON = "out/kmbctb/routes.json";
const CACHE_DIR = "out/kmbctb/.cache";
const CACHE_PATH = `${CACHE_DIR}/schedules.json`;

export async function run(options: { fresh?: boolean } = {}): Promise<void> {
  const path = "out/kmbctb/timetable.json";

    
  const routesJson = await readJsonIfExists<Record<string, KmbCtbRouteRecord>>(KMBCTB_ROUTES_JSON);
  if (!routesJson) {
    console.warn(`[time_table][kmbctb] ${KMBCTB_ROUTES_JSON} not found — skipping KMBCTB`);
    return;
  }

  if (options.fresh) {
    console.log("[time_table][kmbctb] fresh flag set — wiping schedule cache");
    await removeDirIfExists(CACHE_DIR);
  }

  const uniqueRoutes = [
    ...new Set(
      Object.values(routesJson)
        .filter((r) => r.company === "KMBCTB")
        .map((r) => r.route),
    ),
  ];
  console.log(`[time_table][kmbctb] fetching schedules for ${uniqueRoutes.length} routes`);

  const schedules = await fetchAllSchedules(uniqueRoutes, { cachePath: CACHE_PATH });
  const timetable = transformKmbCtb(routesJson, schedules);

  await writeJson(path, timetable);
  console.log(`[time_table][kmbctb] wrote ${Object.keys(timetable).length} entries to ${path}`);
}
