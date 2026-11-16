import { promises as fs } from "node:fs";
import path from "node:path";
import { JOINTLY_OPERATED_ROUTES } from "./companies/kmbctb/static.js";
import { Company, Localized } from "./types.js";

const OUT_DIR = path.resolve(process.cwd(), "out");
const FINAL_DIR = path.join(OUT_DIR, "final");

const COMPANY_DIRS = [
  "kmb",
  "ctb",
  "kmbctb",
  "mtrbus",
  "mtr",
  "lrt",
  "gmbhki",
  "gmbkln",
  "gmbnt",
  "nlb",
];

type RouteSource = {
  record_id: string;
  company: Company;
  route_id?: string;
  route: string | Localized;
  bound?: string;
  service_type?: string;
  route_seq?: number;
  region?: string;
  origin: Localized;
  destination: Localized;
  ctb_bound?: string;
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
    ctb_stop_id?: string;
  }>;
};

type RouteFinal = {
  record_id: string;
  company: Company;
  route_id?: string;
  route: string | Localized;
  bound?: string;
  service_type?: string;
  route_seq?: number;
  region?: string;
  origin: Localized;
  destination: Localized;
  stop_ids: string[];
  ctb_bound?: string;
};

type StopFinal = {
  stop_id: string;
  ctb_stop_id?: string;
  company: Company;
  name: Localized;
  lat: number;
  lng: number;
};

// Upstream APIs occasionally change a field's JSON type (e.g. NLB stopId "1" -> 1).
// TS types are erased at runtime, so coerce every string-typed field here and
// then validate the final shape before anything is written to out/final.
const asStr = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const optStr = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

function normalizeLocalized(v: Localized): Localized {
  return { en: asStr(v?.en), tc: asStr(v?.tc), sc: asStr(v?.sc) };
}

function normalizeRoute(r: RouteSource): RouteSource {
  return {
    ...r,
    record_id: asStr(r.record_id),
    route_id: optStr(r.route_id),
    route:
      typeof r.route === "object" && r.route !== null
        ? normalizeLocalized(r.route)
        : asStr(r.route),
    bound: optStr(r.bound),
    service_type: optStr(r.service_type),
    region: optStr(r.region),
    ctb_bound: optStr(r.ctb_bound),
    origin: normalizeLocalized(r.origin),
    destination: normalizeLocalized(r.destination),
  };
}

function normalizeStop(s: RouteStopsSource["stops"][number]): RouteStopsSource["stops"][number] {
  return {
    ...s,
    stop_id: asStr(s.stop_id),
    ctb_stop_id: optStr(s.ctb_stop_id),
    name: normalizeLocalized(s.name),
  };
}

function validateFinal(
  routes: Record<string, RouteFinal>,
  stops: Record<string, StopFinal>,
  stopRoutes: Record<string, Array<{ record_id: string; seq: number }>>,
  geoIndex: Record<string, string[]>,
): void {
  const problems: string[] = [];
  const show = (v: unknown) => JSON.stringify(v) ?? "undefined";
  const str = (where: string, v: unknown) => {
    if (typeof v !== "string") problems.push(`${where} = ${show(v)}`);
  };
  const optStrField = (where: string, v: unknown) => {
    if (v !== undefined) str(where, v);
  };
  const num = (where: string, v: unknown, nullable = false) => {
    if (typeof v !== "number" && !(nullable && v === null)) problems.push(`${where} = ${show(v)}`);
  };
  const localized = (where: string, v: unknown) => {
    if (!v || typeof v !== "object") {
      problems.push(`${where} = ${show(v)}`);
      return;
    }
    for (const k of ["en", "tc", "sc"]) str(`${where}.${k}`, (v as Record<string, unknown>)[k]);
  };

  for (const [k, s] of Object.entries(stops)) {
    str(`stops[${k}].stop_id`, s.stop_id);
    str(`stops[${k}].company`, s.company);
    optStrField(`stops[${k}].ctb_stop_id`, s.ctb_stop_id);
    localized(`stops[${k}].name`, s.name);
    num(`stops[${k}].lat`, s.lat, true);
    num(`stops[${k}].lng`, s.lng, true);
  }

  for (const [k, r] of Object.entries(routes)) {
    str(`routes[${k}].record_id`, r.record_id);
    str(`routes[${k}].company`, r.company);
    optStrField(`routes[${k}].route_id`, r.route_id);
    optStrField(`routes[${k}].bound`, r.bound);
    optStrField(`routes[${k}].service_type`, r.service_type);
    optStrField(`routes[${k}].region`, r.region);
    optStrField(`routes[${k}].ctb_bound`, r.ctb_bound);
    if (r.route_seq !== undefined) num(`routes[${k}].route_seq`, r.route_seq);
    if (typeof r.route === "string") str(`routes[${k}].route`, r.route);
    else localized(`routes[${k}].route`, r.route);
    localized(`routes[${k}].origin`, r.origin);
    localized(`routes[${k}].destination`, r.destination);
    r.stop_ids.forEach((id, i) => str(`routes[${k}].stop_ids[${i}]`, id));
  }

  for (const [k, list] of Object.entries(stopRoutes)) {
    list.forEach((e, i) => {
      str(`stop-routes[${k}][${i}].record_id`, e.record_id);
      num(`stop-routes[${k}][${i}].seq`, e.seq);
    });
  }

  for (const [k, list] of Object.entries(geoIndex)) {
    list.forEach((id, i) => str(`geo-index[${k}][${i}]`, id));
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 20).join("\n  ");
    const more = problems.length > 20 ? `\n  ...and ${problems.length - 20} more` : "";
    throw new Error(
      `[parse] refusing to write out/final: ${problems.length} type problem(s)\n  ${shown}${more}`,
    );
  }
}

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

function isJointKmbOrCtbRoute(route: RouteSource): boolean {
  if (route.company !== Company.KMB && route.company !== Company.CTB) return false;
  const routeNo =
    route.route_id ?? (typeof route.route === "string" ? route.route : undefined);
  return routeNo !== undefined && JOINTLY_OPERATED_ROUTES.has(routeNo);
}

export async function parseAll(): Promise<void> {
  const routes: Record<string, RouteFinal> = {};
  const stops: Record<string, StopFinal> = {};
  const stopRoutes: Record<string, Array<{ record_id: string; seq: number }>> = {};
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

    for (const [k, v] of Object.entries(routesData)) routesData[k] = normalizeRoute(v);
    for (const rsData of Object.values(routeStopsData)) {
      rsData.stops = rsData.stops.map(normalizeStop);
    }

    for (const [recordId, route] of Object.entries(routesData)) {
      const rs = routeStopsData[recordId];

      if (route.company === Company.KMBCTB) {
        // KMBCTB routes are fully namespaced under KMBCTB: — stops, stopRoutes
        // and geoIndex all get KMBCTB: entries. The original KMB / CTB stops
        // remain under their own namespaces (populated by their own passes),
        // but they do not carry the joint record_id.
        const joint_ids: string[] = [];

        if (rs) {
          for (const stop of rs.stops) {
            const jointFull = `${Company.KMBCTB}:${stop.stop_id}`;
            joint_ids.push(jointFull);
            if (!stops[jointFull]) {
              stops[jointFull] = {
                stop_id: stop.stop_id,
                ctb_stop_id: stop.ctb_stop_id,
                company: Company.KMBCTB,
                name: stop.name,
                lat: stop.lat,
                lng: stop.long,
              };
              const gh = encodeGeohash(stop.lat, stop.long);
              (geoIndex[gh] ||= []).push(jointFull);
            } else if (stop.ctb_stop_id && !stops[jointFull].ctb_stop_id) {
              stops[jointFull].ctb_stop_id = stop.ctb_stop_id;
            }

            const jointList = (stopRoutes[jointFull] ||= []);
            if (!jointList.some((e) => e.record_id === recordId && e.seq === stop.seq)) {
              jointList.push({ record_id: recordId, seq: stop.seq });
            }
          }
        }

        routes[recordId] = {
          record_id: route.record_id,
          company: route.company,
          route_id: route.route_id,
          route: route.route,
          bound: route.bound,
          ctb_bound: route.ctb_bound,
          service_type: route.service_type,
          origin: route.origin,
          destination: route.destination,
          stop_ids: joint_ids,
        };
        continue;
      }

      const skipRouteEmit = isJointKmbOrCtbRoute(route);
      if (skipRouteEmit) continue;

      const stop_ids: string[] = [];

      if (rs) {
        for (const stop of rs.stops) {
          const fullStopId = `${route.company}:${stop.stop_id}`;
          stop_ids.push(fullStopId);

          if (!stops[fullStopId]) {
            stops[fullStopId] = {
              stop_id: stop.stop_id,
              ctb_stop_id: undefined,
              company: route.company,
              name: stop.name,
              lat: stop.lat,
              lng: stop.long,
            };
            const gh = encodeGeohash(stop.lat, stop.long);
            (geoIndex[gh] ||= []).push(fullStopId);
          }

          const list = (stopRoutes[fullStopId] ||= []);
          if (!list.some((e) => e.record_id === recordId && e.seq === stop.seq)) {
            list.push({ record_id: recordId, seq: stop.seq });
          }
        }
      }

      routes[recordId] = {
        record_id: route.record_id,
        company: route.company,
        route_id: route.route_id,
        route: route.route,
        bound: route.bound,
        service_type: route.service_type,
        route_seq: route.route_seq,
        region: route.region,
        origin: route.origin,
        destination: route.destination,
        stop_ids: stop_ids,
      };
    }
  }

  validateFinal(routes, stops, stopRoutes, geoIndex);

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
