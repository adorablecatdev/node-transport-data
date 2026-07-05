import { delay, fetchJson } from "../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../lib/io.js";

const BASE = "https://data.etagmb.gov.hk";
const THROTTLE_MS = 120;
const SAVE_EVERY = 25;

export type GmbRegion = "HKI" | "KLN" | "NT";
export const REGIONS: readonly GmbRegion[] = ["HKI", "KLN", "NT"] as const;

type Envelope<T> = {
  type: string;
  version: string;
  generated_timestamp: string;
  data: T;
};

export type GmbDirection = {
  route_seq: number;
  orig_en: string;
  orig_tc: string;
  orig_sc: string;
  dest_en: string;
  dest_tc: string;
  dest_sc: string;
  remarks_en: string | null;
  remarks_tc: string | null;
  remarks_sc: string | null;
};

export type GmbRouteInfo = {
  route_id: number;
  region: string;
  route_code: string;
  description_en: string;
  description_tc: string;
  description_sc: string;
  directions: GmbDirection[];
};

export type GmbRouteStop = {
  stop_seq: number;
  stop_id: number;
  name_en: string;
  name_tc: string;
  name_sc: string;
};

export type GmbStop = {
  coordinates: {
    wgs84: { latitude: number; longitude: number };
    hk80?: { latitude: number; longitude: number };
  };
  enabled: boolean;
};

export async function fetchRegionRouteCodes(region: GmbRegion): Promise<string[]> {
  const r = await fetchJson<Envelope<{ routes: string[] }>>(`${BASE}/route/${region}`);
  const codes = r.data?.routes ?? [];
  console.log(`[gmb-${region.toLowerCase()}] fetched ${codes.length} route codes`);
  return codes;
}

async function fetchRouteInfosForCode(
  region: GmbRegion,
  routeCode: string,
): Promise<GmbRouteInfo[]> {
  const r = await fetchJson<Envelope<GmbRouteInfo[]>>(
    `${BASE}/route/${region}/${encodeURIComponent(routeCode)}`,
  );
  return r.data ?? [];
}

export type RouteInfosCache = { byRouteCode: Record<string, GmbRouteInfo[]> };

export async function fetchAllRouteInfos(
  region: GmbRegion,
  routeCodes: string[],
  options: { cachePath?: string; resume?: boolean } = {},
): Promise<Map<string, GmbRouteInfo[]>> {
  const { cachePath, resume } = options;
  const cached: RouteInfosCache =
    resume && cachePath
      ? ((await readJsonIfExists<RouteInfosCache>(cachePath)) ?? { byRouteCode: {} })
      : { byRouteCode: {} };

  const out = new Map<string, GmbRouteInfo[]>(Object.entries(cached.byRouteCode));
  const total = routeCodes.length;
  let done = out.size;
  let sinceSave = 0;

  const persist = async (): Promise<void> => {
    if (!cachePath) return;
    const byRouteCode: Record<string, GmbRouteInfo[]> = {};
    for (const [k, v] of out) byRouteCode[k] = v;
    await writeJson(cachePath, { byRouteCode } satisfies RouteInfosCache);
  };

  const tag = `gmb-${region.toLowerCase()}`;
  if (done > 0) console.log(`[${tag}] resuming route-infos from cache (${done}/${total} done)`);

  for (const code of routeCodes) {
    if (out.has(code)) continue;
    const infos = await fetchRouteInfosForCode(region, code);
    out.set(code, infos);
    done++;
    sinceSave++;
    process.stdout.write(`\r[${tag}] route-info progress ${done}/${total}`);
    if (cachePath && sinceSave >= SAVE_EVERY) {
      await persist();
      sinceSave = 0;
    }
    await delay(THROTTLE_MS);
  }
  if (cachePath && sinceSave > 0) await persist();
  if (total > 0) process.stdout.write("\n");
  return out;
}

async function fetchRouteStopList(routeId: number, routeSeq: number): Promise<GmbRouteStop[]> {
  const r = await fetchJson<Envelope<{ route_stops: GmbRouteStop[] }>>(
    `${BASE}/route-stop/${routeId}/${routeSeq}`,
  );
  return r.data?.route_stops ?? [];
}

export type RouteStopGroup = {
  route_code: string;
  variant_index: number;
  route_id: number;
  route_seq: number;
  stops: GmbRouteStop[];
};

export type RouteStopsCache = { groups: RouteStopGroup[] };

function routeStopKey(routeId: number, routeSeq: number): string {
  return `${routeId}:${routeSeq}`;
}

export type RouteStopTask = {
  route_code: string;
  variant_index: number;
  route_id: number;
  route_seq: number;
};

export async function fetchAllRouteStops(
  tasks: RouteStopTask[],
  region: GmbRegion,
  options: { cachePath?: string; resume?: boolean } = {},
): Promise<RouteStopGroup[]> {
  const { cachePath, resume } = options;
  const cached: RouteStopGroup[] =
    resume && cachePath
      ? ((await readJsonIfExists<RouteStopsCache>(cachePath))?.groups ?? [])
      : [];
  const doneKeys = new Set(cached.map((g) => routeStopKey(g.route_id, g.route_seq)));
  const out: RouteStopGroup[] = [...cached];

  const total = tasks.length;
  let done = doneKeys.size;
  let sinceSave = 0;

  const tag = `gmb-${region.toLowerCase()}`;
  if (cached.length > 0) {
    console.log(`[${tag}] resuming route-stops from cache (${cached.length}/${total} done)`);
  }

  for (const t of tasks) {
    if (doneKeys.has(routeStopKey(t.route_id, t.route_seq))) continue;
    const stops = await fetchRouteStopList(t.route_id, t.route_seq);
    out.push({
      route_code: t.route_code,
      variant_index: t.variant_index,
      route_id: t.route_id,
      route_seq: t.route_seq,
      stops,
    });
    done++;
    sinceSave++;
    process.stdout.write(`\r[${tag}] route-stop progress ${done}/${total}`);
    if (cachePath && sinceSave >= SAVE_EVERY) {
      await writeJson(cachePath, { groups: out } satisfies RouteStopsCache);
      sinceSave = 0;
    }
    await delay(THROTTLE_MS);
  }
  if (cachePath && sinceSave > 0)
    await writeJson(cachePath, { groups: out } satisfies RouteStopsCache);
  if (total > 0) process.stdout.write("\n");
  return out;
}

async function fetchStop(stopId: number): Promise<GmbStop | null> {
  try {
    const r = await fetchJson<Envelope<GmbStop>>(`${BASE}/stop/${stopId}`);
    return r.data ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("HTTP 404")) return null;
    throw err;
  }
}

type StopsCache = { stops: Record<string, GmbStop>; missing: string[] };

export async function fetchStopsById(
  stopIds: number[],
  region: GmbRegion,
  options: { cachePath?: string; resume?: boolean } = {},
): Promise<Map<number, GmbStop>> {
  const { cachePath, resume } = options;
  const cached: StopsCache =
    resume && cachePath
      ? ((await readJsonIfExists<StopsCache>(cachePath)) ?? { stops: {}, missing: [] })
      : { stops: {}, missing: [] };

  const out = new Map<number, GmbStop>();
  for (const [k, v] of Object.entries(cached.stops)) out.set(Number(k), v);
  const missingSet = new Set(cached.missing);
  const doneIds = new Set<string>([
    ...[...out.keys()].map(String),
    ...missingSet,
  ]);

  const total = stopIds.length;
  let done = doneIds.size;
  let missing = missingSet.size;
  let sinceSave = 0;

  const tag = `gmb-${region.toLowerCase()}`;

  const persist = async (): Promise<void> => {
    if (!cachePath) return;
    const stopsObj: Record<string, GmbStop> = {};
    for (const [k, v] of out) stopsObj[String(k)] = v;
    await writeJson(cachePath, { stops: stopsObj, missing: [...missingSet] } satisfies StopsCache);
  };

  if (doneIds.size > 0) {
    console.log(`[${tag}] resuming stops from cache (${doneIds.size}/${total} done)`);
  }

  for (const id of stopIds) {
    if (doneIds.has(String(id))) continue;
    const stop = await fetchStop(id);
    if (stop) out.set(id, stop);
    else {
      missingSet.add(String(id));
      missing++;
    }
    done++;
    sinceSave++;
    process.stdout.write(`\r[${tag}] stop progress ${done}/${total} (missing ${missing})`);
    if (cachePath && sinceSave >= SAVE_EVERY) {
      await persist();
      sinceSave = 0;
    }
    await delay(THROTTLE_MS);
  }
  if (cachePath && sinceSave > 0) await persist();
  if (total > 0) process.stdout.write("\n");
  return out;
}
