import { fetchText } from "../../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../../lib/io.js";
import type { Schedule } from "../../../types.js";

// MTR interval-page parser. Reads the MTR rows out of the service-index HTML
// page. LRT rows on the same page are parsed independently in
// ../lrt/transform.ts — the two do not share code.

export const INTERVAL_URL =
  "https://www.mtr.com.hk/en/customer/services/train_service_index.html";

// Key: MTR route id (e.g. "ISL", "TKL-TKS"). Same shape as LrtIntervalMap so
// both companies expose intervals identically.
export type MtrIntervalMap = Record<string, Schedule>;

type LabelMapping = { routeId: string };

const LABEL_TO_ROUTE: Record<string, LabelMapping | LabelMapping[]> = {
  "Island Line": { routeId: "ISL" },
  "Tsuen Wan Line": { routeId: "TWL" },
  "Tiu Keng Leng-Ho Man Tin": { routeId: "KTL" },
  "North Point-Po Lam": { routeId: "TKL" },
  "Tiu Keng Leng-LOHAS Park": { routeId: "TKL-TKS" },
  "South Island Line": { routeId: "SIL" },
  "Hong Kong-Tung Chung": { routeId: "TCL" },
  "Disneyland Resort Line": { routeId: "DRL" },
  "Tuen Ma Line": { routeId: "TML" },
  "Admiralty-Lo Wu": { routeId: "EAL" },
  "Admiralty-Lok Ma Chau": { routeId: "EAL-LMC" },
  "Airport Express": { routeId: "AEL" },
};

const WEEKDAY_CODE_WEEKDAY = "1111100";
const WEEKDAY_CODE_SATURDAY = "0000010";
const WEEKDAY_CODE_SUN_PH = "0000001";

const KEY_AM_PEAK = "AM-Peak";
const KEY_PM_PEAK = "PM-Peak";
const KEY_NON_PEAK = "Non-Peak";
const KEY_ALL_DAY = "All-Day";

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
): Promise<MtrIntervalMap> {
  const html = await fetchIntervalHtml({ cachePath: options.cachePath });
  const rows = parseTable(html);
  const mtr: MtrIntervalMap = {};
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
      const schedule: Schedule = {};
      const weekday: Record<string, string> = {};
      if (am !== undefined) weekday[KEY_AM_PEAK] = am;
      if (pm !== undefined) weekday[KEY_PM_PEAK] = pm;
      if (non !== undefined) weekday[KEY_NON_PEAK] = non;
      if (Object.keys(weekday).length > 0) schedule[WEEKDAY_CODE_WEEKDAY] = weekday;
      if (sat !== undefined) schedule[WEEKDAY_CODE_SATURDAY] = { [KEY_ALL_DAY]: sat };
      if (sun !== undefined) schedule[WEEKDAY_CODE_SUN_PH] = { [KEY_ALL_DAY]: sun };
      if (Object.keys(schedule).length > 0) mtr[m.routeId] = schedule;
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
