import { Company } from "../../../types.js";
import type { ParsedGtfs, Timetable } from "../../types.js";

// GMB slice of the shared GTFS feed. Owns:
// - agency_id filter: GMB
// - per-route region resolution (HKI/KLN/NT) via regionMap, since the feed
//   doesn't split GMB into the three project companies
export function transformGmb(
  _gtfs: ParsedGtfs,
  _regionMap: Map<string, Company>,
): Timetable {
  // TODO: implement GMB-specific parsing
  return {};
}
