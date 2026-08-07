import { Company } from "../../../types.js";
import { fetchText } from "../../../lib/http.js";
import { INTERVAL_URL, transformMtr, type MtrIntervals } from "./transform.js";

export const company = Company.MTR;

// MTR does NOT return a Timetable — it has its own shape written to a separate
// file. Kept out of the standard company module contract on purpose.
export async function run(): Promise<MtrIntervals> {
  console.log("[time_table] fetching MTR interval page");
  const html = await fetchText(INTERVAL_URL);
  const intervals = transformMtr(html);
  console.log(`[time_table] parsed ${Object.keys(intervals).length} MTR interval entries`);
  return intervals;
}
