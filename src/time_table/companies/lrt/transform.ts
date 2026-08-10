import { Company } from "../../../types/types.js";
import type { Schedule, Timetable } from "../../../types/types.js";

// LRT interval parser. Reads the LRT rows out of the MTR service-index HTML
// page (the same page MTR uses; each company fetches independently). MTR's
// parser lives in ../mtr/transform.ts and does not share code with this file.

export const INTERVAL_URL =
  "https://www.mtr.com.hk/en/customer/services/train_service_index.html";

type LrtRouteMapping = { routeId: string };

const LABEL_TO_LRT: Record<string, LrtRouteMapping> = {
  "Route 505": { routeId: "505" },
  "Route 507": { routeId: "507" },
  "Route 610": { routeId: "610" },
  "Route 614": { routeId: "614" },
  "Route 614P": { routeId: "614P" },
  "Route 615": { routeId: "615" },
  "Route 615P": { routeId: "615P" },
  "Route 705": { routeId: "705" },
  "Route 706": { routeId: "706" },
  "Route 751": { routeId: "751" },
  "Route 761P": { routeId: "761P" },
};

const WEEKDAY_CODE_WEEKDAY = "1111100";
const WEEKDAY_CODE_SATURDAY = "0000010";
const WEEKDAY_CODE_SUN_PH = "0000001";

const KEY_AM_PEAK = "AM-Peak";
const KEY_PM_PEAK = "PM-Peak";
const KEY_NON_PEAK = "Non-Peak";
const KEY_ALL_DAY = "All-Day";

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

function lrtKeysFor(routeId: string): string[] {
  return [
    `${Company.LRT}-${routeId}-outbound-1`,
    `${Company.LRT}-${routeId}-inbound-1`,
  ];
}

export function transformLrt(html: string): Timetable {
  const rows = parseTable(html);
  const lrt: Timetable = {};
  const seenLabels = new Set<string>();
  const knownLabels = new Set(Object.keys(LABEL_TO_LRT));

  for (const row of rows) {
    const mapping = LABEL_TO_LRT[row.label];
    if (!mapping) continue;
    seenLabels.add(row.label);

    const [amRaw, pmRaw, nonRaw, satRaw, sunRaw] = row.cells;
    const am = normaliseCell(amRaw ?? "");
    const pm = normaliseCell(pmRaw ?? "");
    const non = normaliseCell(nonRaw ?? "");
    const sat = normaliseCell(satRaw ?? "");
    const sun = normaliseCell(sunRaw ?? "");

    for (const key of lrtKeysFor(mapping.routeId)) {
      const schedule: Schedule = {};
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

  const missing = [...knownLabels].filter((l) => !seenLabels.has(l));
  if (missing.length > 0) {
    console.warn(
      `[time_table][lrt] interval page: expected labels not found: ${missing.join(", ")}`,
    );
  }

  return lrt;
}
