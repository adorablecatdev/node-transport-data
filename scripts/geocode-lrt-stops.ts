import fs from "node:fs";
import path from "node:path";
import { fetchText } from "../src/lib/http.js";
import { fetchRouteStops } from "../src/companies/lightrail/api.js";

const STATIC_TS = path.join("src", "companies", "lightrail", "static.ts");
const CACHE_FILE = path.join("tmp", "lrt-coords.json");
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

const HK_VIEWBOX = "113.83,22.55,114.42,22.15";
const HK_BOUNDS = { minLat: 22.15, maxLat: 22.55, minLon: 113.83, maxLon: 114.42 };

type Coord = { lat: string; long: string };
type Cache = Record<string, Coord>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCache(): Cache {
  if (!fs.existsSync(CACHE_FILE)) return {};
  return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as Cache;
}

function saveCache(cache: Cache): void {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function inHK(lat: string, lon: string): boolean {
  const la = Number(lat);
  const lo = Number(lon);
  return (
    la >= HK_BOUNDS.minLat &&
    la <= HK_BOUNDS.maxLat &&
    lo >= HK_BOUNDS.minLon &&
    lo <= HK_BOUNDS.maxLon
  );
}

async function geocode(query: string): Promise<Coord | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5&viewbox=${HK_VIEWBOX}&bounded=1`;
  const text = await fetchText(url);
  const arr = JSON.parse(text) as Array<{ lat: string; lon: string }>;
  const hit = arr.find((r) => inHK(r.lat, r.lon));
  return hit ? { lat: hit.lat, long: hit.lon } : null;
}

function buildQueries(tc: string, en: string): string[] {
  const cleanedTc = tc.replace(/[()（）].*/, "");
  return [
    `${cleanedTc}輕鐵站`,
    `輕鐵${cleanedTc}站`,
    `Light Rail ${en} Stop`,
    `${en} Light Rail Stop`,
    `${en} Stop, Hong Kong`,
  ];
}

function renderStaticTs(coords: Record<string, Coord>): string {
  const codes = Object.keys(coords).sort();
  const lines = codes.map((c) => {
    const { lat, long } = coords[c]!;
    return `  ${c}: { lat: ${JSON.stringify(lat)}, long: ${JSON.stringify(long)} },`;
  });
  return `export const STOP_LOCATION: Record<string, { lat: string; long: string }> = {\n${lines.join("\n")}\n};\n`;
}

async function main(): Promise<void> {
  const rows = await fetchRouteStops();
  const stops = new Map<string, { tc: string; en: string }>();
  for (const r of rows) {
    if (!r.STOP_CODE || stops.has(r.STOP_CODE)) continue;
    stops.set(r.STOP_CODE, { tc: r.STOP_NAME_CHI, en: r.STOP_NAME_ENG });
  }
  console.log(`[geocode] ${stops.size} unique stops`);

  const cache = loadCache();

  // Purge any cached entries that are outside HK (from earlier unbounded runs).
  for (const [code, coord] of Object.entries(cache)) {
    if (!inHK(coord.lat, coord.long)) {
      console.log(`[geocode] purging out-of-HK cache: ${code} (${coord.lat}, ${coord.long})`);
      delete cache[code];
    }
  }
  saveCache(cache);

  const missing: string[] = [];

  for (const [code, { tc, en }] of stops) {
    if (cache[code]) continue;
    let hit: Coord | null = null;
    for (const q of buildQueries(tc, en)) {
      console.log(`[geocode] ${code}: "${q}"`);
      hit = await geocode(q);
      await sleep(1100);
      if (hit) break;
    }
    if (hit) {
      cache[code] = hit;
      saveCache(cache);
      console.log(`  -> ${hit.lat}, ${hit.long}`);
    } else {
      missing.push(code);
      console.log(`  -> MISS`);
    }
  }

  const filled: Record<string, Coord> = {};
  for (const code of stops.keys()) {
    filled[code] = cache[code] ?? { lat: "", long: "" };
  }
  fs.writeFileSync(STATIC_TS, renderStaticTs(filled));
  console.log(`[geocode] wrote ${STATIC_TS}`);
  if (missing.length) {
    console.log(`[geocode] MISSING (${missing.length}): ${missing.join(", ")}`);
    console.log(`[geocode] fill these manually in ${STATIC_TS}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
