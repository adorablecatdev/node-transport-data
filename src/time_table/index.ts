import { readJsonIfExists, writeJson } from "../lib/io.js";
import * as kmb from "./companies/kmb/index.js";
import * as kmbctb from "./companies/kmbctb/index.js";
import * as gmb from "./companies/gmb/index.js";
import * as mtr from "./companies/mtr/index.js";
import * as lrt from "./companies/lrt/index.js";
import { groupTimetableByCompany, mergePerCompanyTimetables } from "./lib/util.js";
import { Company } from "../types.js";
import { LRT_TIMETABLE_PATH, MTR_TIMETABLE_PATH, OUT_DIR } from "./lib/constants.js";
import { GmbRegion } from "./companies/gmb/api.js";

export async function run(options: { fresh?: boolean } = {}): Promise<void>
{
  // const gtfs = await fetchAndParseGtfs({ fresh: options.fresh });

  await kmb.run({ fresh: options.fresh });
  await kmbctb.run({ fresh: options.fresh });
  await gmb.run({ region: "HKI" as GmbRegion, fresh: options.fresh });
  await gmb.run({ region: "KLN" as GmbRegion, fresh: options.fresh });
  await gmb.run({ region: "NT" as GmbRegion, fresh: options.fresh });
  await mtr.run({ fresh: options.fresh });
  await lrt.run({ fresh: options.fresh });

  const merged = await mergePerCompanyTimetables();
  const grouped: Record<string, unknown> = groupTimetableByCompany(merged);

  const mtrTimetable = await readJsonIfExists<mtr.MtrTimetable>(MTR_TIMETABLE_PATH);
  if (mtrTimetable) {
    grouped[Company.MTR] = mtrTimetable;
  } else {
    console.warn(`[time_table] missing MTR timetable: ${MTR_TIMETABLE_PATH}`);
  }

  const lrtTimetable = await readJsonIfExists<lrt.LrtTimetable>(LRT_TIMETABLE_PATH);
  if (lrtTimetable) {
    grouped[Company.LRT] = lrtTimetable;
  } else {
    console.warn(`[time_table] missing LRT timetable: ${LRT_TIMETABLE_PATH}`);
  }

  await writeJson(`${OUT_DIR}/timetable.json`, grouped);
  console.log(`[time_table] wrote final timetable across ${Object.keys(grouped).length} companies to ${OUT_DIR}/timetable.json`);
}
