import { parseCsv } from "../lib/gtfs.js";
import { Company } from "../types.js";

// Key is either a window "HH:MM-HH:MM" (value = headway minutes) or a single
// departure "HH:MM" (value = null, meaning one scheduled trip with no headway).
// The null form covers peak-only "P" / school "S" / special-day variants — e.g.
// KMB 297P with departures at 07:55 and 08:10 — which appear in trips.txt but
// have no rows in frequencies.txt.
export type Timetable = Record<string, Record<string, Record<string, number | null>>>;

// GTFS agency_id → project Company. Agencies not listed here (XB, PI, DB, FERRY,
// PTRAM, TRAM) have no Company counterpart and are dropped. GMB is resolved
// per-route via gmbRegionByRouteId since the feed doesn't split HKI/KLN/NT.
const AGENCY_TO_COMPANY: Record<string, Company> = {
  KMB: Company.KMB,
  LWB: Company.KMB,
  CTB: Company.CTB,
  "KMB+CTB": Company.KMBCTB,
  "LWB+CTB": Company.KMBCTB,
  LRTFeeder: Company.MTRB,
  NLB: Company.NLB,
};

type RouteRow = { route_id: string; agency_id: string; route_short_name: string };
type TripRow = { trip_id: string; route_id: string; service_id: string };

// GTFS trip_id shape is `<route_id>-<dir>-<service_id>-<HHMM>` across every agency
// in this feed; the second segment is 1 (inbound) or 2 (outbound). The feed has no
// direction_id column and no service_type equivalent, so variants like KMB 2F's
// service_type=2 collapse into service_type=1 in the output key.
function directionFromTripId(tripId: string): "outbound" | "inbound" | undefined {
  const parts = tripId.split("-");
  if (parts.length !== 4) return undefined;
  if (parts[1] === "1") return "inbound";
  if (parts[1] === "2") return "outbound";
  return undefined;
}

// Last trip_id segment is HHMM (e.g. "8159-1-287-0755" → "07:55"). Returned as
// HH:MM. GTFS may use hour >= 24 for post-midnight departures; preserve them.
function departureFromTripId(tripId: string): string | undefined {
  const parts = tripId.split("-");
  if (parts.length !== 4) return undefined;
  const t = parts[3];
  if (!t || t.length < 4) return undefined;
  return `${t.slice(0, t.length - 2)}:${t.slice(-2)}`;
}
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
type FrequencyRow = { trip_id: string; start_time: string; end_time: string; headway_secs: string };

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

export function transformTimetable(inputs: {
  routesCsv: string;
  tripsCsv: string;
  calendarCsv: string;
  frequenciesCsv: string;
  gmbRegionByRouteId?: Map<string, Company>;
}): Timetable {
  const routes = parseCsv<RouteRow>(inputs.routesCsv);
  const trips = parseCsv<TripRow>(inputs.tripsCsv);
  const calendar = parseCsv<CalendarRow>(inputs.calendarCsv);
  const frequencies = parseCsv<FrequencyRow>(inputs.frequenciesCsv);
  const gmbMap = inputs.gmbRegionByRouteId;

  const routeById = new Map<string, RouteRow>();
  for (const r of routes) routeById.set(r.route_id, r);

  const tripById = new Map<string, TripRow>();
  for (const t of trips) tripById.set(t.trip_id, t);

  const weekdayByService = new Map<string, string>();
  for (const c of calendar) weekdayByService.set(c.service_id, weekdayCodeOf(c));

  const result: Timetable = {};
  let orphanTrips = 0;
  let orphanRoutes = 0;
  let orphanServices = 0;
  const droppedByAgency = new Map<string, number>();

  function resolveContext(tripId: string, routeId: string, serviceId: string) {
    const route = routeById.get(routeId);
    if (!route) {
      orphanRoutes++;
      return undefined;
    }
    const weekday = weekdayByService.get(serviceId);
    if (!weekday) {
      orphanServices++;
      return undefined;
    }
    let company: Company | undefined;
    if (route.agency_id === "GMB") company = gmbMap?.get(route.route_id);
    else company = AGENCY_TO_COMPANY[route.agency_id];
    if (!company) {
      droppedByAgency.set(route.agency_id, (droppedByAgency.get(route.agency_id) ?? 0) + 1);
      return undefined;
    }
    const direction = directionFromTripId(tripId);
    if (!direction) {
      orphanTrips++;
      return undefined;
    }
    return { route, weekday, company, direction };
  }

  const tripIdsWithFreq = new Set<string>();

  for (const f of frequencies) {
    const trip = tripById.get(f.trip_id);
    if (!trip) {
      orphanTrips++;
      continue;
    }
    tripIdsWithFreq.add(f.trip_id);
    const ctx = resolveContext(f.trip_id, trip.route_id, trip.service_id);
    if (!ctx) continue;

    const key = `${ctx.company}-${ctx.route.route_short_name}-${ctx.direction}-1`;
    const secs = Number(f.headway_secs);
    if (!Number.isFinite(secs)) continue;
    // GTFS headway_secs is always a whole minute in this feed; round for safety.
    const intervalMin = Math.round(secs / 60);
    // start/end HH:MM:SS → HH:MM-HH:MM. GTFS may use hour >= 24 for post-midnight
    // trips; preserve values like "24:15" so the ordering stays chronological.
    const start = f.start_time.slice(0, 5);
    const end = f.end_time.slice(0, 5);
    const timeWindow = `${start}-${end}`;

    const byWeekday = (result[key] ||= {});
    const byTime = (byWeekday[ctx.weekday] ||= {});
    const existing = byTime[timeWindow];
    // Same (company, route, direction, weekday, window) can still repeat across
    // multiple GTFS trips — different service_type variants collapse under
    // service_type=1, and LWB/CTB joint routes merge under a single company. Keep
    // the shortest headway: it's the most passenger-favourable read. A prior null
    // (single scheduled departure at the same window) is overwritten by any real
    // headway number.
    if (existing === undefined || existing === null || intervalMin < existing) {
      byTime[timeWindow] = intervalMin;
    }
  }

  // Scheduled trips: rows in trips.txt with no matching frequencies row. These are
  // peak-only "P", school "S", and other fixed-schedule variants (e.g. KMB 297P
  // with departures at 07:55 and 08:10). Key is bare "HH:MM", value null.
  for (const trip of trips) {
    if (tripIdsWithFreq.has(trip.trip_id)) continue;
    const ctx = resolveContext(trip.trip_id, trip.route_id, trip.service_id);
    if (!ctx) continue;
    const departure = departureFromTripId(trip.trip_id);
    if (!departure) {
      orphanTrips++;
      continue;
    }
    const key = `${ctx.company}-${ctx.route.route_short_name}-${ctx.direction}-1`;
    const byWeekday = (result[key] ||= {});
    const byTime = (byWeekday[ctx.weekday] ||= {});
    if (byTime[departure] === undefined) byTime[departure] = null;
  }

  if (orphanTrips || orphanRoutes || orphanServices) {
    console.warn(
      `[time_table] dropped frequencies: ${orphanTrips} unknown trip_id, ` +
        `${orphanRoutes} unknown route_id, ${orphanServices} unknown service_id`,
    );
  }
  if (droppedByAgency.size) {
    const summary = [...droppedByAgency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([a, n]) => `${a}=${n}`)
      .join(", ");
    console.warn(`[time_table] dropped frequencies from unmapped agencies: ${summary}`);
  }

  for (const byWeekday of Object.values(result)) {
    for (const wd of Object.keys(byWeekday)) {
      const byTime = byWeekday[wd];
      if (!byTime) continue;
      const sorted: Record<string, number | null> = {};
      for (const t of Object.keys(byTime).sort()) {
        const v = byTime[t];
        if (v !== undefined) sorted[t] = v;
      }
      byWeekday[wd] = sorted;
    }
  }

  return result;
}
