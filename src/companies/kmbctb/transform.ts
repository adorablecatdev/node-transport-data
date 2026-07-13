import {
  Bound,
  Company,
  compositeId,
  type RouteOutput,
  type RouteStopsOutput,
  type StopOutput,
} from "../../types.js";
import { JOINTLY_OPERATED_ROUTES, REVERSE_DIR_ROUTES } from "./static.js";

const SERVICE_TYPE = "1";

function otherBound(b: Bound): Bound {
  return b === Bound.Inbound ? Bound.Outbound : Bound.Inbound;
}

function ctbBoundFor(route: string, kmbBound: Bound): Bound {
  return REVERSE_DIR_ROUTES.has(route) ? otherBound(kmbBound) : kmbBound;
}

// Haversine distance in metres.
function distanceMeters(
  a: { lat: number; long: number },
  b: { lat: number; long: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.long - a.long);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isFiniteCoord(s: StopOutput): boolean {
  return Number.isFinite(s.lat) && Number.isFinite(s.long);
}

function nearestStop(target: StopOutput, candidates: StopOutput[]): StopOutput | null {
  if (!isFiniteCoord(target)) return null;
  let best: StopOutput | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (!isFiniteCoord(c)) continue;
    const d = distanceMeters(target, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

type Inputs = {
  kmbRoutes: Record<string, RouteOutput>;
  kmbRouteStops: Record<string, RouteStopsOutput>;
  ctbRoutes: Record<string, RouteOutput>;
  ctbRouteStops: Record<string, RouteStopsOutput>;
};

export type KmbCtbTransformResult = {
  routes: Record<string, RouteOutput>;
  routeStops: Record<string, RouteStopsOutput>;
  stats: { produced: number; skippedNoCtb: number; unmatchedStops: number };
};

export function transformKmbCtb(inputs: Inputs): KmbCtbTransformResult {
  const routes: Record<string, RouteOutput> = {};
  const routeStops: Record<string, RouteStopsOutput> = {};
  let skippedNoCtb = 0;
  let unmatchedStops = 0;

  for (const kmbRoute of Object.values(inputs.kmbRoutes)) {
    if (!JOINTLY_OPERATED_ROUTES.has(kmbRoute.route_id)) continue;

    const ctbBound = ctbBoundFor(kmbRoute.route_id, kmbRoute.bound);
    const ctbRecordId = compositeId(Company.CTB, kmbRoute.route_id, ctbBound, SERVICE_TYPE);
    const ctbRoute = inputs.ctbRoutes[ctbRecordId];
    const ctbStops = inputs.ctbRouteStops[ctbRecordId];

    if (!ctbRoute || !ctbStops) {
      skippedNoCtb++;
      continue;
    }

    const kmbStops = inputs.kmbRouteStops[kmbRoute.record_id];
    if (!kmbStops) continue;

    const jointId = compositeId(Company.KMBCTB, kmbRoute.route_id, kmbRoute.bound, SERVICE_TYPE);

    routes[jointId] = {
      record_id: jointId,
      company: Company.KMBCTB,
      route_id: kmbRoute.route_id,
      route: kmbRoute.route,
      bound: kmbRoute.bound,
      ctb_bound: ctbBound,
      service_type: SERVICE_TYPE,
      origin: kmbRoute.origin,
      destination: kmbRoute.destination,
    };

    const ctbStopCandidates = ctbStops.stops;
    const stops: StopOutput[] = kmbStops.stops.map((s) => {
      const nearest = nearestStop(s, ctbStopCandidates);
      if (!nearest) unmatchedStops++;
      return {
        seq: s.seq,
        stop_id: s.stop_id,
        name: s.name,
        lat: s.lat,
        long: s.long,
        ctb_stop_id: nearest?.stop_id,
      };
    });

    routeStops[jointId] = {
      record_id: jointId,
      company: Company.KMBCTB,
      route_id: kmbRoute.route_id,
      route: kmbRoute.route,
      bound: kmbRoute.bound,
      ctb_bound: ctbBound,
      service_type: SERVICE_TYPE,
      stops,
    };
  }

  return {
    routes,
    routeStops,
    stats: { produced: Object.keys(routes).length, skippedNoCtb, unmatchedStops },
  };
}
