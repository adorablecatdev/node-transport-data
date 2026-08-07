import { Company } from "../../../types.js";
import type { ParsedGtfs, Timetable } from "../../types.js";
import { transformKmb } from "./transform.js";

export const company = Company.KMB;

export async function run(gtfs: ParsedGtfs): Promise<Timetable> {
  return transformKmb(gtfs);
}
