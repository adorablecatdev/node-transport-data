import { Company } from "../../../types.js";
import { readJsonIfExists, removeDirIfExists } from "../../../lib/io.js";
import type { Timetable } from "../../types.js";
import { fetchAllSchedules } from "./api.js";
import { transformKmb, type KmbRouteRecord } from "./transform.js";

export const company = Company.KMB;

const KMB_ROUTES_JSON = "out/kmb/routes.json";
const CACHE_DIR = "out/kmb/.cache";
const CACHE_PATH = `${CACHE_DIR}/schedules.json`;

export async function run(options: { fresh?: boolean } = {}): Promise<Timetable> {
  const routesJson = await readJsonIfExists<Record<string, KmbRouteRecord>>(KMB_ROUTES_JSON);
  if (!routesJson) {
    console.warn(`[time_table][kmb] ${KMB_ROUTES_JSON} not found — skipping KMB`);
    return {};
  }

  if (options.fresh) {
    console.log("[time_table][kmb] fresh flag set — wiping schedule cache");
    await removeDirIfExists(CACHE_DIR);
  }

  const uniqueRoutes = [
    ...new Set(
      Object.values(routesJson)
        .filter((r) => r.company === "KMB")
        .map((r) => r.route),
    ),
  ];
  console.log(`[time_table][kmb] fetching schedules for ${uniqueRoutes.length} routes`);

  const schedules = await fetchAllSchedules(uniqueRoutes, { cachePath: CACHE_PATH });
  return transformKmb(routesJson, schedules);
}
