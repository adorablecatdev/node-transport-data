import { Company } from "../../../types.js";
import { fetchText } from "../../../lib/http.js";
import type { Timetable } from "../../types.js";
import { INTERVAL_URL, transformLrt } from "./transform.js";

export const company = Company.LRT;

// LRT shares the same source HTML as MTR (the MTR service-index page), but
// parses independently — see ./transform.ts. Both companies fetch the page
// on their own; if page-fetch cost becomes a concern, hoist the fetch into
// ../../index.ts.
export async function run(): Promise<Timetable> {
  console.log("[time_table] fetching MTR interval page (LRT rows)");
  const html = await fetchText(INTERVAL_URL);
  const timetable = transformLrt(html);
  console.log(`[time_table] parsed ${Object.keys(timetable).length} LRT interval entries`);
  return timetable;
}
