import { delay, fetchJson } from "../../../lib/http.js";
import { readJsonIfExists, writeJson } from "../../../lib/io.js";

const BASE = "https://search.kmb.hk/KMBWebSite/Function/FunctionRequest.ashx";

const THROTTLE_MS = 120;
const SAVE_EVERY = 25;

export type KmbScheduleEntry = {
  DayType: string;
  BoundTime1: string;
  BoundText1: string;
  BoundTime2: string;
  BoundText2: string;
  Origin_Chi: string;
  Destination_Chi: string;
  Origin_Eng?: string;
  Destination_Eng?: string;
  ServiceType: string;
  ServiceType_Chi?: string;
  ServiceType_Eng?: string;
  OrderSeq?: string;
  Route?: string;
};

export type KmbScheduleData = Record<string, KmbScheduleEntry[]>;

type KmbScheduleResponse = { data?: KmbScheduleData };

export type KmbBound = 1 | 2;

export async function fetchSchedule(route: string, bound: KmbBound): Promise<KmbScheduleData> {
  const url = `${BASE}?action=getschedule&route=${encodeURIComponent(route)}&bound=${bound}`;
  const r = await fetchJson<KmbScheduleResponse>(url);
  return r?.data ?? {};
}

// The API populates BoundText1/BoundTime1 with the queried direction's data
// when bound=1 and BoundText2/BoundTime2 when bound=2, but always emits both
// pairs. Only the pair matching the queried bound is authoritative; the other
// pair may hold stale or unrelated values. Blank the non-authoritative pair so
// downstream code can safely concatenate entries from both bounds.
function stripNonAuthoritativeFields(data: KmbScheduleData, bound: KmbBound): KmbScheduleData {
  const stripped: KmbScheduleData = {};
  for (const [key, entries] of Object.entries(data)) {
    stripped[key] = entries.map((e) =>
      bound === 1
        ? { ...e, BoundText2: "", BoundTime2: "" }
        : { ...e, BoundText1: "", BoundTime1: "" },
    );
  }
  return stripped;
}

function mergeSchedules(a: KmbScheduleData, b: KmbScheduleData): KmbScheduleData {
  const out: KmbScheduleData = { ...a };
  for (const [key, entries] of Object.entries(b)) {
    out[key] = out[key] ? [...out[key]!, ...entries] : entries;
  }
  return out;
}

export async function fetchAllSchedules(
  routes: string[],
  options: { cachePath?: string } = {},
): Promise<Map<string, KmbScheduleData>> {
  const { cachePath } = options;
  const cached: Record<string, KmbScheduleData> = cachePath
    ? ((await readJsonIfExists<Record<string, KmbScheduleData>>(cachePath)) ?? {})
    : {};

  const out = new Map<string, KmbScheduleData>(Object.entries(cached));
  const total = routes.length;
  let done = out.size;
  let sinceSave = 0;

  if (out.size > 0) {
    console.log(`[time_table][kmb] picked up ${out.size}/${total} schedules from cache`);
  }

  const persist = async (): Promise<void> => {
    if (!cachePath) return;
    const obj: Record<string, KmbScheduleData> = {};
    for (const [k, v] of out) obj[k] = v;
    await writeJson(cachePath, obj);
  };

  const BOUNDS: KmbBound[] = [1, 2];

  let wroteProgress = false;
  for (const route of routes) {
    if (out.has(route)) continue;
    let merged: KmbScheduleData = {};
    for (const bound of BOUNDS) {
      const data = await fetchSchedule(route, bound);
      merged = mergeSchedules(merged, stripNonAuthoritativeFields(data, bound));
      await delay(THROTTLE_MS);
    }
    out.set(route, merged);
    done++;
    sinceSave++;
    process.stdout.write(`\r[time_table][kmb] schedule progress ${done}/${total}`);
    wroteProgress = true;
    if (cachePath && sinceSave >= SAVE_EVERY) {
      await persist();
      sinceSave = 0;
    }
  }
  if (cachePath && sinceSave > 0) await persist();
  if (wroteProgress) process.stdout.write("\n");
  return out;
}
