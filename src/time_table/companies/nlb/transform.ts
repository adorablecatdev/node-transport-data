import type { ParsedGtfs, Timetable } from "../../types.js";

// NLB slice of the shared GTFS feed. Owns:
// - agency_id filter: NLB
// - any NLB-specific quirks (weekend-only routes, seasonal service, etc.)
export function transformNlb(_gtfs: ParsedGtfs): Timetable {
  // TODO: implement NLB-specific parsing
  return {};
}
