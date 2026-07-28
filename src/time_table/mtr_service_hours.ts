import { fetchText } from "../lib/http.js";
import { writeJson } from "../lib/io.js";
import { fetchLineStations, type MtrLineStation } from "../companies/mtr/api.js";

const SERVICE_HOURS_URL = "https://www.mtr.com.hk/en/customer/services/service_hours_search.php";

// Per-(station, route, destination station) first/last train times.
// Outer key: origin station code (e.g. "ADM").
// Second key: route/line code (e.g. "TWL", "KTL") — matches routes.json ids.
// Third key: destination station code shown in the "To" column (e.g. "HOM").
// Values: HH:MM. Overnight times like "01:10" are preserved verbatim.
export type FirstLastMap = Record<
  string,
  Record<string, Record<string, { first: string; last: string }>>
>;

// Line codes actually consumed off the service-hours page. The page has
// commented-out template leftovers for other lines that stripHtmlComments
// discards; LRT isn't on this page at all.
const LINE_CODES = new Set([
  "AEL",
  "TCL",
  "TWL",
  "ISL",
  "KTL",
  "TKL",
  "SIL",
  "TML",
  "EAL",
  "DRL",
]);

// HHMM → HH:MM. Preserves overnight values like "0104" → "01:04".
function formatTime(raw: string): string | undefined {
  const t = raw.trim();
  if (!/^\d{4}$/.test(t)) return undefined;
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

function stationIdToCode(rows: MtrLineStation[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.STATION_ID && r.STATION_CODE) map.set(r.STATION_ID, r.STATION_CODE);
  }
  return map;
}

type ParsedRow = { destStationId: string; first: string; last: string };
type ParsedSection = { lineCode: string; rows: ParsedRow[] };
type ParsedPage = { sections: ParsedSection[] };

// Strip HTML comments so commented-out template tables (WRL, TCL leftovers)
// aren't confused with the real data.
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

export function parseServiceHoursPage(html: string): ParsedPage {
  const cleaned = stripHtmlComments(html);

  const sections: ParsedSection[] = [];
  const sectionRe = /<h2\s+class="trainLine\s+([A-Z_]+)"[^>]*>[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/g;
  for (const m of cleaned.matchAll(sectionRe)) {
    const lineCode = m[1]!;
    if (!LINE_CODES.has(lineCode)) continue;
    const tableInner = m[2]!;
    const rows: ParsedRow[] = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
    for (const trMatch of tableInner.matchAll(trRe)) {
      const trInner = trMatch[1]!;
      if (/<th\b/i.test(trInner)) continue;
      const destMatch = trInner.match(/js_station_(\d+)(?:_[a-z0-9]+)?/i);
      const firstMatch = trInner.match(/class="firstTrain"[^>]*>\s*(\d{4})/);
      const lastMatches = [...trInner.matchAll(/<td\b[^>]*>\s*(\d{4})\s*<\/td>/g)];
      if (!destMatch || !firstMatch || lastMatches.length < 1) continue;
      const first = formatTime(firstMatch[1]!);
      const lastTd = lastMatches[lastMatches.length - 1]!;
      const last = formatTime(lastTd[1]!);
      if (!first || !last) continue;
      rows.push({ destStationId: destMatch[1]!, first, last });
    }
    if (rows.length > 0) sections.push({ lineCode, rows });
  }

  return { sections };
}

async function fetchStationPage(stationId: string): Promise<string> {
  const url = `${SERVICE_HOURS_URL}?query_type=search&station=${encodeURIComponent(stationId)}`;
  return fetchText(url);
}

export async function fetchMtrFirstLastTrain(): Promise<FirstLastMap> {
  console.log("[time_table] fetching MTR service-hours pages (per station)");
  const rows = await fetchLineStations();
  const idToCode = stationIdToCode(rows);
  const stationIds = [...idToCode.keys()].sort((a, b) => Number(a) - Number(b));

  const firstLast: FirstLastMap = {};

  let fetched = 0;
  let skipped = 0;
  let unresolvedDest = 0;

  for (const stationId of stationIds) {
    const stationCode = idToCode.get(stationId)!;
    let html: string;
    try {
      html = await fetchStationPage(stationId);
    } catch (err) {
      skipped++;
      console.warn(`[time_table] failed to fetch station=${stationId} (${stationCode}): ${(err as Error).message}`);
      continue;
    }
    fetched++;
    const parsed = parseServiceHoursPage(html);

    for (const section of parsed.sections) {
      for (const row of section.rows) {
        const destCode = idToCode.get(row.destStationId);
        if (!destCode) {
          unresolvedDest++;
          continue;
        }
        const byRoute = (firstLast[stationCode] ||= {});
        const byDest = (byRoute[section.lineCode] ||= {});
        byDest[destCode] = { first: row.first, last: row.last };
      }
    }
  }

  console.log(
    `[time_table] MTR first/last train: fetched ${fetched} stations (${skipped} skipped), ` +
      `${Object.keys(firstLast).length} origin stations`,
  );
  if (unresolvedDest > 0) {
    console.warn(`[time_table] MTR first/last train: ${unresolvedDest} rows dropped (unresolved destination station code)`);
  }

  return firstLast;
}

export async function writeMtrFirstLastTrain(outPath: string): Promise<void> {
  const data = await fetchMtrFirstLastTrain();
  await writeJson(outPath, data);
  console.log(`[time_table] wrote MTR first/last train to ${outPath}`);
}
