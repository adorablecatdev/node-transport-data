import { readJsonIfExists, writeJson } from "../lib/io.js";
import { extractZipEntries, fetchGtfsZip } from "../lib/gtfs.js";
import { Company } from "../types.js";
import { transformTimetable } from "./transform.js";

const URL =
  "https://res.data.gov.hk/api/get-download-file?name=https%3A%2F%2Fstatic.data.gov.hk%2Ftd%2Fpt-headway-tc%2Fgtfs.zip";
const OUT_DIR = "out/time_table";
const WANTED_FILES = new Set(["routes.txt", "trips.txt", "calendar.txt", "frequencies.txt"]);

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

export async function run(): Promise<void> {
  console.log("[time_table] fetching gtfs.zip");
  const zip = await fetchGtfsZip(URL, "time_table");
  console.log(`[time_table] fetched ${(zip.length / 1024 / 1024).toFixed(1)} MiB, extracting`);
  const files = await extractZipEntries(zip, WANTED_FILES);

  const gmbRegionByRouteId = await loadGmbRegionMap();
  if (gmbRegionByRouteId.size === 0) {
    console.warn(
      "[time_table] no GMB region data found under out/gmb{hki,kln,nt}/ — GMB routes will be dropped. " +
        "Run the gmb* targets first if you want them.",
    );
  } else {
    console.log(`[time_table] loaded ${gmbRegionByRouteId.size} GMB route_id → region mappings`);
  }

  const timetable = transformTimetable({
    routesCsv: files.get("routes.txt")!,
    tripsCsv: files.get("trips.txt")!,
    calendarCsv: files.get("calendar.txt")!,
    frequenciesCsv: files.get("frequencies.txt")!,
    gmbRegionByRouteId,
  });

  await writeJson(`${OUT_DIR}/timetable.json`, timetable);
  console.log(
    `[time_table] wrote ${Object.keys(timetable).length} route entries to ${OUT_DIR}/timetable.json`,
  );
}
