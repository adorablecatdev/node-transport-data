import { promises as fs } from "node:fs";
import path from "node:path";
import { Company, Localized } from "./types.js";

const OUT_DIR = path.resolve(process.cwd(), "out");
const FINAL_DIR = path.join(OUT_DIR, "final");

const COMPANY_DIRS = [
  "kmb",
  "citybus",
  "mtrbus",
  "mtr",
  "lightrail",
  "gmbhki",
  "gmbkln",
  "gmbnt",
  "nlb",
];

type RouteSource = {
  record_id: string;
  company: Company;
  route: string | Localized;
  bound: string;
  service_type: string;
  origin: Localized;
  destination: Localized;
};

type RouteStopsSource = {
  record_id: string;
  company: Company;
  stops: Array<{
    seq: number;
    stop_id: string;
    name: Localized;
    lat: number;
    long: number;
  }>;
};

type RouteFinal = {
  record_id: string;
  company: Company;
  route: string | Localized;
  bound: string;
  service_type: string;
  origin: Localized;
  destination: Localized;
  stop_ids: string[];
};

type StopFinal = {
  stop_id: string;
  company: Company;
  name: Localized;
  lat: number;
  lng: number;
};

const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bits = 0;
  let bit = 0;
  let evenBit = true;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        bits = (bits << 1) | 1;
        lngMin = mid;
      } else {
        bits = bits << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bit++;
    if (bit === 5) {
      hash += GEOHASH_BASE32[bits];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function parseAll(): Promise<void> {
  const routes: Record<string, RouteFinal> = {};
  const stops: Record<string, StopFinal> = {};
  const stopRoutes: Record<string, string[]> = {};
  const geoIndex: Record<string, string[]> = {};

  let companiesProcessed = 0;

  for (const dir of COMPANY_DIRS) {
    const routesData = await readJsonIfExists<Record<string, RouteSource>>(
      path.join(OUT_DIR, dir, "routes.json"),
    );
    const routeStopsData = await readJsonIfExists<Record<string, RouteStopsSource>>(
      path.join(OUT_DIR, dir, "route-stops.json"),
    );

    if (!routesData || !routeStopsData) {
      console.warn(`[parse] skipping ${dir} (missing routes.json or route-stops.json)`);
      continue;
    }

    companiesProcessed++;

    for (const [recordId, route] of Object.entries(routesData)) {
      const rs = routeStopsData[recordId];
      const stop_ids: string[] = [];

      if (rs) {
        for (const stop of rs.stops) {
          const fullStopId = `${route.company}:${stop.stop_id}`;
          stop_ids.push(fullStopId);

          if (!stops[fullStopId]) {
            stops[fullStopId] = {
              stop_id: stop.stop_id,
              company: route.company,
              name: stop.name,
              lat: stop.lat,
              lng: stop.long,
            };
            const gh = encodeGeohash(stop.lat, stop.long);
            (geoIndex[gh] ||= []).push(fullStopId);
          }

          const list = (stopRoutes[fullStopId] ||= []);
          if (list[list.length - 1] !== recordId && !list.includes(recordId)) {
            list.push(recordId);
          }
        }
      }

      routes[recordId] = {
        record_id: route.record_id,
        company: route.company,
        route: route.route,
        bound: route.bound,
        service_type: route.service_type,
        origin: route.origin,
        destination: route.destination,
        stop_ids: stop_ids,
      };
    }
  }

  await fs.mkdir(FINAL_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(FINAL_DIR, "routes.json"), JSON.stringify(routes, null, 2)),
    fs.writeFile(path.join(FINAL_DIR, "stops.json"), JSON.stringify(stops, null, 2)),
    fs.writeFile(
      path.join(FINAL_DIR, "stop-routes.json"),
      JSON.stringify(stopRoutes, null, 2),
    ),
    fs.writeFile(path.join(FINAL_DIR, "geo-index.json"), JSON.stringify(geoIndex, null, 2)),
  ]);

  console.log(
    `[parse] ${companiesProcessed} companies -> ${Object.keys(routes).length} routes, ` +
      `${Object.keys(stops).length} stops, ${Object.keys(geoIndex).length} geohash cells`,
  );
}
