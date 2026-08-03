import { Company, type Localized, type StopOutput } from "../../types.js";
import type { LrtRouteStop } from "./api.js";
import { STOP_LOCATION } from "./static.js";

export type LrtRouteOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: string;
  origin: Localized;
  destination: Localized;
};

export type LrtRouteStopsOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: string;
  stops: StopOutput[];
};

function stopCoords(stopId: string): { lat: number; long: number } {
  const loc = STOP_LOCATION[stopId];
  if (!loc) return { lat: NaN, long: NaN };
  return { lat: Number(loc.lat), long: Number(loc.long) };
}

function toSnakeCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function lrtCompositeId(route: string, bound: string): string {
  return `${Company.LRT}-${route}-${bound}`;
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

type Group = {
  route: string;
  rows: LrtRouteStop[];
};

// Group by (LINE_CODE, DIRECTION). The bound (snake_case destination) is derived
// once each group's rows are sorted, since it comes from the terminating stop.
function groupRows(rows: LrtRouteStop[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!hasAllFields(r, REQUIRED_FIELDS)) continue;
    const key = `${r.LINE_CODE}|${r.DIRECTION}`;
    let g = groups.get(key);
    if (!g) {
      g = { route: r.LINE_CODE, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => Number(a.SEQUENCE) - Number(b.SEQUENCE));
  }
  return groups;
}

export function transformRoutes(rows: LrtRouteStop[]): LrtRouteOutput[] {
  const groups = groupRows(rows);
  const out: LrtRouteOutput[] = [];
  for (const g of groups.values()) {
    if (g.rows.length === 0) continue;
    const first = g.rows[0]!;
    const last = g.rows[g.rows.length - 1]!;
    const bound = toSnakeCase(last.STOP_NAME_ENG);
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
      record_id: lrtCompositeId(g.route, bound),
      company: Company.LRT,
      route: g.route,
      bound,
      origin,
      destination,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function transformRouteStops(rows: LrtRouteStop[]): LrtRouteStopsOutput[] {
  const groups = groupRows(rows);
  const out: LrtRouteStopsOutput[] = [];
  for (const g of groups.values()) {
    if (g.rows.length === 0) continue;
    const last = g.rows[g.rows.length - 1]!;
    const bound = toSnakeCase(last.STOP_NAME_ENG);
    const stops: StopOutput[] = g.rows.map((r) => {
      const { lat, long } = stopCoords(r.STOP_ID);
      return {
        seq: Number(r.SEQUENCE),
        stop_id: r.STOP_ID,
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
      record_id: lrtCompositeId(g.route, bound),
      company: Company.LRT,
      route: g.route,
      bound,
      stops,
    });
  }
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}
