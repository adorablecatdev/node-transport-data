import { Company, type Localized, type StopOutput } from "../../types.js";
import type { NlbRoute, RouteStopGroup } from "./api.js";

export type NlbRouteOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: string;
  origin: Localized;
  destination: Localized;
};

export type NlbRouteStopsOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: string;
  stops: StopOutput[];
};

function nlbCompositeId(route: string, routeId: string): string {
  return `${Company.NLB}-${route}-${routeId}`;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

const ROUTE_FIELDS = [
  "routeId",
  "routeNo",
  "routeName_c",
  "routeName_s",
  "routeName_e",
] as const;

function hasAllFields(obj: object, fields: readonly string[]): boolean {
  const record = obj as Record<string, unknown>;
  return fields.every((f) => !isBlank(record[f]));
}

function splitName(name: string): { origin: string; destination: string } {
  const idx = name.indexOf(">");
  if (idx < 0) return { origin: name.trim(), destination: name.trim() };
  return { origin: name.slice(0, idx).trim(), destination: name.slice(idx + 1).trim() };
}

function localizedEndpoints(r: NlbRoute): { origin: Localized; destination: Localized } {
  const en = splitName(r.routeName_e);
  const tc = splitName(r.routeName_c);
  const sc = splitName(r.routeName_s);
  return {
    origin: { en: en.origin, tc: tc.origin, sc: sc.origin },
    destination: { en: en.destination, tc: tc.destination, sc: sc.destination },
  };
}

export function transformRoutes(
  routes: NlbRoute[],
  routeStopGroups: RouteStopGroup[],
): NlbRouteOutput[] {
  const nonEmpty = new Set<string>();
  for (const g of routeStopGroups) {
    if (g.stops.length > 0) nonEmpty.add(g.routeId);
  }

  const out: NlbRouteOutput[] = [];
  let skippedMissing = 0;
  let skippedNoStops = 0;

  for (const r of routes) {
    if (!hasAllFields(r, ROUTE_FIELDS)) {
      skippedMissing++;
      continue;
    }
    if (!nonEmpty.has(r.routeId)) {
      skippedNoStops++;
      continue;
    }
    const { origin, destination } = localizedEndpoints(r);
    out.push({
      record_id: nlbCompositeId(r.routeNo, r.routeId),
      company: Company.NLB,
      route_id: r.routeId,
      route: r.routeNo,
      origin,
      destination,
    });
  }

  if (skippedMissing > 0)
    console.warn(`[nlb] skipped ${skippedMissing} route(s) with missing fields`);
  if (skippedNoStops > 0)
    console.warn(`[nlb] skipped ${skippedNoStops} route(s) with no stops`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function transformRouteStops(
  routes: NlbRoute[],
  routeStopGroups: RouteStopGroup[],
): NlbRouteStopsOutput[] {
  const routeById = new Map<string, NlbRoute>();
  for (const r of routes) {
    if (hasAllFields(r, ROUTE_FIELDS)) routeById.set(r.routeId, r);
  }

  const out: NlbRouteStopsOutput[] = [];
  let skippedMissing = 0;

  for (const g of routeStopGroups) {
    if (g.stops.length === 0) continue;
    const r = routeById.get(g.routeId);
    if (!r) {
      skippedMissing++;
      continue;
    }

    const stops: StopOutput[] = g.stops.map((s, i) => ({
      seq: i + 1,
      stop_id: s.stopId,
      name: { en: s.stopName_e, tc: s.stopName_c, sc: s.stopName_s },
      lat: Number(s.latitude),
      long: Number(s.longitude),
    }));

    out.push({
      record_id: nlbCompositeId(r.routeNo, r.routeId),
      company: Company.NLB,
      route_id: r.routeId,
      route: r.routeNo,
      stops,
    });
  }

  if (skippedMissing > 0)
    console.warn(`[nlb] skipped ${skippedMissing} route-stop group(s) for unknown routes`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
