import { fetchText } from "../../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../../lib/io.js";
import { fetchRouteStops, type LrtRouteStop } from "../../../companies/lrt/api.js";

const SERVICE_HOURS_URL =
  "https://www.mtr.com.hk/en/customer/services/schedule_index.html";

// Per-(route, stop, destination stop) first/last train times.
// Outer key: route id (e.g. "505", "614P") — matches LRT interval route ids.
// Second key: origin stop code (e.g. "SIL").
// Third key: destination stop code shown in the "To" header (e.g. "SHL"), or
// "circular" for circular routes (705, 706) which have no direction.
// Values: HH:MM. Overnight times like "01:10" are preserved verbatim.
export type FirstLastMap = Record<
  string,
  Record<string, Record<string, { first: string; last: string }>>
>;

type ServiceHoursCache = { html: string };

// Route ids that appear on the LRT schedule page. Kept aligned with the
// interval parser's LABEL_TO_LRT mapping so both cover the same set.
const KNOWN_ROUTES = new Set([
  "505",
  "507",
  "610",
  "614",
  "614P",
  "615",
  "615P",
  "705",
  "706",
  "751",
  "761P",
]);

const CIRCULAR_DEST_KEY = "circular";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

// Cell may be "-" for terminal stops that don't serve a given direction.
function normaliseTime(raw: string): string | undefined {
  const t = raw.trim();
  if (t === "" || t === "-") return undefined;
  if (!/^\d{1,2}:\d{2}$/.test(t)) return undefined;
  const [h, m] = t.split(":");
  return `${h!.padStart(2, "0")}:${m}`;
}

function stopNameToCode(rows: LrtRouteStop[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.STOP_NAME_ENG || !r.STOP_CODE) continue;
    map.set(normaliseName(r.STOP_NAME_ENG), r.STOP_CODE);
  }
  return map;
}

type ParsedRow = {
  stopName: string;
  first: (string | undefined)[];
  last: (string | undefined)[];
};

type ParsedBox = {
  routeId: string;
  destinations: string[];
  rows: ParsedRow[];
};

export function parseServiceHoursPage(html: string): ParsedBox[] {
  const boxes: ParsedBox[] = [];
  const boxRe =
    /<a\s+class="list_btn"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/g;

  for (const m of html.matchAll(boxRe)) {
    const routeId = m[1]!.trim();
    if (!KNOWN_ROUTES.has(routeId)) continue;
    const tableInner = m[2]!;

    const destinations: string[] = [];
    const destRe = /<span class="sdleHead">\s*To\s+([^<]+?)\s*<\/span>/g;
    for (const d of tableInner.matchAll(destRe)) {
      const name = normaliseName(d[1]!);
      if (!destinations.includes(name)) destinations.push(name);
    }

    const rows: ParsedRow[] = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
    for (const trMatch of tableInner.matchAll(trRe)) {
      const trInner = trMatch[1]!;
      if (/<th\b/i.test(trInner)) continue;
      const tds: string[] = [];
      const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/g;
      for (const tdMatch of trInner.matchAll(tdRe)) {
        tds.push(stripHtml(tdMatch[1]!));
      }

      if (tds.length === 5) {
        rows.push({
          stopName: normaliseName(tds[0]!),
          first: [normaliseTime(tds[1]!), normaliseTime(tds[2]!)],
          last: [normaliseTime(tds[3]!), normaliseTime(tds[4]!)],
        });
      } else if (tds.length === 3) {
        rows.push({
          stopName: normaliseName(tds[0]!),
          first: [normaliseTime(tds[1]!)],
          last: [normaliseTime(tds[2]!)],
        });
      }
    }

    boxes.push({ routeId, destinations, rows });
  }

  return boxes;
}

async function fetchScheduleHtml(cachePath?: string): Promise<string> {
  if (cachePath) {
    const cached = await readJsonIfExists<ServiceHoursCache>(cachePath);
    if (cached?.html) {
      console.log(`[time_table][lrt] picked up service-hours page from cache`);
      return cached.html;
    }
  }
  const html = await fetchText(SERVICE_HOURS_URL);
  if (cachePath) await writeJson(cachePath, { html } satisfies ServiceHoursCache);
  return html;
}

export async function transformFirstLastTrain(
  options: { cachePath?: string } = {},
): Promise<FirstLastMap> {
  const html = await fetchScheduleHtml(options.cachePath);
  const stops = await fetchRouteStops();
  const nameToCode = stopNameToCode(stops);
  const boxes = parseServiceHoursPage(html);

  const firstLast: FirstLastMap = {};
  const unresolvedStops = new Set<string>();
  const unresolvedDests = new Set<string>();
  const missingRoutes = new Set(KNOWN_ROUTES);

  for (const box of boxes) {
    missingRoutes.delete(box.routeId);
    const isCircular = box.destinations.length === 0;
    const destCodes = box.destinations.map((name) => {
      const code = nameToCode.get(name);
      if (!code) unresolvedDests.add(`${box.routeId}→${name}`);
      return code;
    });

    const byStop = (firstLast[box.routeId] ||= {});

    for (const row of box.rows) {
      const stopCode = nameToCode.get(row.stopName);
      if (!stopCode) {
        unresolvedStops.add(row.stopName);
        continue;
      }
      const byDest = (byStop[stopCode] ||= {});

      if (isCircular) {
        const first = row.first[0];
        const last = row.last[0];
        if (first && last) byDest[CIRCULAR_DEST_KEY] = { first, last };
        continue;
      }

      for (let i = 0; i < box.destinations.length; i++) {
        const destCode = destCodes[i];
        const first = row.first[i];
        const last = row.last[i];
        if (!destCode || !first || !last) continue;
        byDest[destCode] = { first, last };
      }
    }
  }

  if (missingRoutes.size > 0) {
    console.warn(
      `[time_table][lrt] service-hours page: expected routes not found: ${[...missingRoutes].join(", ")}`,
    );
  }
  if (unresolvedStops.size > 0) {
    console.warn(
      `[time_table][lrt] first/last train: unresolved stop names: ${[...unresolvedStops].join(", ")}`,
    );
  }
  if (unresolvedDests.size > 0) {
    console.warn(
      `[time_table][lrt] first/last train: unresolved destinations: ${[...unresolvedDests].join(", ")}`,
    );
  }

  return firstLast;
}
