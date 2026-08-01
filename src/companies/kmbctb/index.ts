import { readJsonIfExists, writeJson } from "../../lib/io.js";
import type { CtbRouteOutput, CtbRouteStopsOutput } from "../ctb/transform.js";
import type { KmbRouteOutput, KmbRouteStopsOutput } from "../kmb/transform.js";
import { transformKmbCtb } from "./transform.js";

const KMB_DIR = "out/kmb";
const CTB_DIR = "out/ctb";
const OUT_DIR = "out/kmbctb";

async function loadCompany<TR, TS>(dir: string): Promise<{
  routes: Record<string, TR>;
  routeStops: Record<string, TS>;
} | null> {
  const routes = await readJsonIfExists<Record<string, TR>>(`${dir}/routes.json`);
  const routeStops = await readJsonIfExists<Record<string, TS>>(
    `${dir}/route-stops.json`,
  );
  if (!routes || !routeStops) return null;
  return { routes, routeStops };
}

export async function run(): Promise<void> {
  console.log("[kmbctb] loading kmb + ctb outputs");
  const [kmb, ctb] = await Promise.all([
    loadCompany<KmbRouteOutput, KmbRouteStopsOutput>(KMB_DIR),
    loadCompany<CtbRouteOutput, CtbRouteStopsOutput>(CTB_DIR),
  ]);

  if (!kmb || !ctb) {
    throw new Error(
      `[kmbctb] missing prerequisite outputs — run kmb and ctb first (need ${KMB_DIR}/*.json and ${CTB_DIR}/*.json)`,
    );
  }

  const result = transformKmbCtb({
    kmbRoutes: kmb.routes,
    kmbRouteStops: kmb.routeStops,
    ctbRoutes: ctb.routes,
    ctbRouteStops: ctb.routeStops,
  });

  await Promise.all([
    writeJson(`${OUT_DIR}/routes.json`, result.routes),
    writeJson(`${OUT_DIR}/route-stops.json`, result.routeStops),
  ]);

  const { produced, skippedNoCtb, unmatchedStops } = result.stats;
  console.log(
    `[kmbctb] wrote ${produced} joint routes to ${OUT_DIR}/ ` +
      `(skipped ${skippedNoCtb} without CTB counterpart, ${unmatchedStops} stops without nearest CTB match)`,
  );
}
