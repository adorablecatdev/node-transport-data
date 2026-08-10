import { Company } from "../../../types/types.js";
import { removeDirIfExists, writeJson } from "../../../lib/io.js";
import { transformInterval, type MtrIntervals } from "./transform_interval.js";
import { transformFirstLastTrain, type FirstLastMap } from "./transform_service_hours.js";

export const company = Company.MTR;

const CACHE_DIR = "out/mtr/.cache";
const INTERVAL_CACHE_PATH = `${CACHE_DIR}/interval.json`;
const SERVICE_HOURS_CACHE_PATH = `${CACHE_DIR}/service-hours.json`;

export type MtrTimetable = {
  interval: MtrIntervals;
  serviceHour: FirstLastMap;
};

export async function run(options: { fresh?: boolean } = {}): Promise<void> {
  const path = "out/mtr/timetable.json";

  if (options.fresh) {
    console.log("[time_table][mtr] fresh flag set — wiping MTR cache");
    await removeDirIfExists(CACHE_DIR);
  }

  const interval = await transformInterval({ cachePath: INTERVAL_CACHE_PATH });
  console.log(`[time_table][mtr] parsed ${Object.keys(interval).length} interval entries`);

  const serviceHour = await transformFirstLastTrain({cachePath: SERVICE_HOURS_CACHE_PATH,});
  console.log(`[time_table][mtr] parsed ${Object.keys(serviceHour).length} service hour entries`,);

  const timetable: MtrTimetable = {
    interval,
    serviceHour: serviceHour,
  };

  await writeJson(path, timetable);
  console.log(`[time_table][mtr] wrote MTR timetable to ${path}`);
}
