import { Company } from "../../../types.js";
import { removeDirIfExists, writeJson } from "../../../lib/io.js";
import { transformLrt, type LrtIntervalMap } from "./transform_interval.js";
import {
  transformFirstLastTrain,
  type FirstLastMap,
} from "./transform_service_hours.js";

export const company = Company.LRT;

const CACHE_DIR = "out/lrt/.cache";
const INTERVAL_CACHE_PATH = `${CACHE_DIR}/interval.json`;
const SERVICE_HOURS_CACHE_PATH = `${CACHE_DIR}/service-hours.json`;

export type LrtTimetable = {
  interval: LrtIntervalMap;
  serviceHour: FirstLastMap;
};

export async function run(options: { fresh?: boolean } = {}): Promise<void> {
  const path = "out/lrt/timetable.json";

  if (options.fresh) {
    console.log("[time_table][lrt] fresh flag set — wiping LRT cache");
    await removeDirIfExists(CACHE_DIR);
  }

  const interval = await transformLrt({ cachePath: INTERVAL_CACHE_PATH });
  console.log(`[time_table][lrt] parsed ${Object.keys(interval).length} interval entries`);

  const serviceHour = await transformFirstLastTrain({ cachePath: SERVICE_HOURS_CACHE_PATH });
  console.log(`[time_table][lrt] parsed ${Object.keys(serviceHour).length} service hour entries`);

  const timetable: LrtTimetable = {
    interval,
    serviceHour,
  };

  await writeJson(path, timetable);
  console.log(`[time_table][lrt] wrote LRT timetable to ${path}`);
}
