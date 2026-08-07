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

const CTB_ROUTES_JSON = "out/ctb/routes.json";
const CTB_AGENCY_ID = "CTB";

type CtbRouteRecord = {
  record_id: string;
  company: string;
  route: string;
  bound: "O" | "I";
  origin?: { tc?: string };
  destination?: { tc?: string };
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

// Multiset character overlap between two strings — the count of characters in
// `a` that also appear in `b`, respecting multiplicity. Symmetric enough for
// picking the more similar of two candidates; ignores order.
function charOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const pool = new Map<string, number>();
  for (const ch of b) pool.set(ch, (pool.get(ch) ?? 0) + 1);
  let score = 0;
  for (const ch of a) {
    const n = pool.get(ch) ?? 0;
    if (n > 0) {
      score++;
      pool.set(ch, n - 1);
    }
  }
  return score;
}

// Score how well (from, to) — the two halves of route_long_name — line up with
// a record's declared origin/destination. Higher = better match.
function similarityToRecord(
  from: string,
  to: string,
  record: CtbRouteRecord,
): number {
  const origin = record.origin?.tc ?? "";
  const destination = record.destination?.tc ?? "";
  return charOverlap(from, origin) + charOverlap(to, destination);
}

export async function transformCtb(gtfs: ParsedGtfs): Promise<Timetable> {
  const routesJson = await readJsonIfExists<Record<string, CtbRouteRecord>>(CTB_ROUTES_JSON);
  if (!routesJson) {
    console.warn(`[time_table][ctb] ${CTB_ROUTES_JSON} not found — skipping CTB`);
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

  // route → { I: record, O: record } (CTB record_ids are `CTB-{route}-{bound}`)
  const recordsByRoute = new Map<string, { I?: CtbRouteRecord; O?: CtbRouteRecord }>();
  for (const record of Object.values(routesJson)) {
    if (record.company !== CTB_AGENCY_ID) continue;
    let pair = recordsByRoute.get(record.route);
    if (!pair) {
      pair = {};
      recordsByRoute.set(record.route, pair);
    }
    pair[record.bound] = record;
  }

  // For each GTFS route_id, decide which record_id its single-bound trip pool
  // should be assigned to. When trips span both bounds we keep the default
  // 1→O / 2→I mapping and this map has no entry.
  const overrideBoundByRouteId = new Map<string, "O" | "I">();
  for (const routeRow of gtfs.routes) {
    if (routeRow.agency_id !== CTB_AGENCY_ID) continue;
    const trips = tripsByRouteId.get(routeRow.route_id) ?? [];
    if (trips.length === 0) continue;

    const bounds = new Set<"O" | "I">();
    for (const t of trips) {
      const b = boundOfTripId(t.trip_id);
      if (b) bounds.add(b);
    }
    if (bounds.size !== 1) continue;

    const pair = recordsByRoute.get(routeRow.route_short_name);
    if (!pair?.I || !pair.O) continue;

    const { from, to } = splitLongName(routeRow.route_long_name);
    const scoreI = similarityToRecord(from, to, pair.I);
    const scoreO = similarityToRecord(from, to, pair.O);
    if (scoreI === scoreO) continue;
    overrideBoundByRouteId.set(routeRow.route_id, scoreI > scoreO ? "I" : "O");
  }

  const result: Timetable = {};

  for (const [key, record] of Object.entries(routesJson)) {
    if (record.company !== CTB_AGENCY_ID) continue;

    const matchedRoutes =
      routesByAgencyShort.get(`${CTB_AGENCY_ID}|${record.route}`) ?? [];
    if (matchedRoutes.length === 0) continue;

    const variants: TimetableVariant[] = [];

    for (const routeRow of matchedRoutes) {
      const trips = tripsByRouteId.get(routeRow.route_id) ?? [];
      const schedule: Schedule = {};

      // If all this route_id's trips share one bound, fuzzy-match against the
      // record's origin/destination has assigned them to a specific bound —
      // include every trip for that bound and ignore the trip_id segment.
      const overrideBound = overrideBoundByRouteId.get(routeRow.route_id);

      // route_long_name is authored in the trip_id's natural direction. Swap
      // from/to only when the *original* trip direction is inbound — i.e. no
      // override and this is the inbound record. Overridden route_ids keep the
      // parsed order because the long name still describes their actual path.
      const parsed = splitLongName(routeRow.route_long_name);
      const swap = overrideBound === undefined && record.bound === "I";
      const { from, to } = swap ? { from: parsed.to, to: parsed.from } : parsed;

      for (const trip of trips) {
        if (overrideBound !== undefined) {
          if (overrideBound !== record.bound) continue;
        } else if (boundOfTripId(trip.trip_id) !== record.bound) {
          continue;
        }

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
            // Same window may repeat across route variants — keep the shortest
            // headway (most passenger-favourable).
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
