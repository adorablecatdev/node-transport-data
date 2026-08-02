import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseCsv } from "../../lib/gtfs.js";
import { readJsonIfExists, writeJson } from "../../lib/io.js";
import { csvRow, FUZZY_THRESHOLD, normalize, similarity, splitFromTo } from "../gtfs_fuzzy.js";

type GtfsRouteRow = {
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: string;
  route_url: string;
};

type CtbRouteEntry = {
  record_id: string;
  route: string;
  bound: "O" | "I";
  origin: { en: string; tc: string; sc: string };
  destination: { en: string; tc: string; sc: string };
};

// Origin/destination are pre-resolved with the swap already applied so consumers
// don't have to know about orientation. For a "swapped" match, gtfs_from maps
// to the CTB record's destination and gtfs_to maps to its origin, so we invert
// them here at write time.
export type MappingEntry = {
  record_id: string;
  origin: string;
  destination: string;
};

// KMB+CTB / LWB+CTB rows in the GTFS feed are joint routes and belong to the
// KMBCTB dataset, so only agency=CTB is considered here.
const CTB_AGENCIES = new Set(["CTB"]);

type Candidate = {
  key: string;
  bound: "O" | "I";
  origTc: string;
  destTc: string;
  origTcNorm: string;
  destTcNorm: string;
};

type ScoreRecord = {
  route_id: string;
  route_short_name: string;
  gtfs_from: string;
  gtfs_to: string;
  matched_key: string;
  operator_origin_tc: string;
  operator_destination_tc: string;
  orientation: "forward" | "swapped" | "";
  sim_from: number | null;
  sim_to: number | null;
  avg: number | null;
  reason: "no-split" | "no-candidate" | "below-threshold" | "";
};

export async function buildCtbGtfsMapping(
  routesCsv: string,
  ctbRoutesJsonPath: string,
  mappingOutPath: string,
  fuzzyOutPath: string,
  unmappedOutPath: string,
): Promise<Record<string, MappingEntry> | undefined> {
  const ctbRoutes = await readJsonIfExists<Record<string, CtbRouteEntry>>(ctbRoutesJsonPath);
  if (!ctbRoutes) {
    console.warn(
      `[time_table] ${ctbRoutesJsonPath} missing — run \`ctb\` first if you want the GTFS mapping.`,
    );
    return undefined;
  }

  // Two indexes:
  //  - byRouteOrigDest: normalized "route|from|to" for the exact pass.
  //  - byRoute: all candidates sharing a route number, for the fuzzy fallback.
  // A GTFS row's FROM/TO reflects the outbound direction of the CTB route, so
  // bound=O is preferred at each tie-break.
  const byRouteOrigDest = new Map<string, Candidate[]>();
  const byRoute = new Map<string, Candidate[]>();
  for (const [key, r] of Object.entries(ctbRoutes)) {
    const cand: Candidate = {
      key,
      bound: r.bound,
      origTc: r.origin.tc,
      destTc: r.destination.tc,
      origTcNorm: normalize(r.origin.tc),
      destTcNorm: normalize(r.destination.tc),
    };
    const exactKey = `${r.route}|${cand.origTcNorm}|${cand.destTcNorm}`;
    const exactArr = byRouteOrigDest.get(exactKey) ?? [];
    exactArr.push(cand);
    byRouteOrigDest.set(exactKey, exactArr);

    const routeArr = byRoute.get(r.route) ?? [];
    routeArr.push(cand);
    byRoute.set(r.route, routeArr);
  }

  function pickBest(candidates: Candidate[]): Candidate | undefined {
    return candidates.find((c) => c.bound === "O") ?? candidates[0];
  }

  const rows = parseCsv<GtfsRouteRow>(routesCsv);
  const mapping: Record<string, MappingEntry> = {};
  const fuzzy: ScoreRecord[] = [];
  const unmapped: ScoreRecord[] = [];

  for (const row of rows) {
    if (!CTB_AGENCIES.has(row.agency_id)) continue;
    const parts = splitFromTo(row.route_long_name);
    if (!parts) {
      unmapped.push({
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        gtfs_from: row.route_long_name,
        gtfs_to: "",
        matched_key: "",
        operator_origin_tc: "",
        operator_destination_tc: "",
        orientation: "",
        sim_from: null,
        sim_to: null,
        avg: null,
        reason: "no-split",
      });
      continue;
    }
    const fromNorm = normalize(parts.from);
    const toNorm = normalize(parts.to);
    const gtfsFrom = parts.from.trim();
    const gtfsTo = parts.to.trim();

    // Exact forward pass — the common case, GTFS FROM/TO aligns with the
    // operator's outbound origin/destination.
    const forwardExact = byRouteOrigDest.get(`${row.route_short_name}|${fromNorm}|${toNorm}`);
    const forwardChosen = forwardExact ? pickBest(forwardExact) : undefined;
    if (forwardChosen) {
      mapping[row.route_id] = {
        record_id: forwardChosen.key,
        origin: gtfsFrom,
        destination: gtfsTo,
      };
      continue;
    }

    // Exact swapped pass — CTB routes like 47P are only published outbound
    // with origin/destination inverted relative to GTFS. Try FROM↔TO before
    // giving up.
    const swappedExact = byRouteOrigDest.get(`${row.route_short_name}|${toNorm}|${fromNorm}`);
    const swappedChosen = swappedExact ? pickBest(swappedExact) : undefined;
    if (swappedChosen) {
      mapping[row.route_id] = {
        record_id: swappedChosen.key,
        origin: gtfsTo,
        destination: gtfsFrom,
      };
      fuzzy.push({
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        gtfs_from: gtfsFrom,
        gtfs_to: gtfsTo,
        matched_key: swappedChosen.key,
        operator_origin_tc: swappedChosen.origTc,
        operator_destination_tc: swappedChosen.destTc,
        orientation: "swapped",
        sim_from: 1,
        sim_to: 1,
        avg: 1,
        reason: "",
      });
      continue;
    }

    // Fuzzy fallback: only look at candidates with the same route number,
    // score each against (FROM, TO) in both orientations, pick the best.
    const routeCandidates = byRoute.get(row.route_short_name);
    if (!routeCandidates || routeCandidates.length === 0) {
      unmapped.push({
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        gtfs_from: gtfsFrom,
        gtfs_to: gtfsTo,
        matched_key: "",
        operator_origin_tc: "",
        operator_destination_tc: "",
        orientation: "",
        sim_from: null,
        sim_to: null,
        avg: null,
        reason: "no-candidate",
      });
      continue;
    }
    let best:
      | {
          cand: Candidate;
          orientation: "forward" | "swapped";
          simFrom: number;
          simTo: number;
          avg: number;
        }
      | undefined;
    for (const cand of routeCandidates) {
      const simFromFwd = similarity(fromNorm, cand.origTcNorm);
      const simToFwd = similarity(toNorm, cand.destTcNorm);
      const avgFwd = (simFromFwd + simToFwd) / 2;
      const simFromRev = similarity(fromNorm, cand.destTcNorm);
      const simToRev = similarity(toNorm, cand.origTcNorm);
      const avgRev = (simFromRev + simToRev) / 2;
      const useRev = avgRev > avgFwd;
      const scored = {
        cand,
        orientation: useRev ? ("swapped" as const) : ("forward" as const),
        simFrom: useRev ? simFromRev : simFromFwd,
        simTo: useRev ? simToRev : simToFwd,
        avg: useRev ? avgRev : avgFwd,
      };
      if (!best || scored.avg > best.avg) best = scored;
    }
    if (!best) {
      // Unreachable in practice (routeCandidates.length > 0), but keeps
      // TypeScript happy about `best` being defined below.
      unmapped.push({
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        gtfs_from: gtfsFrom,
        gtfs_to: gtfsTo,
        matched_key: "",
        operator_origin_tc: "",
        operator_destination_tc: "",
        orientation: "",
        sim_from: null,
        sim_to: null,
        avg: null,
        reason: "no-candidate",
      });
      continue;
    }
    const score: ScoreRecord = {
      route_id: row.route_id,
      route_short_name: row.route_short_name,
      gtfs_from: gtfsFrom,
      gtfs_to: gtfsTo,
      matched_key: best.cand.key,
      operator_origin_tc: best.cand.origTc,
      operator_destination_tc: best.cand.destTc,
      orientation: best.orientation,
      sim_from: best.simFrom,
      sim_to: best.simTo,
      avg: best.avg,
      reason: "",
    };
    if (best.avg < FUZZY_THRESHOLD) {
      score.reason = "below-threshold";
      unmapped.push(score);
      continue;
    }
    mapping[row.route_id] =
      best.orientation === "swapped"
        ? { record_id: best.cand.key, origin: gtfsTo, destination: gtfsFrom }
        : { record_id: best.cand.key, origin: gtfsFrom, destination: gtfsTo };
    fuzzy.push(score);
  }

  await writeJson(mappingOutPath, mapping);

  const scoreColumns = [
    "route_id",
    "route_short_name",
    "gtfs_from",
    "gtfs_to",
    "matched_key",
    "ctb_origin_tc",
    "ctb_destination_tc",
    "orientation",
    "sim_from",
    "sim_to",
    "avg",
    "reason",
  ];
  const fmt = (n: number | null): string => (n === null ? "" : n.toFixed(3));
  const rowToCells = (s: ScoreRecord): Array<string | number> => [
    s.route_id,
    s.route_short_name,
    s.gtfs_from,
    s.gtfs_to,
    s.matched_key,
    s.operator_origin_tc,
    s.operator_destination_tc,
    s.orientation,
    fmt(s.sim_from),
    fmt(s.sim_to),
    fmt(s.avg),
    s.reason,
  ];

  // Fuzzy report: worst avg first so borderline matches surface at the top.
  await mkdir(dirname(fuzzyOutPath), { recursive: true });
  const fuzzyLines = fuzzy
    .slice()
    .sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0))
    .map((f) => csvRow(rowToCells(f)));
  await writeFile(
    fuzzyOutPath,
    [csvRow(scoreColumns), ...fuzzyLines, ""].join("\n"),
    "utf8",
  );

  // Unmapped report: best avg first — the closest-but-still-rejected rows are
  // the ones to inspect when deciding whether to lower FUZZY_THRESHOLD.
  await mkdir(dirname(unmappedOutPath), { recursive: true });
  const unmappedLines = unmapped
    .slice()
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
    .map((u) => csvRow(rowToCells(u)));
  await writeFile(
    unmappedOutPath,
    [csvRow(scoreColumns), ...unmappedLines, ""].join("\n"),
    "utf8",
  );

  const swappedExactCount = fuzzy.filter((f) => f.orientation === "swapped" && f.avg === 1).length;
  const fuzzyOnlyCount = fuzzy.length - swappedExactCount;
  const exactForwardCount = Object.keys(mapping).length - fuzzy.length;
  console.log(
    `[time_table] CTB GTFS mapping: exact ${exactForwardCount}, ` +
      `exact-swapped ${swappedExactCount}, fuzzy ${fuzzyOnlyCount}, ` +
      `unmapped ${unmapped.length} → ${mappingOutPath}, ${fuzzyOutPath}, ${unmappedOutPath}`,
  );
  return mapping;
}
