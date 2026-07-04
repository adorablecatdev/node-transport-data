import { Bound, Company, type Localized } from "../../types.js";
import type { MtrDirection, MtrLineStation } from "./api.js";
import { ROUTE_NAME_EN, ROUTE_NAME_TC, STATION_LOCATION } from "./static.js";

export type RouteOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: Localized;
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
  route: Localized;
  bound: Bound;
  serviceType: string;
  stops: StopOutput[];
};

function routeName(routeId: string): Localized {
  const en = ROUTE_NAME_EN[routeId] ?? routeId;
  const tc = ROUTE_NAME_TC[routeId] ?? routeId;
  return { en, tc, sc: tc };
}

function stationCoords(stationCode: string): { lat: number; long: number } {
  const loc = STATION_LOCATION[stationCode];
  if (!loc) return { lat: NaN, long: NaN };
  return { lat: Number(loc.lat), long: Number(loc.long) };
}

const SERVICE_TYPE = "1";

function compositeId(company: Company, routeId: string, bound: Bound, serviceType: string): string {
  return `${company}-${routeId}-${bound}-${serviceType}`;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

const REQUIRED_FIELDS = [
  "LINE_CODE",
  "DIRECTION",
  "STATION_CODE",
  "STATION_ID",
  "STATION_NAME_CHI",
  "STATION_NAME_ENG",
  "SEQUENCE",
] as const;

function hasAllFields(obj: object, fields: readonly string[]): boolean {
  const record = obj as Record<string, unknown>;
  return fields.every((f) => !isBlank(record[f]));
}

function parseDirection(dir: MtrDirection): { branch: string | null; bound: Bound } {
  const isDown = dir.endsWith("DT");
  const bound = isDown ? Bound.Outbound : Bound.Inbound;
  const idx = dir.indexOf("-");
  const branch = idx > 0 ? dir.slice(0, idx) : null;
  return { branch, bound };
}

function routeIdFor(lineCode: string, branch: string | null): string {
  return branch ? `${lineCode}-${branch}` : lineCode;
}

type Group = {
  routeId: string;
  bound: Bound;
  rows: MtrLineStation[];
};

function groupRows(rows: MtrLineStation[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!hasAllFields(r, REQUIRED_FIELDS)) continue;
    const { branch, bound } = parseDirection(r.DIRECTION);
    const routeId = routeIdFor(r.LINE_CODE, branch);
    const key = compositeId(Company.MTR, routeId, bound, SERVICE_TYPE);
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

export function transformRoutes(rows: MtrLineStation[]): RouteOutput[] {
  const groups = groupRows(rows);
  const out: RouteOutput[] = [];
  for (const [id, g] of groups) {
    if (g.rows.length === 0) continue;
    const first = g.rows[0]!;
    const last = g.rows[g.rows.length - 1]!;
    const origin: Localized = {
      en: first.STATION_NAME_ENG,
      tc: first.STATION_NAME_CHI,
      sc: first.STATION_NAME_CHI,
    };
    const destination: Localized = {
      en: last.STATION_NAME_ENG,
      tc: last.STATION_NAME_CHI,
      sc: last.STATION_NAME_CHI,
    };
    out.push({
      record_id: id,
      company: Company.MTR,
      route_id: g.routeId,
      route: routeName(g.routeId),
      bound: g.bound,
      serviceType: SERVICE_TYPE,
      origin,
      destination,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function transformRouteStops(rows: MtrLineStation[]): RouteStopsOutput[] {
  const groups = groupRows(rows);
  const out: RouteStopsOutput[] = [];
  for (const [id, g] of groups) {
    const stops: StopOutput[] = g.rows.map((r) => {
      const { lat, long } = stationCoords(r.STATION_CODE);
      return {
        seq: Number(r.SEQUENCE),
        stopId: r.STATION_CODE,
        name: {
          en: r.STATION_NAME_ENG,
          tc: r.STATION_NAME_CHI,
          sc: r.STATION_NAME_CHI,
        },
        lat,
        long,
      };
    });
    out.push({
      record_id: id,
      company: Company.MTR,
      route_id: g.routeId,
      route: routeName(g.routeId),
      bound: g.bound,
      serviceType: SERVICE_TYPE,
      stops,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
