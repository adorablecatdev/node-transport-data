import type { Schedule, Timetable, TimetableVariant } from "../../../types/types.js";
import type { GmbRouteInfoWithHeadways } from "./api.js";

// One entry from routes.json — the fields we actually read here.
export type GmbRouteRecord = {
  record_id: string;
  company: string;
  route_id: string;
  route: string;
  route_seq: number;
  region: "HKI" | "KLN" | "NT";
  origin: { en: string; tc: string; sc: string };
  destination: { en: string; tc: string; sc: string };
};

// weekdays from the API is Mon..Sun (7 booleans). Convert to the "1111100"
// string form used by all other companies' Schedule keys.
function weekdayCode(weekdays: boolean[]): string {
  return weekdays.map((b) => (b ? "1" : "0")).join("");
}

function windowKey(start: string, end: string): string {
  return `${start.slice(0, 5)}-${end.slice(0, 5)}`;
}

export function transformGmb(
  routes: Record<string, GmbRouteRecord>,
  routeInfosByKey: Map<string, GmbRouteInfoWithHeadways[]>,
): Timetable {
  const result: Timetable = {};

  for (const [key, record] of Object.entries(routes)) {
    const infos = routeInfosByKey.get(`${record.region}:${record.route}`);
    if (!infos) continue;

    const variants: TimetableVariant[] = [];
    for (const info of infos) {
      if (String(info.route_id) !== record.route_id) continue;
      const dir = info.directions.find((d) => d.route_seq === record.route_seq);
      if (!dir || dir.headways.length === 0) continue;

      const schedule: Schedule = {};
      for (const h of dir.headways) {
        if (typeof h.frequency !== "number") continue;
        const wd = weekdayCode(h.weekdays);
        const wk = windowKey(h.start_time, h.end_time);
        const value =
          typeof h.frequency_upper === "number" && h.frequency_upper !== h.frequency
            ? `${h.frequency}-${h.frequency_upper}`
            : String(h.frequency);
        (schedule[wd] ||= {})[wk] = value;
      }

      // Sort each weekday's windows chronologically for stable output.
      for (const wd of Object.keys(schedule)) {
        const byTime = schedule[wd]!;
        const sorted: Record<string, number | string | null> = {};
        for (const t of Object.keys(byTime).sort()) sorted[t] = byTime[t]!;
        schedule[wd] = sorted;
      }

      variants.push({
        from: record.origin.tc,
        to: record.destination.tc,
        schedule,
      });
    }

    if (variants.length > 0) result[key] = variants;
  }

  return result;
}
