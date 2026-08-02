import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extractZipEntries, fetchGtfsZip } from "../../lib/gtfs.js";
import { buildKmbGtfsMapping } from "./kmb_gtfs_mapping.js";
import { buildKmbGtfsTimetable } from "./kmb_gtfs_timetable.js";

const GTFS_URL =
  "https://res.data.gov.hk/api/get-download-file?name=https%3A%2F%2Fstatic.data.gov.hk%2Ftd%2Fpt-headway-tc%2Fgtfs.zip";
const KMB_OUT_DIR = "out/kmb";
const MAPPING_OUT_DIR = "src/time_table/kmb/gtfs_mapping";
const MAPPING_PATH = `${MAPPING_OUT_DIR}/gtfs-route-id-map.json`;
const FUZZY_PATH = `${MAPPING_OUT_DIR}/gtfs-fuzzy-matches.csv`;
const UNMAPPED_PATH = `${MAPPING_OUT_DIR}/gtfs-unmapped.csv`;
const TIMETABLE_PATH = `${MAPPING_OUT_DIR}/timetable.json`;
const CACHE_DIR = "src/time_table/cache";
const CACHE_ZIP_PATH = `${CACHE_DIR}/gtfs.zip`;

async function readCachedZip(): Promise<Buffer | undefined> {
  try {
    return await readFile(CACHE_ZIP_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

// Standalone entry point for the `kmb-timetable` CLI target — fetches the GTFS
// zip on its own so it can run without the rest of the time_table pipeline.
// The zip is cached under src/time_table/cache/; pass `{ fresh: true }` (or
// `--fresh` on the CLI) to force a redownload.
export async function run(options: { fresh?: boolean } = {}): Promise<void> {
  let zip: Buffer | undefined;
  if (!options.fresh) {
    zip = await readCachedZip();
    if (zip) {
      console.log(
        `[kmb-timetable] using cached ${CACHE_ZIP_PATH} (${(zip.length / 1024 / 1024).toFixed(1)} MiB) — pass --fresh to redownload`,
      );
    }
  }
  if (!zip) {
    console.log("[kmb-timetable] fetching gtfs.zip");
    zip = await fetchGtfsZip(GTFS_URL, "kmb-timetable");
    console.log(`[kmb-timetable] fetched ${(zip.length / 1024 / 1024).toFixed(1)} MiB, caching`);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_ZIP_PATH, zip);
  }

  const files = await extractZipEntries(
    zip,
    new Set(["routes.txt", "trips.txt", "calendar.txt", "frequencies.txt"]),
  );

  const mapping = await buildKmbGtfsMapping(
    files.get("routes.txt")!,
    `${KMB_OUT_DIR}/routes.json`,
    MAPPING_PATH,
    FUZZY_PATH,
    UNMAPPED_PATH,
  );
  if (!mapping) return;

  await buildKmbGtfsTimetable({
    tripsCsv: files.get("trips.txt")!,
    calendarCsv: files.get("calendar.txt")!,
    frequenciesCsv: files.get("frequencies.txt")!,
    mapping,
    outPath: TIMETABLE_PATH,
  });
}
