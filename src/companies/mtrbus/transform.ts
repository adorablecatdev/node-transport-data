import { Company, type Localized, type StopOutput } from "../../types.js";
import type { MtrbDir, MtrbRoute, MtrbStop } from "./api.js";

export type MtrbBound = "i" | "o";

export type MtrbRouteOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound_temp: MtrbBound;
  bound: string;
  origin: Localized;
  destination: Localized;
};

export type MtrbRouteStopsOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound_temp: MtrbBound;
  bound: string;
  stops: StopOutput[];
};

function mtrbCompositeId(route: string, bound: string): string {
  return `${Company.MTRB}-${route}-${bound}`;
}

function dirToBound(d: MtrbDir): MtrbBound {
  return d === "O" ? "o" : "i";
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

const ROUTE_FIELDS = [
  "ROUTE_ID",
  "ROUTE_NAME_CHI",
  "ROUTE_NAME_ENG",
  "REFERENCE_ID",
] as const;

const STOP_FIELDS = [
  "DIRECTION",
  "STATION_SEQNO",
  "STATION_ID",
  "STATION_NAME_CHI",
  "STATION_NAME_ENG",
  "REFERENCE_ID",
] as const;

function hasAllFields(obj: object, fields: readonly string[]): boolean {
  const record = obj as Record<string, unknown>;
  return fields.every((f) => !isBlank(record[f]));
}

function splitName(name: string, sep: string): { origin: string; destination: string } {
  const idx = name.indexOf(sep);
  if (idx < 0) return { origin: name, destination: name };
  return { origin: name.slice(0, idx).trim(), destination: name.slice(idx + sep.length).trim() };
}

function groupStopsByRefAndDir(stops: MtrbStop[]): Map<string, Map<MtrbDir, MtrbStop[]>> {
  const byRef = new Map<string, Map<MtrbDir, MtrbStop[]>>();
  for (const s of stops) {
    if (!hasAllFields(s, STOP_FIELDS)) continue;
    let byDir = byRef.get(s.REFERENCE_ID);
    if (!byDir) {
      byDir = new Map();
      byRef.set(s.REFERENCE_ID, byDir);
    }
    let list = byDir.get(s.DIRECTION);
    if (!list) {
      list = [];
      byDir.set(s.DIRECTION, list);
    }
    list.push(s);
  }
  return byRef;
}

export function transformRoutes(routes: MtrbRoute[], _stops: MtrbStop[]): MtrbRouteOutput[] {
  const out: MtrbRouteOutput[] = [];
  let skipped = 0;

  for (const r of routes) {
    if (!hasAllFields(r, ROUTE_FIELDS)) {
      skipped++;
      continue;
    }
    const en = splitName(r.ROUTE_NAME_ENG, " to ");
    const tc = splitName(r.ROUTE_NAME_CHI, "至");
    const origin: Localized = { en: en.origin, tc: tc.origin, sc: tc.origin };
    const destination: Localized = { en: en.destination, tc: tc.destination, sc: tc.destination };

    const lines: Array<{ bound: string; bound_temp: MtrbBound }> = [];
    if (!isBlank(r.LINE_UP)) lines.push({ bound: r.LINE_UP, bound_temp: "o" });
    if (!isBlank(r.LINE_DOWN)) lines.push({ bound: r.LINE_DOWN, bound_temp: "i" });

    for (const { bound, bound_temp } of lines) {
      const isInbound = bound_temp === "i";
      out.push({
        record_id: mtrbCompositeId(r.ROUTE_ID, bound),
        company: Company.MTRB,
        route: r.ROUTE_ID,
        bound_temp,
        bound,
        origin: isInbound ? destination : origin,
        destination: isInbound ? origin : destination,
      });
    }
  }

  if (skipped > 0) console.warn(`[mtrb] skipped ${skipped} route(s) with missing fields`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function transformRouteStops(
  routes: MtrbRoute[],
  stops: MtrbStop[],
): MtrbRouteStopsOutput[] {
  const routeByRef = new Map(routes.map((r) => [r.REFERENCE_ID, r]));
  const byRef = groupStopsByRefAndDir(stops);
  const out: MtrbRouteStopsOutput[] = [];
  let skipped = 0;

  for (const [refId, byDir] of byRef) {
    const route = routeByRef.get(refId);
    if (!route) {
      skipped += [...byDir.values()].reduce((n, l) => n + l.length, 0);
      continue;
    }
    for (const [dir, list] of byDir) {
      if (list.length === 0) continue;
      const bound_temp = dirToBound(dir);
      const bound = dir === "O" ? route.LINE_UP : route.LINE_DOWN;
      if (isBlank(bound)) {
        skipped += list.length;
        continue;
      }
      const stopOutputs: StopOutput[] = list.map((s) => ({
        seq: Number(s.STATION_SEQNO),
        stop_id: s.STATION_ID,
        name: { en: s.STATION_NAME_ENG, tc: s.STATION_NAME_CHI, sc: s.STATION_NAME_CHI },
        lat: Number(s.STATION_LATITUDE),
        long: Number(s.STATION_LONGITUDE),
      }));
      stopOutputs.sort((a, b) => a.seq - b.seq);
      out.push({
        record_id: mtrbCompositeId(route.ROUTE_ID, bound),
        company: Company.MTRB,
        route: route.ROUTE_ID,
        bound_temp,
        bound,
        stops: stopOutputs,
      });
    }
  }

  if (skipped > 0) console.warn(`[mtrb] skipped ${skipped} stop(s) for unknown routes`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
