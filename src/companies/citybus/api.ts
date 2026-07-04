import { delay, fetchJson } from "../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../lib/io.js";

const BASE = "https://rt.data.gov.hk/v1/transport/citybus-nwfb";

const THROTTLE_MS = 120;

export type CtbDir = "I" | "O";
export type CtbDirection = "inbound" | "outbound";

export const DIRECTIONS: readonly CtbDirection[] = ["inbound", "outbound"] as const;

export type CtbRoute = {
  co: string;
  route: string;
  orig_en: string;
  orig_tc: string;
  orig_sc: string;
  dest_en: string;
  dest_tc: string;
  dest_sc: string;
  data_timestamp?: string;
};

export type CtbStop = {
  stop: string;
  name_en: string;
  name_tc: string;
  name_sc: string;
  lat: string;
  long: string;
  data_timestamp?: string;
};

export type CtbRouteStop = {
  co: string;
  route: string;
  dir: CtbDir;
  seq: string | number;
  stop: string;
  data_timestamp?: string;
};

type Envelope<T> = {
  type: string;
  version: string;
  generated_timestamp: string;
  data: T;
};

export async function fetchRoutes(): Promise<CtbRoute[]> {
  const r = await fetchJson<Envelope<CtbRoute[]>>(`${BASE}/route/ctb`);
  console.log(`[ctb] fetched ${r?.data?.length ?? 0} routes`);
  return r.data ?? [];
}

export async function fetchRouteStops(
  route: string,
  direction: CtbDirection,
): Promise<CtbRouteStop[]> {
  const r = await fetchJson<Envelope<CtbRouteStop[]>>(
    `${BASE}/route-stop/ctb/${encodeURIComponent(route)}/${direction}`,
  );
  return r.data ?? [];
}

export async function fetchStop(stopId: string): Promise<CtbStop | null> {
  const r = await fetchJson<Envelope<CtbStop | Record<string, never>>>(
    `${BASE}/stop/${encodeURIComponent(stopId)}`,
  );
  const data = r.data as CtbStop | undefined;
  if (!data || !data.stop) return null;
  return data;
}

export type RouteStopGroup = { route: string; direction: CtbDirection; stops: CtbRouteStop[] };

const SAVE_EVERY = 25;

function routeStopKey(route: string, direction: CtbDirection): string {
  return `${route}:${direction}`;
}

export async function fetchAllRouteStops(
  routes: CtbRoute[],
  options: { cachePath?: string; resume?: boolean } = {},
): Promise<RouteStopGroup[]> {
  const { cachePath, resume } = options;
  const cached: RouteStopGroup[] =
    resume && cachePath ? ((await readJsonIfExists<RouteStopGroup[]>(cachePath)) ?? []) : [];
  const doneKeys = new Set(cached.map((g) => routeStopKey(g.route, g.direction)));
  const out: RouteStopGroup[] = [...cached];

  const totalCalls = routes.length * DIRECTIONS.length;
  let done = doneKeys.size;
  let sinceSave = 0;

  if (cached.length > 0) {
    console.log(`[ctb] resuming route-stops from cache (${cached.length}/${totalCalls} done)`);
  }

  for (const route of routes) {
    for (const direction of DIRECTIONS) {
      if (doneKeys.has(routeStopKey(route.route, direction))) continue;
      const stops = await fetchRouteStops(route.route, direction);
      out.push({ route: route.route, direction, stops });
      done++;
      sinceSave++;
      process.stdout.write(`\r[ctb] route-stop progress ${done}/${totalCalls}`);
      if (cachePath && sinceSave >= SAVE_EVERY) {
        await writeJson(cachePath, out);
        sinceSave = 0;
      }
      await delay(THROTTLE_MS);
    }
  }
  if (cachePath && sinceSave > 0) await writeJson(cachePath, out);
  process.stdout.write("\n");
  return out;
}

type StopsCache = { stops: Record<string, CtbStop>; missing: string[] };

export async function fetchStopsById(
  stopIds: string[],
  options: { cachePath?: string; resume?: boolean } = {},
): Promise<Map<string, CtbStop>> {
  const { cachePath, resume } = options;
  const cached: StopsCache =
    resume && cachePath
      ? ((await readJsonIfExists<StopsCache>(cachePath)) ?? { stops: {}, missing: [] })
      : { stops: {}, missing: [] };

  const out = new Map<string, CtbStop>(Object.entries(cached.stops));
  const missingSet = new Set(cached.missing);
  const doneIds = new Set<string>([...out.keys(), ...missingSet]);

  const total = stopIds.length;
  let done = doneIds.size;
  let missing = missingSet.size;
  let sinceSave = 0;

  const persist = async (): Promise<void> => {
    if (!cachePath) return;
    const stopsObj: Record<string, CtbStop> = {};
    for (const [k, v] of out) stopsObj[k] = v;
    await writeJson(cachePath, { stops: stopsObj, missing: [...missingSet] } satisfies StopsCache);
  };

  if (doneIds.size > 0) {
    console.log(`[ctb] resuming stops from cache (${doneIds.size}/${total} done)`);
  }

  for (const id of stopIds) {
    if (doneIds.has(id)) continue;
    const stop = await fetchStop(id);
    if (stop) out.set(id, stop);
    else {
      missingSet.add(id);
      missing++;
    }
    done++;
    sinceSave++;
    process.stdout.write(`\r[ctb] stop progress ${done}/${total} (missing ${missing})`);
    if (cachePath && sinceSave >= SAVE_EVERY) {
      await persist();
      sinceSave = 0;
    }
    await delay(THROTTLE_MS);
  }
  if (cachePath && sinceSave > 0) await persist();
  process.stdout.write("\n");
  return out;
}
