import { Bound, Company, type Localized } from "../../types.js";
import type { KmbBound, KmbRoute, KmbRouteStop, KmbStop } from "./api.js";

export type RouteOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: string;
  bound: Bound;
  serviceType: string;
  origin: Localized;
  destination: Localized;
};

export type StopOutput = {
  seq: number;
  stopId: string;
  name: Localized;
  lat: number;
  long: number;
};

export type RouteStopsOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: string;
  bound: Bound;
  serviceType: string;
  stops: StopOutput[];
};

function compositeId(company: Company, route: string, bound: Bound, serviceType: string): string {
  return `${company}-${route}-${bound}-${serviceType}`;
}

function toBound(b: KmbBound): Bound {
  return b === "O" ? Bound.Outbound : Bound.Inbound;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function hasAllFields(obj: object, fields: readonly string[]): boolean {
  const record = obj as Record<string, unknown>;
  return fields.every((f) => !isBlank(record[f]));
}

const ROUTE_FIELDS = [
  "route",
  "bound",
  "service_type",
  "orig_en",
  "orig_tc",
  "orig_sc",
  "dest_en",
  "dest_tc",
  "dest_sc",
] as const;

const ROUTE_STOP_FIELDS = ["route", "bound", "service_type", "seq", "stop"] as const;

export function transformRoutes(routes: KmbRoute[]): RouteOutput[] {
  let skipped = 0;
  const out: RouteOutput[] = [];
  for (const r of routes) {
    if (!hasAllFields(r, ROUTE_FIELDS)) {
      skipped++;
      continue;
    }
    const bound = toBound(r.bound);
    const id = compositeId(Company.KMB, r.route, bound, r.service_type);
    out.push({
      record_id: id,
      company: Company.KMB,
      route_id: r.route,
      route: r.route,
      bound,
      serviceType: r.service_type,
      origin: { en: r.orig_en, tc: r.orig_tc, sc: r.orig_sc },
      destination: { en: r.dest_en, tc: r.dest_tc, sc: r.dest_sc },
    });
  }
  if (skipped > 0) console.warn(`[kmb] skipped ${skipped} route(s) with missing fields`);
  return out;
}

export function transformRouteStops(
  routeStops: KmbRouteStop[],
  stops: KmbStop[],
): RouteStopsOutput[] {
  const stopById = new Map(stops.map((s) => [s.stop, s]));
  const groups = new Map<string, RouteStopsOutput>();
  let skipped = 0;

  for (const rs of routeStops) {
    if (!hasAllFields(rs, ROUTE_STOP_FIELDS)) {
      skipped++;
      continue;
    }
    const bound = toBound(rs.bound);
    const id = compositeId(Company.KMB, rs.route, bound, rs.service_type);
    let group = groups.get(id);
    if (!group) {
      group = {
        record_id: id,
        company: Company.KMB,
        route_id: rs.route,
        route: rs.route,
        bound,
        serviceType: rs.service_type,
        stops: [],
      };
      groups.set(id, group);
    }

    const stop = stopById.get(rs.stop);
    group.stops.push({
      seq: Number(rs.seq),
      stopId: rs.stop,
      name: stop
        ? { en: stop.name_en, tc: stop.name_tc, sc: stop.name_sc }
        : { en: "", tc: "", sc: "" },
      lat: stop ? Number(stop.lat) : NaN,
      long: stop ? Number(stop.long) : NaN,
    });
  }

  for (const group of groups.values()) {
    group.stops.sort((a, b) => a.seq - b.seq);
  }

  if (skipped > 0) console.warn(`[kmb] skipped ${skipped} route-stop(s) with missing fields`);
  return [...groups.values()].sort((a, b) => a.record_id.localeCompare(b.record_id));
}
