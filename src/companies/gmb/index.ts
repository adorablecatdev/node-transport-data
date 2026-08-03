import { removeDirIfExists, writeJson } from "../../lib/io.js";
import {
  fetchAllRouteInfos,
  fetchAllRouteStops,
  fetchRegionRouteCodes,
  fetchStopsById,
  type GmbRegion,
} from "./api.js";
import {
  buildRouteStopTasks,
  collectStopIds,
  indexVariants,
  transformRouteStops,
  transformRoutes,
  type GmbRouteOutput,
  type GmbRouteStopsOutput,
} from "./transform.js";

function keyByRecordId<T extends { record_id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.record_id] = item;
  return out;
}

function outDirFor(region: GmbRegion): string {
  return `out/gmb${region.toLowerCase()}`;
}

const TEST_ROUTE_LIMIT = 2;

export async function runRegion(
  region: GmbRegion,
  options: { fresh?: boolean; test?: boolean } = {},
): Promise<void> {
  const { fresh = false, test = false } = options;
  const tag = `gmb-${region.toLowerCase()}`;
  const baseDir = outDirFor(region);
  const outDir = test ? `${baseDir}/test` : baseDir;
  const cacheDir = `${outDir}/.cache`;
  const routeInfosCache = `${cacheDir}/route-infos.json`;
  const routeStopsCache = `${cacheDir}/route-stops.json`;
  const stopsCache = `${cacheDir}/stops.json`;

  if (fresh) {
    console.log(`[${tag}] fresh flag set — wiping cache before fetch`);
    await removeDirIfExists(cacheDir);
  }
  if (test)
    console.log(
      `[${tag}] test flag set — limiting to first ${TEST_ROUTE_LIMIT} routes, writing to ${outDir}/`,
    );

  console.log(`[${tag}] fetching route codes for region ${region}`);
  const allRouteCodes = await fetchRegionRouteCodes(region);
  const routeCodes = test ? allRouteCodes.slice(0, TEST_ROUTE_LIMIT) : allRouteCodes;

  console.log(`[${tag}] fetching route infos for ${routeCodes.length} routes`);
  const routeInfos = await fetchAllRouteInfos(region, routeCodes, { cachePath: routeInfosCache });

  const variants = indexVariants(routeInfos);
  const tasks = buildRouteStopTasks(variants);
  console.log(`[${tag}] fetching route-stops for ${tasks.length} (route_id, route_seq) pairs`);
  const routeStopGroups = await fetchAllRouteStops(tasks, region, { cachePath: routeStopsCache });

  const stopIds = collectStopIds(routeStopGroups);
  console.log(`[${tag}] fetching ${stopIds.length} unique stops`);
  const stopsById = await fetchStopsById(stopIds, region, { cachePath: stopsCache });

  const routesOut: Record<string, GmbRouteOutput> = keyByRecordId(
    transformRoutes(region, variants, routeStopGroups),
  );
  const routeStopsOut: Record<string, GmbRouteStopsOutput> = keyByRecordId(
    transformRouteStops(region, routeStopGroups, stopsById),
  );

  await writeJson(`${outDir}/routes.json`, routesOut);
  await writeJson(`${outDir}/route-stops.json`, routeStopsOut);

  console.log(
    `[${tag}] wrote ${Object.keys(routesOut).length} routes and ${Object.keys(routeStopsOut).length} route-stop groups to ${outDir}/`,
  );
}

type RegionRunOptions = { fresh?: boolean; test?: boolean };
export const runHKI = (options?: RegionRunOptions): Promise<void> =>
  runRegion("HKI", options ?? {});
export const runKLN = (options?: RegionRunOptions): Promise<void> =>
  runRegion("KLN", options ?? {});
export const runNT = (options?: RegionRunOptions): Promise<void> =>
  runRegion("NT", options ?? {});
