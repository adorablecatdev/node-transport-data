import {
  Bound,
  Company,
  compositeId,
  type RouteOutput,
  type RouteStopsOutput,
  type StopOutput,
} from "../../types.js";
import type { CtbDir, CtbRoute, CtbRouteStop, CtbStop, CtbDirection } from "./api.js";

const SERVICE_TYPE = "1";

function dirToBound(d: CtbDir | CtbDirection): Bound {
  return d === "O" || d === "outbound" ? Bound.Outbound : Bound.Inbound;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

const ROUTE_FIELDS = [
  "route",
  "orig_en",
  "orig_tc",
  "orig_sc",
  "dest_en",
  "dest_tc",
  "dest_sc",
] as const;

const ROUTE_STOP_FIELDS = ["route", "dir", "seq", "stop"] as const;

function hasAllFields(obj: object, fields: readonly string[]): boolean {
  const record = obj as Record<string, unknown>;
  return fields.every((f) => !isBlank(record[f]));
}

export function transformRoutes(
  routes: CtbRoute[],
  routeStopGroups: { route: string; direction: CtbDirection; stops: CtbRouteStop[] }[],
): RouteOutput[] {
  const nonEmpty = new Set<string>();
  for (const g of routeStopGroups) {
    if (g.stops.length > 0) nonEmpty.add(`${g.route}|${g.direction}`);
  }

  const out: RouteOutput[] = [];
  let skipped = 0;

  for (const r of routes) {
    if (!hasAllFields(r, ROUTE_FIELDS)) {
      skipped++;
      continue;
    }
    const origin = { en: r.orig_en, tc: r.orig_tc, sc: r.orig_sc };
    const destination = { en: r.dest_en, tc: r.dest_tc, sc: r.dest_sc };
    for (const direction of ["inbound", "outbound"] as const) {
      if (!nonEmpty.has(`${r.route}|${direction}`)) continue;
      const bound = dirToBound(direction);
      const isOutbound = bound === Bound.Outbound;
      out.push({
        record_id: compositeId(Company.CTB, r.route, bound, SERVICE_TYPE),
        company: Company.CTB,
        route_id: r.route,
        route: r.route,
        bound,
        service_type: SERVICE_TYPE,
        origin: isOutbound ? origin : destination,
        destination: isOutbound ? destination : origin,
      });
    }
  }

  if (skipped > 0) console.warn(`[ctb] skipped ${skipped} route(s) with missing fields`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function collectStopIds(
  groups: { stops: CtbRouteStop[] }[],
): string[] {
  const ids = new Set<string>();
  for (const g of groups) {
    for (const rs of g.stops) {
      if (!isBlank(rs.stop)) ids.add(rs.stop);
    }
  }
  return [...ids];
}

export function transformRouteStops(
  groups: { route: string; direction: CtbDirection; stops: CtbRouteStop[] }[],
  stopsById: Map<string, CtbStop>,
): RouteStopsOutput[] {
  const out: RouteStopsOutput[] = [];
  let skipped = 0;

  for (const g of groups) {
    if (g.stops.length === 0) continue;
    const bound = dirToBound(g.direction);
    const record_id = compositeId(Company.CTB, g.route, bound, SERVICE_TYPE);
    const stops: StopOutput[] = [];

    for (const rs of g.stops) {
      if (!hasAllFields(rs, ROUTE_STOP_FIELDS)) {
        skipped++;
        continue;
      }
      const stop = stopsById.get(rs.stop);
      stops.push({
        seq: Number(rs.seq),
        stop_id: rs.stop,
        name: stop
          ? { en: stop.name_en, tc: stop.name_tc, sc: stop.name_sc }
          : { en: "", tc: "", sc: "" },
        lat: stop ? Number(stop.lat) : NaN,
        long: stop ? Number(stop.long) : NaN,
      });
    }

    stops.sort((a, b) => a.seq - b.seq);
    out.push({
      record_id,
      company: Company.CTB,
      route_id: g.route,
      route: g.route,
      bound,
      service_type: SERVICE_TYPE,
      stops,
    });
  }

  if (skipped > 0) console.warn(`[ctb] skipped ${skipped} route-stop(s) with missing fields`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
