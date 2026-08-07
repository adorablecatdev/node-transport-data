import { Company } from "../../../types.js";
import { readJsonIfExists } from "../../../lib/io.js";
import type { ParsedGtfs, Timetable } from "../../types.js";
import { transformGmb } from "./transform.js";

export const company = [Company.GMBHKI, Company.GMBKLN, Company.GMBNT] as const;

const GMB_REGION_DIRS: Array<[Company, string]> = [
  [Company.GMBHKI, "out/gmbhki"],
  [Company.GMBKLN, "out/gmbkln"],
  [Company.GMBNT, "out/gmbnt"],
];

async function loadGmbRegionMap(): Promise<Map<string, Company>> {
  const map = new Map<string, Company>();
  for (const [region, dir] of GMB_REGION_DIRS) {
    const routes = await readJsonIfExists<Record<string, { route_id: string }>>(
      `${dir}/routes.json`,
    );
    if (!routes) continue;
    for (const r of Object.values(routes)) map.set(r.route_id, region);
  }
  return map;
}

export async function run(gtfs: ParsedGtfs): Promise<Timetable> {
  const regionMap = await loadGmbRegionMap();
  if (regionMap.size === 0) {
    console.warn(
      "[time_table] no GMB region data found under out/gmb{hki,kln,nt}/ — GMB routes will be dropped. " +
        "Run the gmb* targets first if you want them.",
    );
  } else {
    console.log(`[time_table] loaded ${regionMap.size} GMB route_id → region mappings`);
  }
  return transformGmb(gtfs, regionMap);
}
