import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

type NominatimResponse = {
  address?: {
    suburb?: string;
    [key: string]: string | undefined;
  };
};

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const SUBURBS_CACHE_PATH = path.resolve("data/hk-suburbs.geojson");

export async function reverseGeocode(
  lat: number,
  lng: number,
  zoom: number = 18,
  language: string = "tc",
): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "json",
    zoom: String(zoom),
    addressdetails: "1",
    "accept-language": language,
  });

  const url = `${NOMINATIM_ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "node-transport-data/0.1 (district lookup)",
    },
  });
  if (!res.ok) {
    throw new Error(`Nominatim ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as NominatimResponse;
  const suburb = data.address?.suburb;
  return cleanSuburb(suburb, language);
}

function cleanSuburb(suburb: string | undefined, language: string): string | null {
  if (!suburb) return null;
  const cleaned = language === "en" ? suburb : suburb.replace(/[A-Za-z]/g, "");
  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type LngLat = [number, number];
type Ring = LngLat[];

type PointFeature = {
  type: "Feature";
  properties: { name: string; nameEn?: string; nameZh?: string; place: string };
  geometry: { type: "Point"; coordinates: LngLat };
};
type PolygonFeature = {
  type: "Feature";
  properties: { name: string; nameEn?: string; nameZh?: string; place: string };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
};
export type SuburbFeature = PointFeature | PolygonFeature;
export type SuburbCollection = {
  type: "FeatureCollection";
  features: SuburbFeature[];
};

type OverpassCoord = { lat: number; lon: number };
type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: OverpassCoord[];
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: OverpassCoord[];
  }>;
  tags?: Record<string, string>;
};

async function overpassQuery(query: string, requestTimeoutMs = 120_000): Promise<{ elements: OverpassElement[] }> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    console.error(`  -> trying ${endpoint}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "node-transport-data/0.1 (district lookup)",
          },
          body: "data=" + encodeURIComponent(query),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
          const backoff = 3000 * (attempt + 1);
          console.error(`     ${res.status} at ${endpoint} (attempt ${attempt + 1}/2), waiting ${backoff}ms...`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
        return (await res.json()) as { elements: OverpassElement[] };
      } catch (e) {
        clearTimeout(timer);
        lastError = e;
        console.error(`     failed: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${(lastError as Error)?.message}`);
}

export async function fetchSuburbBoundaries(cachePath: string = SUBURBS_CACHE_PATH): Promise<SuburbCollection> {
  const placeFilter = '["place"~"^(suburb|neighbourhood|quarter|town|village)$"]';
  const buildQuery = (kind: "node" | "way" | "relation") => `
    [out:json][timeout:90];
    area["ISO3166-1"="HK"]->.hk;
    ${kind}${placeFilter}(area.hk);
    out geom;
  `.trim();

  console.error("Fetching suburb nodes...");
  const nodesData = await overpassQuery(buildQuery("node"));
  console.error(`  ${nodesData.elements.length} nodes`);
  console.error("Fetching suburb ways...");
  const waysData = await overpassQuery(buildQuery("way"));
  console.error(`  ${waysData.elements.length} ways`);
  console.error("Fetching suburb relations...");
  let relationElements: OverpassElement[] = [];
  try {
    const relationsData = await overpassQuery(buildQuery("relation"));
    relationElements = relationsData.elements;
    console.error(`  ${relationElements.length} relations`);
  } catch (e) {
    console.error(`  relations skipped: ${(e as Error).message}`);
  }
  const data = { elements: [...nodesData.elements, ...waysData.elements, ...relationElements] };

  const features: SuburbFeature[] = [];
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const nameZh = tags["name:zh"] ?? tags["name:zh-Hant"] ?? tags["name:zh-HK"];
    const nameEn = tags["name:en"];
    const name = nameZh ?? nameEn ?? tags.name;
    const place = tags.place;
    if (!name || !place) continue;
    const props = { name, nameEn, nameZh, place };

    if (el.type === "node" && el.lat != null && el.lon != null) {
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Point", coordinates: [el.lon, el.lat] },
      });
    } else if (el.type === "way" && el.geometry && el.geometry.length >= 3) {
      const ring = el.geometry.map((p) => [p.lon, p.lat] as LngLat);
      if (isClosed(ring)) {
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "Polygon", coordinates: [ring] },
        });
      }
    } else if (el.type === "relation" && el.members) {
      const outers = el.members
        .filter((m) => m.role === "outer" && m.geometry && m.geometry.length >= 2)
        .map((m) => m.geometry!.map((p) => [p.lon, p.lat] as LngLat));
      const rings = stitchRings(outers);
      if (rings.length === 1) {
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "Polygon", coordinates: [rings[0]!] },
        });
      } else if (rings.length > 1) {
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r]) },
        });
      }
    }
  }

  const fc: SuburbCollection = { type: "FeatureCollection", features };
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(fc), "utf-8");
  console.error(`Cached ${features.length} suburb features -> ${cachePath}`);
  return fc;
}

export async function loadSuburbBoundaries(cachePath: string = SUBURBS_CACHE_PATH): Promise<SuburbCollection> {
  if (existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, "utf-8")) as SuburbCollection;
  }
  console.error("Fetching HK suburb boundaries from Overpass API (one-time)...");
  return fetchSuburbBoundaries(cachePath);
}

export function findSuburbLocal(
  lat: number,
  lng: number,
  fc: SuburbCollection,
  language: string = "tc",
): string | null {
  for (const f of fc.features) {
    if (f.geometry.type === "Polygon") {
      if (pointInPolygon(lng, lat, f.geometry.coordinates)) {
        return cleanSuburb(pickName(f.properties, language), language);
      }
    } else if (f.geometry.type === "MultiPolygon") {
      for (const poly of f.geometry.coordinates) {
        if (pointInPolygon(lng, lat, poly)) {
          return cleanSuburb(pickName(f.properties, language), language);
        }
      }
    }
  }
  let bestName: string | null = null;
  let bestD = Infinity;
  for (const f of fc.features) {
    if (f.geometry.type !== "Point") continue;
    const [lon, la] = f.geometry.coordinates;
    const d = haversineMeters(lat, lng, la, lon);
    if (d < bestD) {
      bestD = d;
      bestName = pickName(f.properties, language);
    }
  }
  return cleanSuburb(bestName ?? undefined, language);
}

function pickName(
  props: { name: string; nameEn?: string; nameZh?: string },
  language: string,
): string {
  if (language === "en") return props.nameEn ?? props.name;
  return props.nameZh ?? props.name;
}

function isClosed(ring: LngLat[]): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return !!first && !!last && first[0] === last[0] && first[1] === last[1];
}

function stitchRings(ways: LngLat[][]): LngLat[][] {
  const rings: LngLat[][] = [];
  const remaining = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const key = (p: LngLat): string => `${p[0]},${p[1]}`;

  while (remaining.length > 0) {
    let current = remaining.shift()!;
    let progressed = true;
    while (progressed && !isClosed(current)) {
      progressed = false;
      const tail = current[current.length - 1]!;
      const head = current[0]!;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i]!;
        const wHead = w[0]!;
        const wTail = w[w.length - 1]!;
        if (key(tail) === key(wHead)) {
          current = current.concat(w.slice(1));
          remaining.splice(i, 1);
          progressed = true;
          break;
        }
        if (key(tail) === key(wTail)) {
          current = current.concat([...w].reverse().slice(1));
          remaining.splice(i, 1);
          progressed = true;
          break;
        }
        if (key(head) === key(wTail)) {
          current = w.concat(current.slice(1));
          remaining.splice(i, 1);
          progressed = true;
          break;
        }
        if (key(head) === key(wHead)) {
          current = [...w].reverse().concat(current.slice(1));
          remaining.splice(i, 1);
          progressed = true;
          break;
        }
      }
    }
    if (isClosed(current) && current.length >= 4) rings.push(current);
  }
  return rings;
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, polygon: Ring[]): boolean {
  if (polygon.length === 0) return false;
  const outer = polygon[0]!;
  if (!pointInRing(lng, lat, outer)) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i]!)) return false;
  }
  return true;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const a = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseArgs(argv: string[]): {
  lat: number;
  lng: number;
  zoom?: number;
  language?: string;
  local: boolean;
  refresh: boolean;
} | null {
  let lat: number | null = null;
  let lng: number | null = null;
  let zoom: number | undefined;
  let language: string | undefined;
  let local = false;
  let refresh = false;

  const positional: number[] = [];
  for (const arg of argv) {
    if (arg === "--local") { local = true; continue; }
    if (arg === "--refresh") { refresh = true; continue; }
    const pair = arg.match(/^--?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (pair && pair[1] && pair[2]) {
      lat = Number(pair[1]);
      lng = Number(pair[2]);
      continue;
    }
    const kv = arg.match(/^--([a-zA-Z-]+)=(.+)$/);
    if (kv && kv[1] && kv[2] !== undefined) {
      const key = kv[1].toLowerCase();
      const val = kv[2];
      if (key === "lat") lat = Number(val);
      else if (key === "lng" || key === "lon") lng = Number(val);
      else if (key === "zoom") zoom = Number(val);
      else if (key === "language" || key === "lang" || key === "accept-language") language = val;
      continue;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(arg)) {
      positional.push(Number(arg));
    }
  }

  if ((lat === null || lng === null) && positional.length >= 2) {
    lat = positional[0] ?? null;
    lng = positional[1] ?? null;
  }

  if (refresh && lat === null && lng === null) {
    return { lat: 0, lng: 0, zoom, language, local, refresh };
  }

  return lat !== null && lng !== null ? { lat, lng, zoom, language, local, refresh } : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (!args) {
    console.error("Usage:");
    console.error("  npx tsx src/district.ts <lat> <lng> [--zoom=18] [--language=tc]");
    console.error("  npx tsx src/district.ts <lat> <lng> --local        # local lookup via cached OSM boundaries");
    console.error("  npx tsx src/district.ts --refresh                  # (re)fetch OSM suburb data cache");
    process.exit(1);
  }

  const { lat, lng, zoom, language, local, refresh } = args;

  if (refresh) {
    await fetchSuburbBoundaries();
    if (!local) return;
  }

  if (local) {
    const fc = await loadSuburbBoundaries();
    const result = findSuburbLocal(lat, lng, fc, language ?? "tc");
    console.log(result ?? "");
    return;
  }

  const result = await reverseGeocode(lat, lng, zoom, language);
  console.log(result ?? "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
