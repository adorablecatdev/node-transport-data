import { Company } from "../../../types/types.js";
import type { ParsedGtfs, Timetable } from "../../../types/types.js";
import { transformNlb } from "./transform.js";

export const company = Company.NLB;

export async function run(gtfs: ParsedGtfs): Promise<Timetable> {
  return transformNlb(gtfs);
}
