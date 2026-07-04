import { Bound, Company, type Localized } from "../../types.js";
import type { LrtDirection, LrtRouteStop } from "./api.js";
import { STOP_LOCATION } from "./static.js";

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

const SERVICE_TYPE = "1";

function stopCoords(stopCode: string): { lat: number; long: number } {
  const loc = STOP_LOCATION[stopCode];
  if (!loc) return { lat: NaN, long: NaN };
  return { lat: Number(loc.lat), long: Number(loc.long) };
}

function compositeId(company: Company, routeId: string, bound: Bound, serviceType: string): string {
  return `${company}-${routeId}-${bound}-${serviceType}`;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

const REQUIRED_FIELDS = [
  "LINE_CODE",
  "DIRECTION",
  "STOP_CODE",
  "STOP_ID",
  "STOP_NAME_CHI",
  "STOP_NAME_ENG",
  "SEQUENCE",
] as const;

function hasAllFields(obj: object, fields: readonly string[]): boolean {
  const record = obj as Record<string, unknown>;
  return fields.every((f) => !isBlank(record[f]));
}

function dirToBound(d: LrtDirection): Bound {
  return d === "1" ? Bound.Outbound : Bound.Inbound;
}

type Group = {
  routeId: string;
  bound: Bound;
  rows: LrtRouteStop[];
};

function groupRows(rows: LrtRouteStop[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!hasAllFields(r, REQUIRED_FIELDS)) continue;
    const bound = dirToBound(r.DIRECTION);
    const routeId = r.LINE_CODE;
    const key = compositeId(Company.LRT, routeId, bound, SERVICE_TYPE);
    let g = groups.get(key);
    if (!g) {
      g = { routeId, bound, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => Number(a.SEQUENCE) - Number(b.SEQUENCE));
  }
  return groups;
}

export function transformRoutes(rows: LrtRouteStop[]): RouteOutput[] {
  const groups = groupRows(rows);
  const out: RouteOutput[] = [];
  for (const [id, g] of groups) {
    if (g.rows.length === 0) continue;
    const first = g.rows[0]!;
    const last = g.rows[g.rows.length - 1]!;
    const origin: Localized = {
      en: first.STOP_NAME_ENG,
      tc: first.STOP_NAME_CHI,
      sc: first.STOP_NAME_CHI,
    };
    const destination: Localized = {
      en: last.STOP_NAME_ENG,
      tc: last.STOP_NAME_CHI,
      sc: last.STOP_NAME_CHI,
    };
    out.push({
      record_id: id,
      company: Company.LRT,
      route_id: g.routeId,
      route: g.routeId,
      bound: g.bound,
      serviceType: SERVICE_TYPE,
      origin,
      destination,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function transformRouteStops(rows: LrtRouteStop[]): RouteStopsOutput[] {
  const groups = groupRows(rows);
  const out: RouteStopsOutput[] = [];
  for (const [id, g] of groups) {
    const stops: StopOutput[] = g.rows.map((r) => {
      const { lat, long } = stopCoords(r.STOP_CODE);
      return {
        seq: Number(r.SEQUENCE),
        stopId: r.STOP_CODE,
        name: {
          en: r.STOP_NAME_ENG,
          tc: r.STOP_NAME_CHI,
          sc: r.STOP_NAME_CHI,
        },
        lat,
        long,
      };
    });
    out.push({
      record_id: id,
      company: Company.LRT,
      route_id: g.routeId,
      route: g.routeId,
      bound: g.bound,
      serviceType: SERVICE_TYPE,
      stops,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
