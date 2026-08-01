import { removeDirIfExists, writeJson } from "../../lib/io.js";
import { fetchAllRouteStops, fetchRoutes, fetchStopsById } from "./api.js";
import {
  collectStopIds,
  transformRouteStops,
  transformRoutes,
  type CtbRouteOutput,
  type CtbRouteStopsOutput,
} from "./transform.js";

const BASE_OUT_DIR = "out/ctb";
const TEST_ROUTE_LIMIT = 2;

function keyByRecordId<T extends { record_id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.record_id] = item;
  return out;
}

export async function run(
  options: { fresh?: boolean; test?: boolean } = {},
): Promise<void> {
  const { fresh = false, test = false } = options;
  const outDir = test ? `${BASE_OUT_DIR}/test` : BASE_OUT_DIR;
  const cacheDir = `${outDir}/.cache`;
  const routeStopsCache = `${cacheDir}/route-stops.json`;
  const stopsCache = `${cacheDir}/stops.json`;

  if (fresh) {
    console.log("[ctb] fresh flag set — wiping cache before fetch");
    await removeDirIfExists(cacheDir);
  }
  if (test)
    console.log(
      `[ctb] test flag set — limiting to first ${TEST_ROUTE_LIMIT} routes, writing to ${outDir}/`,
    );

  console.log("[ctb] fetching routes");
  const allRoutes = await fetchRoutes();
  const routes = test ? allRoutes.slice(0, TEST_ROUTE_LIMIT) : allRoutes;

  console.log(`[ctb] fetching route-stops for ${routes.length} routes x 2 directions`);
  const routeStopGroups = await fetchAllRouteStops(routes, { cachePath: routeStopsCache });

  const stopIds = collectStopIds(routeStopGroups);
  console.log(`[ctb] fetching ${stopIds.length} unique stops`);
  const stopsById = await fetchStopsById(stopIds, { cachePath: stopsCache });

  const routesOut: Record<string, CtbRouteOutput> = keyByRecordId(
    transformRoutes(routes, routeStopGroups),
  );
  const routeStopsOut: Record<string, CtbRouteStopsOutput> = keyByRecordId(
    transformRouteStops(routeStopGroups, stopsById),
  );

  await writeJson(`${outDir}/routes.json`, routesOut);
  await writeJson(`${outDir}/route-stops.json`, routeStopsOut);

  console.log(
    `[ctb] wrote ${Object.keys(routesOut).length} routes and ${Object.keys(routeStopsOut).length} route-stop groups to ${outDir}/`,
  );
}
