import type { Timetable } from "../../types.js";
import { parseMtrIntervals } from "../mtr/transform.js";

// LRT intervals come from the same MTR service-index HTML page as MTR
// intervals. We share the parser in ../mtr/transform.ts and take only the
// LRT slice — mapped into the standard Timetable shape so it merges cleanly
// with GTFS-derived entries.
export function transformLrt(html: string): Timetable {
  return parseMtrIntervals(html).lrt;
}
