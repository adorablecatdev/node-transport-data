import { writeJson } from "../../lib/io.js";
import { fetchRoutes, fetchRouteStops, fetchStops } from "./api.js";
import { transformRouteStops, transformRoutes } from "./transform.js";

const OUT_DIR = "out/kmb";

function keyByRecordId<T extends { record_id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.record_id] = item;
  return out;
}

export async function run(): Promise<void> {
  console.log("[kmb] fetching routes");
  const routes = await fetchRoutes();
  console.log("[kmb] fetching stops");
  const stops = await fetchStops();
  console.log("[kmb] fetching route-stops");
  const routeStops = await fetchRouteStops();
  console.log(
    `[kmb] received ${routes.length} routes, ${stops.length} stops, ${routeStops.length} route-stops`,
  );

  const routesOut = keyByRecordId(transformRoutes(routes));
  const routeStopsOut = keyByRecordId(transformRouteStops(routeStops, stops));

  await writeJson(`${OUT_DIR}/routes.json`, routesOut);
  await writeJson(`${OUT_DIR}/route-stops.json`, routeStopsOut);

  console.log(
    `[kmb] wrote ${Object.keys(routesOut).length} routes and ${Object.keys(routeStopsOut).length} route-stop groups to ${OUT_DIR}/`,
  );
}
