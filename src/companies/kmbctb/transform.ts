import {
  Bound,
  Company,
  type Localized,
  type StopOutput,
} from "../../types.js";
import type { CtbRouteOutput, CtbRouteStopsOutput } from "../ctb/transform.js";
import type { KmbRouteOutput, KmbRouteStopsOutput } from "../kmb/transform.js";
import { JOINTLY_OPERATED_ROUTES, REVERSE_DIR_ROUTES } from "./static.js";

export type KmbCtbBound = "I" | "O";

export type KmbCtbRouteOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: KmbCtbBound;
  ctb_bound: KmbCtbBound;
  service_type: string;
  origin: Localized;
  destination: Localized;
};

export type KmbCtbRouteStopsOutput = {
  record_id: string;
  company: Company;
  route: string;
  bound: KmbCtbBound;
  ctb_bound: KmbCtbBound;
  service_type: string;
  stops: StopOutput[];
};

function kmbCtbCompositeId(route: string, bound: KmbCtbBound, service_type: string): string {
  return `${Company.KMBCTB}-${route}-${bound}-${service_type}`;
}

function otherBound(b: Bound): Bound {
  return b === Bound.Inbound ? Bound.Outbound : Bound.Inbound;
}

function kmbBoundToEnum(b: "I" | "O"): Bound {
  return b === "I" ? Bound.Inbound : Bound.Outbound;
}

function boundToShort(b: Bound): "I" | "O" {
  return b === Bound.Inbound ? "I" : "O";
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
  kmbRoutes: Record<string, KmbRouteOutput>;
  kmbRouteStops: Record<string, KmbRouteStopsOutput>;
  ctbRoutes: Record<string, CtbRouteOutput>;
  ctbRouteStops: Record<string, CtbRouteStopsOutput>;
};

export type KmbCtbTransformResult = {
  routes: Record<string, KmbCtbRouteOutput>;
  routeStops: Record<string, KmbCtbRouteStopsOutput>;
  stats: { produced: number; skippedNoCtb: number; unmatchedStops: number };
};

export function transformKmbCtb(inputs: Inputs): KmbCtbTransformResult {
  const routes: Record<string, KmbCtbRouteOutput> = {};
  const routeStops: Record<string, KmbCtbRouteStopsOutput> = {};
  let skippedNoCtb = 0;
  let unmatchedStops = 0;

  for (const kmbRoute of Object.values(inputs.kmbRoutes)) {
    if (!JOINTLY_OPERATED_ROUTES.has(kmbRoute.route)) continue;

    const kmbBound = kmbBoundToEnum(kmbRoute.bound);
    const ctbBound = ctbBoundFor(kmbRoute.route, kmbBound);
    const kmbBoundShort = boundToShort(kmbBound);
    const ctbBoundShort = boundToShort(ctbBound);
    const ctbRecordId = `${Company.CTB}-${kmbRoute.route}-${ctbBoundShort}`;
    const ctbRoute = inputs.ctbRoutes[ctbRecordId];
    const ctbStops = inputs.ctbRouteStops[ctbRecordId];

    if (!ctbRoute || !ctbStops) {
      skippedNoCtb++;
      continue;
    }

    const kmbStops = inputs.kmbRouteStops[kmbRoute.record_id];
    if (!kmbStops) continue;

    const jointId = kmbCtbCompositeId(kmbRoute.route, kmbBoundShort, kmbRoute.service_type);

    routes[jointId] = {
      record_id: jointId,
      company: Company.KMBCTB,
      route: kmbRoute.route,
      bound: kmbBoundShort,
      ctb_bound: ctbBoundShort,
      service_type: kmbRoute.service_type,
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
      route: kmbRoute.route,
      bound: kmbBoundShort,
      ctb_bound: ctbBoundShort,
      service_type: kmbRoute.service_type,
      stops,
    };
  }

  return {
    routes,
    routeStops,
    stats: { produced: Object.keys(routes).length, skippedNoCtb, unmatchedStops },
  };
}
