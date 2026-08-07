import type { ParsedGtfs, Timetable } from "../../types.js";

// KMBCTB (joint routes) slice of the shared GTFS feed. Owns:
// - agency_id filter: KMB+CTB, LWB+CTB
// - joint-route merge rule (both agencies collapse into a single company key)
export function transformKmbCtb(_gtfs: ParsedGtfs): Timetable {
  // TODO: implement KMBCTB-specific parsing
  return {};
}
