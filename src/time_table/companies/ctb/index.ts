import { Company } from "../../../types/types.js";
import type { ParsedGtfs, Timetable } from "../../../types/types.js";
import { transformCtb } from "./transform.js";

export const company = Company.CTB;

export async function run(gtfs: ParsedGtfs): Promise<Timetable> {
  return transformCtb(gtfs);
}
