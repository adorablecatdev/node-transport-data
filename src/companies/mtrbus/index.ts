import { writeJson } from "../../lib/io.js";
import { fetchRoutes, fetchStops } from "./api.js";
import { transformRouteStops, transformRoutes } from "./transform.js";

const OUT_DIR = "out/mtrbus";

function keyByRecordId<T extends { record_id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.record_id] = item;
  return out;
}

export async function run(): Promise<void> {
  console.log("[mtrb] fetching routes");
  const routes = await fetchRoutes();
  console.log("[mtrb] fetching stops");
  const stops = await fetchStops();

  const routesOut = keyByRecordId(transformRoutes(routes, stops));
  const routeStopsOut = keyByRecordId(transformRouteStops(routes, stops));

  // bound_temp carries the i/o direction that pairs a routes.json record with the
  // route-stops.json record derived from mtr_bus_stops.csv's DIRECTION column.
  // Once both maps are built, the field is redundant — strip it before persisting.
  for (const r of Object.values(routesOut)) delete (r as { bound_temp?: string }).bound_temp;
  for (const r of Object.values(routeStopsOut)) delete (r as { bound_temp?: string }).bound_temp;

  await writeJson(`${OUT_DIR}/routes.json`, routesOut);
  await writeJson(`${OUT_DIR}/route-stops.json`, routeStopsOut);

  console.log(
    `[mtrb] wrote ${Object.keys(routesOut).length} routes and ${Object.keys(routeStopsOut).length} route-stop groups to ${OUT_DIR}/`,
  );
}
