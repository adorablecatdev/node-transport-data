import { extractZipEntries, fetchGtfsZip, parseCsv } from "../../lib/gtfs.js";
import type {
  CalendarRow,
  FrequencyRow,
  ParsedGtfs,
  RouteRow,
  TripRow,
} from "../types.js";

const URL =
  "https://res.data.gov.hk/api/get-download-file?name=https%3A%2F%2Fstatic.data.gov.hk%2Ftd%2Fpt-headway-tc%2Fgtfs.zip";
const WANTED_FILES = new Set(["routes.txt", "trips.txt", "calendar.txt", "frequencies.txt"]);
const CACHE_PATH = "tmp/gtfs.zip";

// One-time fetch + parse of the shared HK GTFS feed. Every GTFS-based company
// transform runs against the same ParsedGtfs — the shared layer holds NO
// business logic, only raw typed rows.
export async function fetchAndParseGtfs(options: { fresh?: boolean } = {}): Promise<ParsedGtfs> {
  console.log("[time_table] fetching gtfs.zip");
  const zip = await fetchGtfsZip(URL, "time_table", {
    cachePath: CACHE_PATH,
    fresh: options.fresh,
  });
  console.log(`[time_table] fetched ${(zip.length / 1024 / 1024).toFixed(1)} MiB, extracting`);
  const files = await extractZipEntries(zip, WANTED_FILES);

  return {
    routes: parseCsv<RouteRow>(files.get("routes.txt")!),
    trips: parseCsv<TripRow>(files.get("trips.txt")!),
    calendar: parseCsv<CalendarRow>(files.get("calendar.txt")!),
    frequencies: parseCsv<FrequencyRow>(files.get("frequencies.txt")!),
  };
}
