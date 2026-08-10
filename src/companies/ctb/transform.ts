import { Company, type Localized, type StopOutput } from "../../types.js";
import type { CtbDir, CtbRoute, CtbRouteStop, CtbStop, CtbDirection } from "./api.js";
import { CTB_CIRCULAR_ROUTES } from "./static.js";

export type CtbBound = "I" | "O";

export type CtbRouteOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: CtbBound;
  origin: Localized;
  destination: Localized;
};

export type CtbRouteStopsOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: CtbBound;
  stops: StopOutput[];
};

function ctbCompositeId(route: string, bound: CtbBound): string {
  return `${Company.CTB}-${route}-${bound}`;
}

function dirToBound(d: CtbDir | CtbDirection): CtbBound {
  return d === "O" || d === "outbound" ? "O" : "I";
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function isCircular(route: string): boolean {
  return CTB_CIRCULAR_ROUTES.has(route);
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
): CtbRouteOutput[] {
  const nonEmpty = new Set<string>();
  for (const g of routeStopGroups) {
    if (g.stops.length > 0) nonEmpty.add(`${g.route}|${g.direction}`);
  }

  const out: CtbRouteOutput[] = [];
  let skipped = 0;

  for (const r of routes) {
    if (!hasAllFields(r, ROUTE_FIELDS)) {
      skipped++;
      continue;
    }
    const origin = { en: r.orig_en, tc: r.orig_tc, sc: r.orig_sc };
    const destination = { en: r.dest_en, tc: r.dest_tc, sc: r.dest_sc };
    const circular = isCircular(r.route);
    for (const direction of ["inbound", "outbound"] as const) {
      // Circular routes collapse into a single outbound record; inbound is dropped.
      if (circular && direction === "inbound") continue;
      const hasStops = circular
        ? nonEmpty.has(`${r.route}|outbound`) || nonEmpty.has(`${r.route}|inbound`)
        : nonEmpty.has(`${r.route}|${direction}`);
      if (!hasStops) continue;
      const bound = dirToBound(direction);
      const isOutbound = bound === "O";
      out.push({
        record_id: ctbCompositeId(r.route, bound),
        company: Company.CTB,
        route: r.route,
        bound,
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

function toStopOutput(
  rs: CtbRouteStop,
  seq: number,
  stopsById: Map<string, CtbStop>,
): StopOutput {
  const stop = stopsById.get(rs.stop);
  return {
    seq,
    stop_id: rs.stop,
    name: stop
      ? { en: stop.name_en, tc: stop.name_tc, sc: stop.name_sc }
      : { en: "", tc: "", sc: "" },
    lat: stop ? Number(stop.lat) : NaN,
    long: stop ? Number(stop.long) : NaN,
  };
}

export function transformRouteStops(
  groups: { route: string; direction: CtbDirection; stops: CtbRouteStop[] }[],
  stopsById: Map<string, CtbStop>,
): CtbRouteStopsOutput[] {
  const out: CtbRouteStopsOutput[] = [];
  let skipped = 0;

  // Bucket circular-route inbound stops so they can be appended to outbound.
  const circularInbound = new Map<string, CtbRouteStop[]>();
  for (const g of groups) {
    if (!isCircular(g.route) || g.direction !== "inbound") continue;
    if (g.stops.length > 0) circularInbound.set(g.route, g.stops);
  }
  const circularSeen = new Set<string>();

  for (const g of groups) {
    if (g.stops.length === 0) continue;

    if (isCircular(g.route)) {
      // Skip inbound groups — they merge into outbound.
      if (g.direction === "inbound") continue;
      circularSeen.add(g.route);

      const record_id = ctbCompositeId(g.route, "O");
      const outboundSorted = [...g.stops].sort((a, b) => Number(a.seq) - Number(b.seq));
      const inboundSorted = [...(circularInbound.get(g.route) ?? [])].sort(
        (a, b) => Number(a.seq) - Number(b.seq),
      );

      const stops: StopOutput[] = [];
      let nextSeq = 1;
      for (const rs of [...outboundSorted, ...inboundSorted]) {
        if (!hasAllFields(rs, ROUTE_STOP_FIELDS)) {
          skipped++;
          continue;
        }
        stops.push(toStopOutput(rs, nextSeq++, stopsById));
      }

      out.push({
        record_id,
        company: Company.CTB,
        route: g.route,
        bound: "O",
        stops,
      });
      continue;
    }

    const bound = dirToBound(g.direction);
    const record_id = ctbCompositeId(g.route, bound);
    const stops: StopOutput[] = [];

    for (const rs of g.stops) {
      if (!hasAllFields(rs, ROUTE_STOP_FIELDS)) {
        skipped++;
        continue;
      }
      stops.push(toStopOutput(rs, Number(rs.seq), stopsById));
    }

    stops.sort((a, b) => a.seq - b.seq);
    out.push({
      record_id,
      company: Company.CTB,
      route: g.route,
      bound,
      stops,
    });
  }

  // Handle circular routes that only had inbound data (no outbound group iterated).
  for (const [route, inboundStops] of circularInbound) {
    if (circularSeen.has(route)) continue;
    const record_id = ctbCompositeId(route, "O");
    const inboundSorted = [...inboundStops].sort((a, b) => Number(a.seq) - Number(b.seq));
    const stops: StopOutput[] = [];
    let nextSeq = 1;
    for (const rs of inboundSorted) {
      if (!hasAllFields(rs, ROUTE_STOP_FIELDS)) {
        skipped++;
        continue;
      }
      stops.push(toStopOutput(rs, nextSeq++, stopsById));
    }
    out.push({
      record_id,
      company: Company.CTB,
      route,
      bound: "O",
      stops,
    });
  }

  if (skipped > 0) console.warn(`[ctb] skipped ${skipped} route-stop(s) with missing fields`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
