import { delay, fetchJson } from "../../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../../lib/io.js";

const BASE = "https://data.etagmb.gov.hk";
const THROTTLE_MS = 120;
const SAVE_EVERY = 25;

export type GmbRegion = "HKI" | "KLN" | "NT";

type Envelope<T> = {
  type: string;
  version: string;
  generated_timestamp: string;
  data: T;
};

export type GmbHeadway = {
  weekdays: boolean[];
  public_holiday: boolean;
  headway_seq: number;
  start_time: string;
  end_time: string;
  frequency: number | null;
  frequency_upper: number | null;
};

export type GmbDirectionWithHeadways = {
  route_seq: number;
  orig_tc: string;
  dest_tc: string;
  headways: GmbHeadway[];
};

export type GmbRouteInfoWithHeadways = {
  route_id: number;
  region: string;
  route_code: string;
  directions: GmbDirectionWithHeadways[];
};

// Fetch all variants for a (region, route_code). Same endpoint the scraper
// hits, but we care about directions[].headways rather than stop lists.
async function fetchRouteInfos(
  region: GmbRegion,
  routeCode: string,
): Promise<GmbRouteInfoWithHeadways[]> {
  const r = await fetchJson<Envelope<GmbRouteInfoWithHeadways[]>>(
    `${BASE}/route/${region}/${encodeURIComponent(routeCode)}`,
  );
  return r.data ?? [];
}

type RouteInfosCache = { byKey: Record<string, GmbRouteInfoWithHeadways[]> };

// Fetch route infos for every (region, route_code) pair. Cache is keyed by
// "REGION:ROUTECODE" so all three GMB regions share one file safely.
export async function fetchAllRouteInfos(
  tasks: Array<{ region: GmbRegion; route_code: string }>,
  options: { cachePath?: string; logTag?: string } = {},
): Promise<Map<string, GmbRouteInfoWithHeadways[]>> {
  const { cachePath, logTag = "gmb" } = options;
  const cached: RouteInfosCache = cachePath
    ? ((await readJsonIfExists<RouteInfosCache>(cachePath)) ?? { byKey: {} })
    : { byKey: {} };

  const out = new Map<string, GmbRouteInfoWithHeadways[]>(Object.entries(cached.byKey));
  const total = tasks.length;
  let done = 0;
  for (const t of tasks) if (out.has(`${t.region}:${t.route_code}`)) done++;
  let sinceSave = 0;

  const persist = async (): Promise<void> => {
    if (!cachePath) return;
    const byKey: Record<string, GmbRouteInfoWithHeadways[]> = {};
    for (const [k, v] of out) byKey[k] = v;
    await writeJson(cachePath, { byKey } satisfies RouteInfosCache);
  };

  if (done > 0) console.log(`[time_table][${logTag}] picked up ${done}/${total} route infos from cache`);

  let wroteProgress = false;
  for (const t of tasks) {
    const key = `${t.region}:${t.route_code}`;
    if (out.has(key)) continue;
    const infos = await fetchRouteInfos(t.region, t.route_code);
    out.set(key, infos);
    done++;
    sinceSave++;
    process.stdout.write(`\r[time_table][${logTag}] route info progress ${done}/${total}`);
    wroteProgress = true;
    if (cachePath && sinceSave >= SAVE_EVERY) {
      await persist();
      sinceSave = 0;
    }
    await delay(THROTTLE_MS);
  }
  if (cachePath && sinceSave > 0) await persist();
  if (wroteProgress) process.stdout.write("\n");
  return out;
}
