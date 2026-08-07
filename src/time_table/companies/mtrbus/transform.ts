import type { ParsedGtfs, Timetable } from "../../types.js";

// MTR Bus (feeder) slice of the shared GTFS feed. Owns:
// - agency_id filter: LRTFeeder
export function transformMtrBus(_gtfs: ParsedGtfs): Timetable {
  // TODO: implement MTRB-specific parsing
  return {};
}
