import { parseCsv } from "../../lib/gtfs.js";
import { writeJson } from "../../lib/io.js";
import type { MappingEntry } from "./ctb_gtfs_mapping.js";

type TripRow = { trip_id: string; route_id: string; service_id: string };
type CalendarRow = {
  service_id: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
};
type FrequencyRow = {
  trip_id: string;
  start_time: string;
  end_time: string;
  headway_secs: string;
};

type WeekdayTable = Record<string, Record<string, number | string | null>>;

type TimetableEntry = {
  origin: string;
  destination: string;
  schedule: WeekdayTable;
};

const WEEKDAY_FIELDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function weekdayCodeOf(row: CalendarRow): string {
  let code = "";
  for (const day of WEEKDAY_FIELDS) code += row[day] === "1" ? "1" : "0";
  return code;
}

// GTFS trip_id shape is `<route_id>-<dir>-<service_id>-<HHMM>`. Segment 2 is 1
// (same physical direction as route_long_name / the mapped CTB record) or 2
// (opposite direction). It does NOT correlate universally with CTB API
// bound=O/I — some GTFS routes' long_names describe the inbound direction.
function isReverseOfMapping(tripId: string): boolean | undefined {
  const parts = tripId.split("-");
  if (parts.length !== 4) return undefined;
  if (parts[1] === "1") return false;
  if (parts[1] === "2") return true;
  return undefined;
}

function departureFromTripId(tripId: string): string | undefined {
  const parts = tripId.split("-");
  if (parts.length !== 4) return undefined;
  const t = parts[3];
  if (!t || t.length < 4) return undefined;
  return `${t.slice(0, t.length - 2)}:${t.slice(-2)}`;
}

// CTB record_id: `CTB-<route>-<bound>` (no service_type suffix, unlike KMB).
// The bound letter is the trailing segment, so match `-[OI]$`. Swap the bound
// letter (O↔I) for the mirror CTB record.
function flipBound(recordId: string): string | undefined {
  if (!/-[OI]$/.test(recordId)) return undefined;
  return recordId.replace(/-([OI])$/, (_, b) => `-${b === "O" ? "I" : "O"}`);
}

export async function buildCtbGtfsTimetable(inputs: {
  tripsCsv: string;
  calendarCsv: string;
  frequenciesCsv: string;
  mapping: Record<string, MappingEntry>;
  outPath: string;
}): Promise<void> {
  const trips = parseCsv<TripRow>(inputs.tripsCsv);
  const calendar = parseCsv<CalendarRow>(inputs.calendarCsv);
  const frequencies = parseCsv<FrequencyRow>(inputs.frequenciesCsv);

  const tripById = new Map<string, TripRow>();
  for (const t of trips) tripById.set(t.trip_id, t);

  const weekdayByService = new Map<string, string>();
  for (const c of calendar) weekdayByService.set(c.service_id, weekdayCodeOf(c));

  // record_id → gtfs_route_id → weekday → time → interval. The inner map keyed
  // by GTFS route_id becomes the array in the final output — one element per
  // GTFS route that lands on the same CTB record_id.
  const nested = new Map<string, Map<string, WeekdayTable>>();

  function tableFor(recordId: string, gtfsRouteId: string): WeekdayTable {
    let byRoute = nested.get(recordId);
    if (!byRoute) {
      byRoute = new Map();
      nested.set(recordId, byRoute);
    }
    let table = byRoute.get(gtfsRouteId);
    if (!table) {
      table = {};
      byRoute.set(gtfsRouteId, table);
    }
    return table;
  }

  function resolveContext(tripId: string, routeId: string, serviceId: string) {
    const entry = inputs.mapping[routeId];
    if (!entry) return undefined;
    const weekday = weekdayByService.get(serviceId);
    if (!weekday) return undefined;
    const reverse = isReverseOfMapping(tripId);
    if (reverse === undefined) return undefined;
    const recordId = reverse ? flipBound(entry.record_id) : entry.record_id;
    if (!recordId) return undefined;
    return { recordId, gtfsRouteId: routeId, weekday };
  }

  const tripIdsWithFreq = new Set<string>();

  for (const f of frequencies) {
    const trip = tripById.get(f.trip_id);
    if (!trip) continue;
    tripIdsWithFreq.add(f.trip_id);
    const ctx = resolveContext(f.trip_id, trip.route_id, trip.service_id);
    if (!ctx) continue;

    const secs = Number(f.headway_secs);
    if (!Number.isFinite(secs)) continue;
    const intervalMin = Math.round(secs / 60);
    const start = f.start_time.slice(0, 5);
    const end = f.end_time.slice(0, 5);
    const timeWindow = `${start}-${end}`;

    const table = tableFor(ctx.recordId, ctx.gtfsRouteId);
    const byTime = (table[ctx.weekday] ||= {});
    const existing = byTime[timeWindow];
    if (
      existing === undefined ||
      existing === null ||
      (typeof existing === "number" && intervalMin < existing)
    ) {
      byTime[timeWindow] = intervalMin;
    }
  }

  for (const trip of trips) {
    if (tripIdsWithFreq.has(trip.trip_id)) continue;
    const ctx = resolveContext(trip.trip_id, trip.route_id, trip.service_id);
    if (!ctx) continue;
    const departure = departureFromTripId(trip.trip_id);
    if (!departure) continue;
    const table = tableFor(ctx.recordId, ctx.gtfsRouteId);
    const byTime = (table[ctx.weekday] ||= {});
    if (byTime[departure] === undefined) byTime[departure] = null;
  }

  const result: Record<string, TimetableEntry[]> = {};
  for (const [recordId, byRoute] of nested) {
    const entries: TimetableEntry[] = [];
    for (const [gtfsRouteId, table] of byRoute) {
      const entry = inputs.mapping[gtfsRouteId];
      // The mapping's origin/destination describe entry.record_id's direction;
      // when this bucket is the mirror record, swap them so the pair matches
      // the direction of the bucket key.
      const flipped = !!entry && flipBound(entry.record_id) === recordId;
      const sortedByWeekday: WeekdayTable = {};
      for (const wd of Object.keys(table).sort()) {
        const byTime = table[wd];
        if (!byTime) continue;
        const sortedByTime: Record<string, number | string | null> = {};
        for (const t of Object.keys(byTime).sort()) {
          const v = byTime[t];
          if (v !== undefined) sortedByTime[t] = v;
        }
        sortedByWeekday[wd] = sortedByTime;
      }
      entries.push({
        origin: flipped ? entry?.destination ?? "" : entry?.origin ?? "",
        destination: flipped ? entry?.origin ?? "" : entry?.destination ?? "",
        schedule: sortedByWeekday,
      });
    }
    result[recordId] = entries;
  }

  await writeJson(inputs.outPath, result);
  console.log(
    `[ctb-timetable] wrote ${Object.keys(result).length} record_id timetable entries to ${inputs.outPath}`,
  );
}
