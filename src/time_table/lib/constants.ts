import { Company } from "../../types/types.js";

export const COMPANY_PREFIXES: Company[] = [
  Company.GMBHKI,
  Company.GMBKLN,
  Company.GMBNT,
  Company.KMBCTB,
  Company.MTRB,
  Company.KMB,
  Company.CTB,
  Company.MTR,
  Company.LRT,
  Company.NLB,
];

export const OUT_DIR = "out/final";
export const PER_COMPANY_DIR = `${OUT_DIR}/per-company`;

export const PER_COMPANY_TIMETABLE_PATHS = [
  "out/kmb/timetable.json",
  "out/kmbctb/timetable.json",
  "out/gmbhki/timetable.json",
  "out/gmbkln/timetable.json",
  "out/gmbnt/timetable.json",
  // "out/lrt/timetable.json",
  // `${PER_COMPANY_DIR}/timetable-kmbctb.json`,
  // `${PER_COMPANY_DIR}/timetable-nlb.json`,
  // `${PER_COMPANY_DIR}/timetable-mtrbus.json`,
];

export const MTR_TIMETABLE_PATH = "out/mtr/timetable.json";

export const GTFS_URL =
    "https://res.data.gov.hk/api/get-download-file?name=https%3A%2F%2Fstatic.data.gov.hk%2Ftd%2Fpt-headway-tc%2Fgtfs.zip";
export const WANTED_FILES = new Set(["routes.txt", "trips.txt", "calendar.txt", "frequencies.txt"]);
export const CACHE_PATH = "tmp/gtfs.zip";