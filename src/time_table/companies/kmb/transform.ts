import { readJsonIfExists } from "../../../lib/io.js";
import type {
  FrequencyRow,
  ParsedGtfs,
  RouteRow,
  Schedule,
  Timetable,
  TimetableVariant,
  TripRow,
} from "../../types.js";

const KMB_ROUTES_JSON = "out/kmb/routes.json";
const KMB_AGENCY_ID = "KMB";

type KmbRouteRecord = {
  record_id: string;
  company: string;
  route: string;
  bound: "O" | "I";
  service_type: string;
};

// route_long_name is "起 - 迄" — split on the middle " - " (space-hyphen-space).
function splitLongName(longName: string): { from: string; to: string } {
  const idx = longName.indexOf(" - ");
  if (idx === -1) return { from: longName, to: "" };
  return { from: longName.slice(0, idx), to: longName.slice(idx + 3) };
}

// Second segment of trip_id: "1" → outbound, "2" → inbound.
function boundOfTripId(tripId: string): "O" | "I" | undefined {
  const parts = tripId.split("-");
  if (parts.length !== 4) return undefined;
  if (parts[1] === "1") return "O";
  if (parts[1] === "2") return "I";
  return undefined;
}

// Last segment "HHMM" → "HH:MM". GTFS may use hour >= 24 for post-midnight
// departures; preserve as-is so ordering stays chronological.
function departureOfTripId(tripId: string): string | undefined {
  const parts = tripId.split("-");
  if (parts.length !== 4) return undefined;
  const t = parts[3];
  if (!t || t.length < 4) return undefined;
  return `${t.slice(0, t.length - 2)}:${t.slice(-2)}`;
}

const WEEKDAY_FIELDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function weekdayCodeOf(row: ParsedGtfs["calendar"][number]): string {
  let code = "";
  for (const day of WEEKDAY_FIELDS) code += row[day] === "1" ? "1" : "0";
  return code;
}

export async function transformKmb(gtfs: ParsedGtfs): Promise<Timetable> {
  const routesJson = await readJsonIfExists<Record<string, KmbRouteRecord>>(KMB_ROUTES_JSON);
  if (!routesJson) {
    console.warn(`[time_table][kmb] ${KMB_ROUTES_JSON} not found — skipping KMB`);
    return {};
  }

  // Index GTFS data for lookup.
  // routes.txt: (agency_id, route_short_name) → RouteRow[] (can be >1)
  const routesByAgencyShort = new Map<string, RouteRow[]>();
  for (const r of gtfs.routes) {
    const key = `${r.agency_id}|${r.route_short_name}`;
    let bucket = routesByAgencyShort.get(key);
    if (!bucket) {
      bucket = [];
      routesByAgencyShort.set(key, bucket);
    }
    bucket.push(r);
  }

  // trips.txt: route_id → TripRow[]
  const tripsByRouteId = new Map<string, TripRow[]>();
  for (const t of gtfs.trips) {
    let bucket = tripsByRouteId.get(t.route_id);
    if (!bucket) {
      bucket = [];
      tripsByRouteId.set(t.route_id, bucket);
    }
    bucket.push(t);
  }

  // frequencies.txt: trip_id → FrequencyRow[] (a trip can have multiple windows)
  const freqsByTripId = new Map<string, FrequencyRow[]>();
  for (const f of gtfs.frequencies) {
    let bucket = freqsByTripId.get(f.trip_id);
    if (!bucket) {
      bucket = [];
      freqsByTripId.set(f.trip_id, bucket);
    }
    bucket.push(f);
  }

  // calendar.txt: service_id → weekday code
  const weekdayByService = new Map<string, string>();
  for (const c of gtfs.calendar) weekdayByService.set(c.service_id, weekdayCodeOf(c));

  const result: Timetable = {};

  for (const [key, record] of Object.entries(routesJson)) {
    if (record.company !== KMB_AGENCY_ID) continue;

    const matchedRoutes =
      routesByAgencyShort.get(`${KMB_AGENCY_ID}|${record.route}`) ?? [];
    if (matchedRoutes.length === 0) continue;

    const variants: TimetableVariant[] = [];

    for (const routeRow of matchedRoutes) {
      const parsed = splitLongName(routeRow.route_long_name);
      // route_long_name is written in the outbound direction; swap for inbound.
      const { from, to } =
        record.bound === "I" ? { from: parsed.to, to: parsed.from } : parsed;
      const trips = tripsByRouteId.get(routeRow.route_id) ?? [];
      const schedule: Schedule = {};

      for (const trip of trips) {
        if (boundOfTripId(trip.trip_id) !== record.bound) continue;

        const weekday = weekdayByService.get(trip.service_id);
        if (!weekday) continue;

        const byTime = (schedule[weekday] ||= {});
        const freqs = freqsByTripId.get(trip.trip_id);

        if (freqs && freqs.length > 0) {
          for (const f of freqs) {
            const secs = Number(f.headway_secs);
            if (!Number.isFinite(secs)) continue;
            const intervalMin = Math.round(secs / 60);
            const start = f.start_time.slice(0, 5);
            const end = f.end_time.slice(0, 5);
            const window = `${start}-${end}`;
            const existing = byTime[window];
            // Same window may repeat across service_type variants — keep the
            // shortest headway (most passenger-favourable).
            if (
              existing === undefined ||
              existing === null ||
              (typeof existing === "number" && intervalMin < existing)
            ) {
              byTime[window] = intervalMin;
            }
          }
        } else {
          const departure = departureOfTripId(trip.trip_id);
          if (!departure) continue;
          if (byTime[departure] === undefined) byTime[departure] = null;
        }
      }

      // Sort each weekday's windows chronologically for stable output.
      for (const wd of Object.keys(schedule)) {
        const byTime = schedule[wd]!;
        const sorted: Record<string, number | string | null> = {};
        for (const t of Object.keys(byTime).sort()) sorted[t] = byTime[t]!;
        schedule[wd] = sorted;
      }

      if (Object.keys(schedule).length === 0) continue;
      variants.push({ from, to, schedule });
    }

    if (variants.length === 0) continue;
    result[key] = variants;
  }

  return result;
}
