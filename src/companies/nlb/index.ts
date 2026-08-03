import { removeDirIfExists, writeJson } from "../../lib/io.js";
import { fetchAllRouteStops, fetchRoutes } from "./api.js";
import {
  transformRouteStops,
  transformRoutes,
  type NlbRouteOutput,
  type NlbRouteStopsOutput,
} from "./transform.js";

const BASE_OUT_DIR = "out/nlb";
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

  if (fresh) {
    console.log("[nlb] fresh flag set — wiping cache before fetch");
    await removeDirIfExists(cacheDir);
  }
  if (test)
    console.log(
      `[nlb] test flag set — limiting to first ${TEST_ROUTE_LIMIT} routes, writing to ${outDir}/`,
    );

  console.log("[nlb] fetching routes");
  const allRoutes = await fetchRoutes();
  const routes = test ? allRoutes.slice(0, TEST_ROUTE_LIMIT) : allRoutes;

  console.log(`[nlb] fetching route-stops for ${routes.length} routes`);
  const routeStopGroups = await fetchAllRouteStops(routes, { cachePath: routeStopsCache });

  const routesOut: Record<string, NlbRouteOutput> = keyByRecordId(
    transformRoutes(routes, routeStopGroups),
  );
  const routeStopsOut: Record<string, NlbRouteStopsOutput> = keyByRecordId(
    transformRouteStops(routes, routeStopGroups),
  );

  await writeJson(`${outDir}/routes.json`, routesOut);
  await writeJson(`${outDir}/route-stops.json`, routeStopsOut);

  console.log(
    `[nlb] wrote ${Object.keys(routesOut).length} routes and ${Object.keys(routeStopsOut).length} route-stop groups to ${outDir}/`,
  );
}
