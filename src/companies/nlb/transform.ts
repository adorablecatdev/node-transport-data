import {
  Bound,
  Company,
  compositeId,
  type Localized,
  type RouteOutput,
  type RouteStopsOutput,
  type StopOutput,
} from "../../types.js";
import type { NlbRoute, RouteStopGroup } from "./api.js";

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

export type RouteAssignment = {
  route_id: string;
  route: string;
  bound: Bound;
  service_type: string;
  origin: Localized;
  destination: Localized;
};

// Group routes by routeNo, then pair reverse directions to derive bound/service_type.
// Within a routeNo group (sorted by routeId ascending):
//   - Take the first unassigned route as outbound with the current service_type.
//   - If another unassigned route has swapped origin/destination (by routeName_e), mark it inbound
//     with the same service_type. Otherwise the outbound stands alone.
//   - Increment service_type and repeat until all routes are assigned.
export function assignRoutes(routes: NlbRoute[]): Map<string, RouteAssignment> {
  const byNo = new Map<string, NlbRoute[]>();
  for (const r of routes) {
    if (!hasAllFields(r, ROUTE_FIELDS)) continue;
    let list = byNo.get(r.routeNo);
    if (!list) {
      list = [];
      byNo.set(r.routeNo, list);
    }
    list.push(r);
  }

  const out = new Map<string, RouteAssignment>();
  for (const [routeNo, list] of byNo) {
    const sorted = [...list].sort((a, b) => Number(a.routeId) - Number(b.routeId));
    const remaining = new Set(sorted.map((r) => r.routeId));
    let variant = 1;

    for (const r of sorted) {
      if (!remaining.has(r.routeId)) continue;
      remaining.delete(r.routeId);

      const rName = splitName(r.routeName_e);
      const rNameC = splitName(r.routeName_c);
      const rNameS = splitName(r.routeName_s);

      let reverse: NlbRoute | undefined;
      for (const other of sorted) {
        if (!remaining.has(other.routeId)) continue;
        const oName = splitName(other.routeName_e);
        if (oName.origin === rName.destination && oName.destination === rName.origin) {
          reverse = other;
          break;
        }
      }

      const service_type = String(variant);
      out.set(r.routeId, {
        route_id: r.routeId,
        route: routeNo,
        bound: Bound.Outbound,
        service_type,
        origin: { en: rName.origin, tc: rNameC.origin, sc: rNameS.origin },
        destination: { en: rName.destination, tc: rNameC.destination, sc: rNameS.destination },
      });

      if (reverse) {
        remaining.delete(reverse.routeId);
        const oName = splitName(reverse.routeName_e);
        const oNameC = splitName(reverse.routeName_c);
        const oNameS = splitName(reverse.routeName_s);
        out.set(reverse.routeId, {
          route_id: reverse.routeId,
          route: routeNo,
          bound: Bound.Inbound,
          service_type,
          origin: { en: oName.origin, tc: oNameC.origin, sc: oNameS.origin },
          destination: { en: oName.destination, tc: oNameC.destination, sc: oNameS.destination },
        });
      }

      variant++;
    }
  }
  return out;
}

export function transformRoutes(
  routes: NlbRoute[],
  routeStopGroups: RouteStopGroup[],
): RouteOutput[] {
  const assignments = assignRoutes(routes);
  const nonEmpty = new Set<string>();
  for (const g of routeStopGroups) {
    if (g.stops.length > 0) nonEmpty.add(g.routeId);
  }

  const out: RouteOutput[] = [];
  let skippedMissing = 0;
  let skippedNoStops = 0;

  for (const r of routes) {
    const a = assignments.get(r.routeId);
    if (!a) {
      skippedMissing++;
      continue;
    }
    if (!nonEmpty.has(r.routeId)) {
      skippedNoStops++;
      continue;
    }
    out.push({
      record_id: compositeId(Company.NLB, a.route, a.bound, a.service_type),
      company: Company.NLB,
      route_id: a.route_id,
      route: a.route,
      bound: a.bound,
      service_type: a.service_type,
      origin: a.origin,
      destination: a.destination,
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
): RouteStopsOutput[] {
  const assignments = assignRoutes(routes);
  const out: RouteStopsOutput[] = [];
  let skippedMissing = 0;

  for (const g of routeStopGroups) {
    if (g.stops.length === 0) continue;
    const a = assignments.get(g.routeId);
    if (!a) {
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
      record_id: compositeId(Company.NLB, a.route, a.bound, a.service_type),
      company: Company.NLB,
      route_id: a.route_id,
      route: a.route,
      bound: a.bound,
      service_type: a.service_type,
      stops,
    });
  }

  if (skippedMissing > 0)
    console.warn(`[nlb] skipped ${skippedMissing} route-stop group(s) for unknown routes`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

