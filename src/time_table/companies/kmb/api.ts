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

export async function fetchSchedule(route: string): Promise<KmbScheduleData> {
  const url = `${BASE}?action=getschedule&route=${encodeURIComponent(route)}&bound=1`;
  const r = await fetchJson<KmbScheduleResponse>(url);
  return r?.data ?? {};
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
    console.log(`[kmb][schedule] picked up ${out.size}/${total} from cache`);
  }

  const persist = async (): Promise<void> => {
    if (!cachePath) return;
    const obj: Record<string, KmbScheduleData> = {};
    for (const [k, v] of out) obj[k] = v;
    await writeJson(cachePath, obj);
  };

  for (const route of routes) {
    if (out.has(route)) continue;
    const data = await fetchSchedule(route);
    out.set(route, data);
    done++;
    sinceSave++;
    process.stdout.write(`\r[kmb][schedule] progress ${done}/${total}`);
    if (cachePath && sinceSave >= SAVE_EVERY) {
      await persist();
      sinceSave = 0;
    }
    await delay(THROTTLE_MS);
  }
  if (cachePath && sinceSave > 0) await persist();
  process.stdout.write("\n");
  return out;
}
