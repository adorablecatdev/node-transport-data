import { fetchText } from "../../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../../lib/io.js";
import { Company } from "../../../types/types.js";

// MTR interval-page parser. Reads the MTR rows out of the service-index HTML
// page. LRT rows on the same page are parsed independently in
// ../lrt/transform.ts — the two do not share code.

export const INTERVAL_URL =
  "https://www.mtr.com.hk/en/customer/services/train_service_index.html";

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
};

const MTR_TYPE_WEEKDAY_AM_PEAK = "1111100AM";
const MTR_TYPE_WEEKDAY_PM_PEAK = "1111100PM";
const MTR_TYPE_WEEKDAY_NON_PEAK = "1111100";
const MTR_TYPE_SATURDAY = "0000010";
const MTR_TYPE_SUN_PH = "0000001";

export type MtrIntervalValue = string;

// MTR-only intervals: keyed by `${company}-${routeId}` (no direction). Value
// is one entry per interval-page column (mtrWeekDayType1..5). Directions
// share intervals on the source page.
export type MtrIntervals = Record<string, Record<string, MtrIntervalValue>>;

type IntervalCache = { html: string };

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

async function fetchIntervalHtml(options: { cachePath?: string } = {}): Promise<string> {
  const { cachePath } = options;
  if (cachePath) {
    const cached = await readJsonIfExists<IntervalCache>(cachePath);
    if (cached?.html) {
      console.log(`[time_table][mtr] picked up interval page from cache`);
      return cached.html;
    }
  }
  const html = await fetchText(INTERVAL_URL);
  if (cachePath) await writeJson(cachePath, { html } satisfies IntervalCache);
  return html;
}

export async function transformInterval(
  options: { cachePath?: string } = {},
): Promise<MtrIntervals> {
  const html = await fetchIntervalHtml({ cachePath: options.cachePath });
  const rows = parseTable(html);
  const mtr: MtrIntervals = {};
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
      const key = `${m.company}-${m.routeId}`;
      const entry: Record<string, string> = {};
      if (am !== undefined) entry[MTR_TYPE_WEEKDAY_AM_PEAK] = am;
      if (pm !== undefined) entry[MTR_TYPE_WEEKDAY_PM_PEAK] = pm;
      if (non !== undefined) entry[MTR_TYPE_WEEKDAY_NON_PEAK] = non;
      if (sat !== undefined) entry[MTR_TYPE_SATURDAY] = sat;
      if (sun !== undefined) entry[MTR_TYPE_SUN_PH] = sun;
      if (Object.keys(entry).length > 0) mtr[key] = entry;
    }
  }

  const missing = [...knownLabels].filter((l) => !seenLabels.has(l));
  if (missing.length > 0) {
    console.warn(
      `[time_table][mtr] interval page: expected labels not found: ${missing.join(", ")}`,
    );
  }

  return mtr;
}
