import { delay, fetchJson } from "../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../lib/io.js";

const BASE = "https://rt.data.gov.hk/v2/transport/nlb";
const THROTTLE_MS = 120;
const SAVE_EVERY = 25;

export type NlbRoute = {
  routeId: string;
  routeNo: string;
  routeName_c: string;
  routeName_s: string;
  routeName_e: string;
  overnightRoute: number;
  specialRoute: number;
};

export type NlbStop = {
  stopId: string;
  stopName_c: string;
  stopName_s: string;
  stopName_e: string;
  stopLocation_c: string;
  stopLocation_s: string;
  stopLocation_e: string;
  latitude: string;
  longitude: string;
  fare: string;
  fareHoliday: string;
  someDepartureObserveOnly: number;
};

export type RouteStopGroup = { routeId: string; stops: NlbStop[] };

export async function fetchRoutes(): Promise<NlbRoute[]> {
  const r = await fetchJson<{ routes: NlbRoute[] }>(`${BASE}/route.php?action=list`);
  const routes = r.routes ?? [];
  console.log(`[nlb] fetched ${routes.length} routes`);
  return routes;
}

async function fetchStopsForRoute(routeId: string): Promise<NlbStop[]> {
  const r = await fetchJson<{ stops: NlbStop[] }>(
    `${BASE}/stop.php?action=list&routeId=${encodeURIComponent(routeId)}`,
  );
  return r.stops ?? [];
}

type RouteStopsCache = { groups: RouteStopGroup[] };

export async function fetchAllRouteStops(
  routes: NlbRoute[],
  options: { cachePath?: string; resume?: boolean } = {},
): Promise<RouteStopGroup[]> {
  const { cachePath, resume } = options;
  const cached: RouteStopGroup[] =
    resume && cachePath
      ? ((await readJsonIfExists<RouteStopsCache>(cachePath))?.groups ?? [])
      : [];
  const doneKeys = new Set(cached.map((g) => g.routeId));
  const out: RouteStopGroup[] = [...cached];

  const total = routes.length;
  let done = doneKeys.size;
  let sinceSave = 0;

  if (cached.length > 0) {
    console.log(`[nlb] resuming route-stops from cache (${cached.length}/${total} done)`);
  }

  for (const route of routes) {
    if (doneKeys.has(route.routeId)) continue;
    const stops = await fetchStopsForRoute(route.routeId);
    out.push({ routeId: route.routeId, stops });
    done++;
    sinceSave++;
    process.stdout.write(`\r[nlb] route-stop progress ${done}/${total}`);
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
