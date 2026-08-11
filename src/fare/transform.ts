import { parseCsv } from "../lib/gtfs.js";
import { Company } from "../types.js";

// Route key `{Company}-{route_short_name}-{direction}` (direction is
// "outbound" | "inbound") → boarding stop_sequence → fare (HKD). Sparse:
// only stops where the fare changes from the previous stop_sequence are
// emitted; the fare stays at the last emitted value until the next change.
export type FareTable = Record<string, Record<string, number>>;

const AGENCY_TO_COMPANY: Record<string, Company> = {
  KMB: Company.KMB,
  LWB: Company.KMB,
  CTB: Company.CTB,
  "KMB+CTB": Company.KMBCTB,
  "LWB+CTB": Company.KMBCTB,
  LRTFeeder: Company.MTRB,
  NLB: Company.NLB,
};

type RouteRow = { route_id: string; agency_id: string; route_short_name: string };
type FareAttrRow = { fare_id: string; price: string; agency_id: string };
type FareRuleRow = { fare_id: string; route_id: string };

// fare_id encodes `{route_id}-{direction}-{origin_seq}-{dest_seq}` where
// direction is "1" (outbound) or "2" (inbound). route_id itself may contain
// dashes; the last three dash-separated segments are always the semantic
// fields, so split from the right.
function parseFareId(fareId: string): { direction: "outbound" | "inbound"; originSeq: number } | null {
  const parts = fareId.split("-");
  if (parts.length < 4) return null;
  const originSeq = Number(parts[parts.length - 2]);
  const dirRaw = parts[parts.length - 3];
  if (!Number.isFinite(originSeq)) return null;
  const direction = dirRaw === "1" ? "outbound" : dirRaw === "2" ? "inbound" : undefined;
  if (!direction) return null;
  return { direction, originSeq };
}

export function transformFare(inputs: {
  routesCsv: string;
  fareAttributesCsv: string;
  fareRulesCsv: string;
  gmbRegionByRouteId?: Map<string, Company>;
}): FareTable {
  const routes = parseCsv<RouteRow>(inputs.routesCsv);
  const fareAttrs = parseCsv<FareAttrRow>(inputs.fareAttributesCsv);
  const fareRules = parseCsv<FareRuleRow>(inputs.fareRulesCsv);
  const gmbMap = inputs.gmbRegionByRouteId;

  const routeById = new Map<string, RouteRow>();
  for (const r of routes) routeById.set(r.route_id, r);

  const priceByFareId = new Map<string, number>();
  for (const a of fareAttrs) {
    const price = Number(a.price);
    if (!Number.isFinite(price)) continue;
    priceByFareId.set(a.fare_id, price);
  }

  // (routeKey, originSeq) → max fare across all destinations from that
  // boarding stop. HK bus fare stages: you tap the full fare at boarding
  // and get section refunds later, so the max represents the actual pay.
  const maxFareByBoard = new Map<string, Map<number, number>>();
  let orphanRoutes = 0;
  let malformedFareIds = 0;
  const droppedByAgency = new Map<string, number>();

  for (const rule of fareRules) {
    const route = routeById.get(rule.route_id);
    if (!route) {
      orphanRoutes++;
      continue;
    }

    let company: Company | undefined;
    if (route.agency_id === "GMB") company = gmbMap?.get(route.route_id);
    else company = AGENCY_TO_COMPANY[route.agency_id];

    if (!company) {
      droppedByAgency.set(route.agency_id, (droppedByAgency.get(route.agency_id) ?? 0) + 1);
      continue;
    }

    const price = priceByFareId.get(rule.fare_id);
    if (price === undefined) continue;

    const parsed = parseFareId(rule.fare_id);
    if (!parsed) {
      malformedFareIds++;
      continue;
    }

    const routeKey = `${company}-${route.route_short_name}-${parsed.direction}`;
    let bySeq = maxFareByBoard.get(routeKey);
    if (!bySeq) {
      bySeq = new Map();
      maxFareByBoard.set(routeKey, bySeq);
    }
    const prev = bySeq.get(parsed.originSeq);
    if (prev === undefined || price > prev) bySeq.set(parsed.originSeq, price);
  }

  if (orphanRoutes || malformedFareIds) {
    console.warn(
      `[fare] dropped fare rules: ${orphanRoutes} unknown route_id, ` +
        `${malformedFareIds} unparseable fare_id`,
    );
  }
  if (droppedByAgency.size) {
    const summary = [...droppedByAgency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([a, n]) => `${a}=${n}`)
      .join(", ");
    console.warn(`[fare] dropped fare rules from unmapped agencies: ${summary}`);
  }

  const result: FareTable = {};
  for (const [routeKey, bySeq] of maxFareByBoard) {
    const seqs = [...bySeq.keys()].sort((a, b) => a - b);
    const sparse: Record<string, number> = {};
    let last: number | undefined;
    for (const seq of seqs) {
      const fare = bySeq.get(seq)!;
      if (last === undefined || fare !== last) {
        sparse[String(seq)] = fare;
        last = fare;
      }
    }
    result[routeKey] = sparse;
  }

  const sortedResult: FareTable = {};
  for (const k of Object.keys(result).sort()) sortedResult[k] = result[k]!;
  return sortedResult;
}
