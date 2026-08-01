import { writeJson } from "../../lib/io.js";
import { fetchRouteStops } from "./api.js";
import { transformRouteStops, transformRoutes } from "./transform.js";

const OUT_DIR = "out/lrt";

function keyByRecordId<T extends { record_id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.record_id] = item;
  return out;
}

export async function run(): Promise<void> {
  console.log("[lrt] fetching routes and stops");
  const rows = await fetchRouteStops();

  const routesOut = keyByRecordId(transformRoutes(rows));
  const routeStopsOut = keyByRecordId(transformRouteStops(rows));

  await writeJson(`${OUT_DIR}/routes.json`, routesOut);
  await writeJson(`${OUT_DIR}/route-stops.json`, routeStopsOut);

  console.log(
    `[lrt] wrote ${Object.keys(routesOut).length} routes and ${Object.keys(routeStopsOut).length} route-stop groups to ${OUT_DIR}/`,
  );
}
