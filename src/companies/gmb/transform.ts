import { Company, type Localized, type StopOutput } from "../../types.js";
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

export type GmbRouteOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: string;
  route_seq: number;
  region: GmbRegion;
  origin: Localized;
  destination: Localized;
};

export type GmbRouteStopsOutput = {
  record_id: string;
  company: Company;
  route_id: string;
  route: string;
  route_seq: number;
  region: GmbRegion;
  stops: StopOutput[];
};

function gmbCompositeId(
  company: Company,
  route: string,
  route_id: string | number,
  route_seq: number,
): string {
  return `${company}-${route}-${route_id}-${route_seq}`;
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
): GmbRouteOutput[] {
  const company = regionToCompany(region);
  const nonEmpty = new Set<string>();
  for (const g of routeStopGroups) {
    if (g.stops.length > 0) nonEmpty.add(`${g.route_id}|${g.route_seq}`);
  }

  const out: GmbRouteOutput[] = [];
  let skippedNoStops = 0;

  for (const v of variants) {
    for (const dir of v.info.directions) {
      if (!nonEmpty.has(`${v.route_id}|${dir.route_seq}`)) {
        skippedNoStops++;
        continue;
      }
      const route_id = String(v.route_id);
      out.push({
        record_id: gmbCompositeId(company, v.route_code, route_id, dir.route_seq),
        company,
        route_id,
        route: v.route_code,
        route_seq: dir.route_seq,
        region,
        origin: { en: dir.orig_en, tc: dir.orig_tc, sc: dir.orig_sc },
        destination: { en: dir.dest_en, tc: dir.dest_tc, sc: dir.dest_sc },
      });
    }
  }

  const tag = `gmb-${region.toLowerCase()}`;
  if (skippedNoStops > 0)
    console.warn(`[${tag}] skipped ${skippedNoStops} direction(s) with no stops`);
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
): GmbRouteStopsOutput[] {
  const company = regionToCompany(region);
  const out: GmbRouteStopsOutput[] = [];
  let skippedMissingFields = 0;

  for (const g of routeStopGroups) {
    if (g.stops.length === 0) continue;
    const route_id = String(g.route_id);
    const record_id = gmbCompositeId(company, g.route_code, route_id, g.route_seq);
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
      route_id,
      route: g.route_code,
      route_seq: g.route_seq,
      region,
      stops,
    });
  }

  const tag = `gmb-${region.toLowerCase()}`;
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
