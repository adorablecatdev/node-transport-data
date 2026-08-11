import { Company, type Localized, type StopOutput } from "../../types.js";
import type { MtrDirection, MtrLineStation } from "./api.js";
import { ROUTE_NAME_EN, ROUTE_NAME_TC, STATION_LOCATION } from "./static.js";

export type MtrRouteOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: Localized;
  bound: MtrDirection;
  origin: Localized;
  destination: Localized;
};

export type MtrRouteStopsOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: Localized;
  bound: MtrDirection;
  stops: StopOutput[];
};

function routeName(lineCode: string, direction: MtrDirection): Localized {
  const en = ROUTE_NAME_EN[direction] ?? ROUTE_NAME_EN[lineCode] ?? lineCode;
  const tc = ROUTE_NAME_TC[direction] ?? ROUTE_NAME_TC[lineCode] ?? lineCode;
  return { en, tc, sc: tc };
}

function stationCoords(stationCode: string): { lat: number; long: number } {
  const loc = STATION_LOCATION[stationCode];
  if (!loc) return { lat: NaN, long: NaN };
  return { lat: Number(loc.lat), long: Number(loc.long) };
}

function mtrCompositeId(lineCode: string, bound: MtrDirection): string {
  return `${Company.MTR}-${lineCode}-${bound}`;
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

type Group = {
  lineCode: string;
  bound: MtrDirection;
  rows: MtrLineStation[];
};

function groupRows(rows: MtrLineStation[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!hasAllFields(r, REQUIRED_FIELDS)) continue;
    const key = mtrCompositeId(r.LINE_CODE, r.DIRECTION);
    let g = groups.get(key);
    if (!g) {
      g = { lineCode: r.LINE_CODE, bound: r.DIRECTION, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => Number(a.SEQUENCE) - Number(b.SEQUENCE));
  }
  return groups;
}

export function transformRoutes(rows: MtrLineStation[]): MtrRouteOutput[] {
  const groups = groupRows(rows);
  const out: MtrRouteOutput[] = [];
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
      route_id: g.lineCode,
      route: routeName(g.lineCode, g.bound),
      bound: g.bound,
      origin,
      destination,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function transformRouteStops(rows: MtrLineStation[]): MtrRouteStopsOutput[] {
  const groups = groupRows(rows);
  const out: MtrRouteStopsOutput[] = [];
  for (const [id, g] of groups) {
    const stops: StopOutput[] = g.rows.map((r) => {
      const { lat, long } = stationCoords(r.STATION_CODE);
      return {
        seq: Number(r.SEQUENCE),
        stop_id: r.STATION_CODE,
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
      route_id: g.lineCode,
      route: routeName(g.lineCode, g.bound),
      bound: g.bound,
      stops,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
