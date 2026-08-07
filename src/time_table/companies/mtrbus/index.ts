import { Company } from "../../../types.js";
import type { ParsedGtfs, Timetable } from "../../types.js";
import { transformMtrBus } from "./transform.js";

export const company = Company.MTRB;

export async function run(gtfs: ParsedGtfs): Promise<Timetable> {
  return transformMtrBus(gtfs);
}
