import { Company } from "../../../types.js";
import type { ParsedGtfs, Timetable } from "../../types.js";
import { transformKmbCtb } from "./transform.js";

export const company = Company.KMBCTB;

export async function run(gtfs: ParsedGtfs): Promise<Timetable> {
  return transformKmbCtb(gtfs);
}
