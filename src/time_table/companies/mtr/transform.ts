import { Company } from "../../../types.js";
import type { Timetable } from "../../types.js";

// MTR + LRT interval-page parser. Both companies come from the SAME HTML
// table on the MTR service-index page, so parsing is shared here; each
// company's index.ts calls parseMtrIntervals() once and picks its slice.
//
// MTR entries use a distinct per-column shape (mtrWeekDayType1..5) and do NOT
// follow the standard Timetable convention — they go to mtr-intervals.json.
// LRT entries map into the standard Timetable shape (per-direction, weekday
// mask) so they merge cleanly with GTFS-derived entries.

const INTERVAL_URL = "https://www.mtr.com.hk/en/customer/services/train_service_index.html";

type LabelMapping = { company: Company; routeId: string };

const LABEL_TO_ROUTE: Record<string, LabelMapping | LabelMapping[]> = {
  "Island Line": { company: Company.MTR, routeId: "ISL" },
  "Tsuen Wan Line": { company: Company.MTR, routeId: "TWL" },
  "Tiu Keng Leng-Ho Man Tin": { company: Company.MTR, routeId: "KTL" },
  "North Point-Po Lam": { company: Company.MTR, routeId: "TKL" },
  "Tiu Keng Leng-LOHAS Park": { company: Company.MTR, routeId: "TKL-TKS" },
  "South Island Line": { company: Company.MTR, routeId: "SIL" },
  "Hong Kong-Tung Chung": { company: Company.MTR, routeId: "TCL" },
  "Disneyland Resort Line": { company: Company.MTR, routeId: "DRL" },
  "Tuen Ma Line": { company: Company.MTR, routeId: "TML" },
  "Admiralty-Lo Wu": { company: Company.MTR, routeId: "EAL" },
  "Admiralty-Lok Ma Chau": { company: Company.MTR, routeId: "EAL-LMC" },
  "Airport Express": { company: Company.MTR, routeId: "AEL" },
  "Route 505": { company: Company.LRT, routeId: "505" },
  "Route 507": { company: Company.LRT, routeId: "507" },
  "Route 610": { company: Company.LRT, routeId: "610" },
  "Route 614": { company: Company.LRT, routeId: "614" },
  "Route 614P": { company: Company.LRT, routeId: "614P" },
  "Route 615": { company: Company.LRT, routeId: "615" },
  "Route 615P": { company: Company.LRT, routeId: "615P" },
  "Route 705": { company: Company.LRT, routeId: "705" },
  "Route 706": { company: Company.LRT, routeId: "706" },
  "Route 751": { company: Company.LRT, routeId: "751" },
  "Route 761P": { company: Company.LRT, routeId: "761P" },
};

const WEEKDAY_CODE_WEEKDAY = "1111100";
const WEEKDAY_CODE_SATURDAY = "0000010";
const WEEKDAY_CODE_SUN_PH = "0000001";

const KEY_AM_PEAK = "AM-Peak";
const KEY_PM_PEAK = "PM-Peak";
const KEY_NON_PEAK = "Non-Peak";
const KEY_ALL_DAY = "All-Day";

const MTR_TYPE_WEEKDAY_AM_PEAK = "mtrWeekDayType1";
const MTR_TYPE_WEEKDAY_PM_PEAK = "mtrWeekDayType2";
const MTR_TYPE_WEEKDAY_NON_PEAK = "mtrWeekDayType3";
const MTR_TYPE_SATURDAY = "mtrWeekDayType4";
const MTR_TYPE_SUN_PH = "mtrWeekDayType5";

export type MtrIntervalValue = string;

// MTR-only intervals: keyed by `${company}-${routeId}` (no direction). Value
// is one entry per interval-page column (mtrWeekDayType1..5). Directions
// share intervals on the source page.
export type MtrIntervals = Record<string, Record<string, MtrIntervalValue>>;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseCell(raw: string): string | undefined {
  let v = stripHtml(raw);
  v = v.replace(/[#~^*]/g, "").trim();
  if (v === "" || v === "-") return undefined;
  return v;
}

function normaliseLabel(raw: string): string {
  return stripHtml(raw).replace(/[#~^*]/g, "").trim();
}

type ParsedRow = { label: string; cells: string[] };

function parseTable(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const trMatch of html.matchAll(trRe)) {
    const inner = trMatch[1] ?? "";
    const cells: string[] = [];
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    for (const tdMatch of inner.matchAll(tdRe)) cells.push(tdMatch[1] ?? "");
    if (cells.length !== 6) continue;
    const label = normaliseLabel(cells[0]!);
    rows.push({ label, cells: cells.slice(1) });
  }
  return rows;
}

function toMappings(mapping: LabelMapping | LabelMapping[]): LabelMapping[] {
  return Array.isArray(mapping) ? mapping : [mapping];
}

function lrtKeysFor(mapping: LabelMapping): string[] {
  return [
    `${mapping.company}-${mapping.routeId}-outbound-1`,
    `${mapping.company}-${mapping.routeId}-inbound-1`,
  ];
}

export type ParsedMtrIntervals = {
  mtr: MtrIntervals;
  lrt: Timetable;
};

export function parseMtrIntervals(html: string): ParsedMtrIntervals {
  const rows = parseTable(html);
  const mtr: MtrIntervals = {};
  const lrt: Timetable = {};
  const seenLabels = new Set<string>();
  const knownLabels = new Set(Object.keys(LABEL_TO_ROUTE));

  for (const row of rows) {
    const mapping = LABEL_TO_ROUTE[row.label];
    if (!mapping) continue;
    seenLabels.add(row.label);

    const [amRaw, pmRaw, nonRaw, satRaw, sunRaw] = row.cells;
    const am = normaliseCell(amRaw ?? "");
    const pm = normaliseCell(pmRaw ?? "");
    const non = normaliseCell(nonRaw ?? "");
    const sat = normaliseCell(satRaw ?? "");
    const sun = normaliseCell(sunRaw ?? "");

    for (const m of toMappings(mapping)) {
      if (m.company === Company.MTR) {
        const key = `${m.company}-${m.routeId}`;
        const entry: Record<string, string> = {};
        if (am !== undefined) entry[MTR_TYPE_WEEKDAY_AM_PEAK] = am;
        if (pm !== undefined) entry[MTR_TYPE_WEEKDAY_PM_PEAK] = pm;
        if (non !== undefined) entry[MTR_TYPE_WEEKDAY_NON_PEAK] = non;
        if (sat !== undefined) entry[MTR_TYPE_SATURDAY] = sat;
        if (sun !== undefined) entry[MTR_TYPE_SUN_PH] = sun;
        if (Object.keys(entry).length > 0) mtr[key] = entry;
        continue;
      }
      for (const key of lrtKeysFor(m)) {
        const schedule: Record<string, Record<string, string>> = {};
        const weekday: Record<string, string> = {};
        if (am !== undefined) weekday[KEY_AM_PEAK] = am;
        if (pm !== undefined) weekday[KEY_PM_PEAK] = pm;
        if (non !== undefined) weekday[KEY_NON_PEAK] = non;
        if (Object.keys(weekday).length > 0) schedule[WEEKDAY_CODE_WEEKDAY] = weekday;
        if (sat !== undefined) schedule[WEEKDAY_CODE_SATURDAY] = { [KEY_ALL_DAY]: sat };
        if (sun !== undefined) schedule[WEEKDAY_CODE_SUN_PH] = { [KEY_ALL_DAY]: sun };
        // LRT rows on the source page have no from/to columns — leave blank.
        lrt[key] = [{ from: "", to: "", schedule }];
      }
    }
  }

  const missing = [...knownLabels].filter((l) => !seenLabels.has(l));
  if (missing.length > 0) {
    console.warn(
      `[time_table] MTR interval page: expected labels not found: ${missing.join(", ")}`,
    );
  }

  return { mtr, lrt };
}

// Kept here (rather than in index.ts) so lrt/index.ts can share it — the
// interval page is a single HTML fetch that produces both MTR and LRT data.
export { INTERVAL_URL };

export function transformMtr(html: string): MtrIntervals {
  return parseMtrIntervals(html).mtr;
}
