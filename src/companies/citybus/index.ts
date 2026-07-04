import { removeIfExists, writeJson } from "../../lib/io.js";
import { fetchAllRouteStops, fetchRoutes, fetchStopsById } from "./api.js";
import {
  collectStopIds,
  transformRouteStops,
  transformRoutes,
  type RouteOutput,
  type RouteStopsOutput,
} from "./transform.js";

const OUT_DIR = "out/citybus";
const CACHE_DIR = `${OUT_DIR}/.cache`;
const ROUTE_STOPS_CACHE = `${CACHE_DIR}/route-stops.json`;
const STOPS_CACHE = `${CACHE_DIR}/stops.json`;

function keyByRecordId<T extends { record_id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.record_id] = item;
  return out;
}

export async function run(options: { resume?: boolean } = {}): Promise<void> {
  const { resume = false } = options;
  if (resume) console.log("[ctb] resume flag set — will reuse cached partial fetches");

  console.log("[ctb] fetching routes");
  const routes = await fetchRoutes();

  console.log(`[ctb] fetching route-stops for ${routes.length} routes x 2 directions`);
  const routeStopGroups = await fetchAllRouteStops(routes, {
    cachePath: ROUTE_STOPS_CACHE,
    resume,
  });

  const stopIds = collectStopIds(routeStopGroups);
  console.log(`[ctb] fetching ${stopIds.length} unique stops`);
  const stopsById = await fetchStopsById(stopIds, { cachePath: STOPS_CACHE, resume });

  const routesOut: Record<string, RouteOutput> = keyByRecordId(
    transformRoutes(routes, routeStopGroups),
  );
  const routeStopsOut: Record<string, RouteStopsOutput> = keyByRecordId(
    transformRouteStops(routeStopGroups, stopsById),
  );

  await writeJson(`${OUT_DIR}/routes.json`, routesOut);
  await writeJson(`${OUT_DIR}/route-stops.json`, routeStopsOut);

  await removeIfExists(ROUTE_STOPS_CACHE);
  await removeIfExists(STOPS_CACHE);

  console.log(
    `[ctb] wrote ${Object.keys(routesOut).length} routes and ${Object.keys(routeStopsOut).length} route-stop groups to ${OUT_DIR}/`,
  );
}
