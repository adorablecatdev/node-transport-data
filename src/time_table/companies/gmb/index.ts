import { Company } from "../../../types.js";
import { readJsonIfExists, removeDirIfExists, writeJson } from "../../../lib/io.js";
import type { Timetable } from "../../../types.js";
import { fetchAllRouteInfos, type GmbRegion } from "./api.js";
import { transformGmb, type GmbRouteRecord } from "./transform.js";

export const company = [Company.GMBHKI, Company.GMBKLN, Company.GMBNT] as const;

const GMB_REGION_DIRS: Array<[GmbRegion, string]> = [
  ["HKI", "out/gmbhki"],
  ["KLN", "out/gmbkln"],
  ["NT", "out/gmbnt"],
];

const CACHE_DIR = "out/final/.cache/gmb";
const CACHE_PATH = `${CACHE_DIR}/route-infos.json`;

export async function run(
  options: { region: GmbRegion, fresh?: boolean },
): Promise<void>
{
  const allRoutes: Record<string, GmbRouteRecord> = {};
  const tasks: Array<{ region: GmbRegion; route_code: string }> = [];
  const seenTask = new Set<string>();

  const dirs = options.region
    ? GMB_REGION_DIRS.filter(([r]) => r === options.region)
    : GMB_REGION_DIRS;

  for (const [region, dir] of dirs)
  {
    const routes = await readJsonIfExists<Record<string, GmbRouteRecord>>(`${dir}/routes.json`);
    if (!routes) continue;
    for (const [k, r] of Object.entries(routes))
    {
      allRoutes[k] = r;
      const key = `${region}:${r.route}`;
      if (!seenTask.has(key))
      {
        seenTask.add(key);
        tasks.push({ region, route_code: r.route });
      }
    }
  }

  const tag = `gmb${options.region.toLowerCase()}`;

  if (tasks.length === 0)
  {
    console.warn(
      `[time_table][${tag}] no routes.json found under out/${tag}/ — skipping. ` +
      "Run the gmb* targets first if you want them.",
    );
    return;
  }

  if (options.fresh)
  {
    console.log(`[time_table][${tag}] fresh flag set — wiping route-info cache`);
    await removeDirIfExists(CACHE_DIR);
  }

  console.log(`[time_table][${tag}] fetching route infos for ${tasks.length} (region, route) pairs`);
  const routeInfosByKey = await fetchAllRouteInfos(tasks, { cachePath: CACHE_PATH, logTag: tag });

  for (const [region, dir] of dirs)
  {
    const regionRoutes: Record<string, GmbRouteRecord> = {};
    for (const [k, r] of Object.entries(allRoutes))
    {
      if (r.region === region) regionRoutes[k] = r;
    }

    const timetable = transformGmb(regionRoutes, routeInfosByKey);
    const path = `${dir}/timetable.json`;
    await writeJson(path, timetable);
    console.log(`[time_table][gmb${region.toLowerCase()}] wrote ${Object.keys(timetable).length} entries to ${path}`);
  }
}
