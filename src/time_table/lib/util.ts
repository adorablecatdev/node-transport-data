
import { readJsonIfExists } from "../../lib/io.js";
import { CACHE_PATH, COMPANY_PREFIXES, GTFS_URL, PER_COMPANY_TIMETABLE_PATHS, WANTED_FILES } from "./constants.js";
import { extractZipEntries, fetchGtfsZip, parseCsv } from "../../lib/gtfs.js";
import type {
    CalendarRow,
    FrequencyRow,
    RouteRow,
    TripRow,
    ParsedGtfs, Timetable
} from "../../types.js";

export function groupTimetableByCompany(merged: Timetable): Record<string, Timetable>
{
    const grouped: Record<string, Timetable> = {};
    for (const [key, variants] of Object.entries(merged))
    {
        const company = COMPANY_PREFIXES.find((c) => key.startsWith(`${c}-`));
        if (!company)
        {
            console.warn(`[time_table] unknown company prefix for key: ${key}`);
            continue;
        }
        (grouped[company] ??= {})[key] = variants;
    }
    return grouped;
}

export async function mergePerCompanyTimetables(): Promise<Timetable>
{
    const slices = await Promise.all(
        PER_COMPANY_TIMETABLE_PATHS.map((p) => readJsonIfExists<Timetable>(p)),
    );
    const present: Timetable[] = [];
    for (let i = 0; i < slices.length; i++)
    {
        const slice = slices[i];
        if (slice) present.push(slice);
        else console.warn(`[time_table] missing per-company file: ${PER_COMPANY_TIMETABLE_PATHS[i]}`);
    }
    
    const merged: Timetable = {};
    for (const slice of present)
    {
        for (const [key, variants] of Object.entries(slice))
        {
            const existing = merged[key];
            if (existing) existing.push(...variants);
            else merged[key] = [...variants];
        }
    }
    return merged;
}

export async function fetchAndParseGtfs(options: { fresh?: boolean } = {}): Promise<ParsedGtfs>
{
    console.log("[time_table] fetching gtfs.zip");
    const zip = await fetchGtfsZip(GTFS_URL, "time_table", {
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