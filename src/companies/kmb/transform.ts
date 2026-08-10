import { Company, type Localized, type StopOutput } from "../../types.js";
import type { KmbBound, KmbRoute, KmbRouteStop, KmbStop } from "./api.js";

export type KmbRouteOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: KmbBound;
  service_type: string;
  origin: Localized;
  destination: Localized;
};

export type KmbRouteStopsOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: KmbBound;
  service_type: string;
  stops: StopOutput[];
};

function kmbCompositeId(route: string, bound: KmbBound, service_type: string): string {
  return `${Company.KMB}-${route}-${bound}-${service_type}`;
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

export function transformRoutes(routes: KmbRoute[]): KmbRouteOutput[] {
  let skipped = 0;
  const out: KmbRouteOutput[] = [];
  for (const r of routes) {
    if (!hasAllFields(r, ROUTE_FIELDS)) {
      skipped++;
      continue;
    }
    const id = kmbCompositeId(r.route, r.bound, r.service_type);
    out.push({
      record_id: id,
      company: Company.KMB,
      route: r.route,
      bound: r.bound,
      service_type: r.service_type,
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
): KmbRouteStopsOutput[] {
  const stopById = new Map(stops.map((s) => [s.stop, s]));
  const groups = new Map<string, KmbRouteStopsOutput>();
  let skipped = 0;

  for (const rs of routeStops) {
    if (!hasAllFields(rs, ROUTE_STOP_FIELDS)) {
      skipped++;
      continue;
    }
    const id = kmbCompositeId(rs.route, rs.bound, rs.service_type);
    let group = groups.get(id);
    if (!group) {
      group = {
        record_id: id,
        company: Company.KMB,
        route: rs.route,
        bound: rs.bound,
        service_type: rs.service_type,
        stops: [],
      };
      groups.set(id, group);
    }

    const stop = stopById.get(rs.stop);
    group.stops.push({
      seq: Number(rs.seq),
      stop_id: rs.stop,
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
