import {
  Bound,
  Company,
  compositeId,
  type RouteOutput,
  type RouteStopsOutput,
  type StopOutput,
} from "../../types.js";
import type { GmbRegion, GmbRouteInfo, GmbRouteStop, GmbStop, RouteStopGroup } from "./api.js";

export function regionToCompany(region: GmbRegion): Company {
  switch (region) {
    case "HKI":
      return Company.GMBHKI;
    case "KLN":
      return Company.GMBKLN;
    case "NT":
      return Company.GMBNT;
  }
}

function routeSeqToBound(seq: number): Bound | null {
  if (seq === 1) return Bound.Outbound;
  if (seq === 2) return Bound.Inbound;
  return null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export type VariantIndex = {
  route_code: string;
  variant_index: number;
  route_id: number;
  info: GmbRouteInfo;
};

export function indexVariants(routeInfos: Map<string, GmbRouteInfo[]>): VariantIndex[] {
  const out: VariantIndex[] = [];
  for (const [route_code, infos] of routeInfos) {
    infos.forEach((info, i) => {
      out.push({ route_code, variant_index: i + 1, route_id: info.route_id, info });
    });
  }
  return out;
}

export function transformRoutes(
  region: GmbRegion,
  variants: VariantIndex[],
  routeStopGroups: RouteStopGroup[],
): RouteOutput[] {
  const company = regionToCompany(region);
  const nonEmpty = new Set<string>();
  for (const g of routeStopGroups) {
    if (g.stops.length > 0) nonEmpty.add(`${g.route_id}|${g.route_seq}`);
  }

  const out: RouteOutput[] = [];
  let skippedNoStops = 0;
  let skippedOddSeq = 0;

  for (const v of variants) {
    const service_type = String(v.variant_index);
    for (const dir of v.info.directions) {
      const bound = routeSeqToBound(dir.route_seq);
      if (!bound) {
        skippedOddSeq++;
        continue;
      }
      if (!nonEmpty.has(`${v.route_id}|${dir.route_seq}`)) {
        skippedNoStops++;
        continue;
      }
      out.push({
        record_id: compositeId(company, v.route_code, bound, service_type),
        company,
        route_id: String(v.route_id),
        route: v.route_code,
        bound,
        service_type,
        origin: { en: dir.orig_en, tc: dir.orig_tc, sc: dir.orig_sc },
        destination: { en: dir.dest_en, tc: dir.dest_tc, sc: dir.dest_sc },
      });
    }
  }

  const tag = `gmb-${region.toLowerCase()}`;
  if (skippedNoStops > 0)
    console.warn(`[${tag}] skipped ${skippedNoStops} direction(s) with no stops`);
  if (skippedOddSeq > 0)
    console.warn(`[${tag}] skipped ${skippedOddSeq} direction(s) with unsupported route_seq (>2)`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function collectStopIds(groups: RouteStopGroup[]): number[] {
  const ids = new Set<number>();
  for (const g of groups) {
    for (const rs of g.stops) {
      if (typeof rs.stop_id === "number") ids.add(rs.stop_id);
    }
  }
  return [...ids];
}

export function transformRouteStops(
  region: GmbRegion,
  routeStopGroups: RouteStopGroup[],
  stopsById: Map<number, GmbStop>,
): RouteStopsOutput[] {
  const company = regionToCompany(region);
  const out: RouteStopsOutput[] = [];
  let skippedOddSeq = 0;
  let skippedMissingFields = 0;

  for (const g of routeStopGroups) {
    if (g.stops.length === 0) continue;
    const bound = routeSeqToBound(g.route_seq);
    if (!bound) {
      skippedOddSeq++;
      continue;
    }
    const service_type = String(g.variant_index);
    const record_id = compositeId(company, g.route_code, bound, service_type);
    const stops: StopOutput[] = [];

    for (const rs of g.stops) {
      if (typeof rs.stop_id !== "number" || isBlank(rs.stop_seq)) {
        skippedMissingFields++;
        continue;
      }
      const stop = stopsById.get(rs.stop_id);
      const coord = stop?.coordinates.wgs84;
      stops.push({
        seq: Number(rs.stop_seq),
        stop_id: String(rs.stop_id),
        name: { en: rs.name_en, tc: rs.name_tc, sc: rs.name_sc },
        lat: coord ? coord.latitude : NaN,
        long: coord ? coord.longitude : NaN,
      });
    }

    stops.sort((a, b) => a.seq - b.seq);
    out.push({
      record_id,
      company,
      route_id: String(g.route_id),
      route: g.route_code,
      bound,
      service_type,
      stops,
    });
  }

  const tag = `gmb-${region.toLowerCase()}`;
  if (skippedOddSeq > 0)
    console.warn(`[${tag}] skipped ${skippedOddSeq} group(s) with unsupported route_seq`);
  if (skippedMissingFields > 0)
    console.warn(`[${tag}] skipped ${skippedMissingFields} route-stop(s) with missing fields`);
  return out.sort((a, b) => a.record_id.localeCompare(b.record_id));
}

export function buildRouteStopTasks(variants: VariantIndex[]): {
  route_code: string;
  variant_index: number;
  route_id: number;
  route_seq: number;
}[] {
  const out: {
    route_code: string;
    variant_index: number;
    route_id: number;
    route_seq: number;
  }[] = [];
  for (const v of variants) {
    for (const dir of v.info.directions) {
      out.push({
        route_code: v.route_code,
        variant_index: v.variant_index,
        route_id: v.route_id,
        route_seq: dir.route_seq,
      });
    }
  }
  return out;
}
