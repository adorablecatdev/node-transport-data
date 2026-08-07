import { Company } from "../../../types.js";
import type { ParsedGtfs, Timetable } from "../../types.js";
import { transformCtb } from "./transform.js";

export const company = Company.CTB;

export async function run(gtfs: ParsedGtfs): Promise<Timetable> {
  return transformCtb(gtfs);
}
