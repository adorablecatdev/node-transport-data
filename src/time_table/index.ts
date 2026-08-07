import { writeJson } from "../lib/io.js";
import { fetchAndParseGtfs } from "./lib/gtfs-shared.js";
import { mergeTimetables } from "./merge.js";
import { writeMtrFirstLastTrain } from "./companies/mtr/service_hours.js";

import * as kmb from "./companies/kmb/index.js";
import * as ctb from "./companies/ctb/index.js";
import * as kmbctb from "./companies/kmbctb/index.js";
import * as nlb from "./companies/nlb/index.js";
import * as mtrbus from "./companies/mtrbus/index.js";
import * as gmb from "./companies/gmb/index.js";
import * as mtr from "./companies/mtr/index.js";
import * as lrt from "./companies/lrt/index.js";

const OUT_DIR = "out/final";
const PER_COMPANY_DIR = `${OUT_DIR}/per-company`;

export async function run(options: { fresh?: boolean } = {}): Promise<void> {
  // Single shared fetch + parse. Every GTFS-based company gets the same
  // ParsedGtfs; each applies its own agency filter and quirks.
  const gtfs = await fetchAndParseGtfs({ fresh: options.fresh });

  const gtfsSlices = await Promise.all([
    kmb.run(gtfs),
    ctb.run(gtfs),
    kmbctb.run(gtfs),
    nlb.run(gtfs),
    mtrbus.run(gtfs),
    gmb.run(gtfs),
  ]);

  // LRT joins the merged timetable; MTR stays in its own file.
  const lrtSlice = await lrt.run();
  const mtrIntervals = await mtr.run();

  // Per-company intermediate files — useful for inspection and diffing.
  // KMB and CTB live under out/{company}/ so they sit next to routes.json /
  // route-stops.json; the rest stay under out/final/per-company/ for now.
  await writeJson("out/kmb/timetable.json", gtfsSlices[0]);
  await writeJson("out/ctb/timetable.json", gtfsSlices[1]);
  await writeJson(`${PER_COMPANY_DIR}/timetable-kmbctb.json`, gtfsSlices[2]);
  await writeJson(`${PER_COMPANY_DIR}/timetable-nlb.json`, gtfsSlices[3]);
  await writeJson(`${PER_COMPANY_DIR}/timetable-mtrbus.json`, gtfsSlices[4]);
  await writeJson(`${PER_COMPANY_DIR}/timetable-gmb.json`, gtfsSlices[5]);
  await writeJson(`${PER_COMPANY_DIR}/timetable-lrt.json`, lrtSlice);

  const merged = mergeTimetables([...gtfsSlices, lrtSlice]);
  await writeJson(`${OUT_DIR}/timetable.json`, merged);
  console.log(
    `[time_table] wrote ${Object.keys(merged).length} route entries to ${OUT_DIR}/timetable.json`,
  );

  await writeJson(`${OUT_DIR}/mtr-intervals.json`, mtrIntervals);
  console.log(
    `[time_table] wrote ${Object.keys(mtrIntervals).length} MTR interval entries to ${OUT_DIR}/mtr-intervals.json`,
  );

  await writeMtrFirstLastTrain(`${OUT_DIR}/mtr-first-last-train.json`);
}

// Single-company entry point for CLI flags like --timetable-kmb. Fetches the
// shared GTFS feed and runs only the requested company; writes the per-company
// intermediate file but does NOT touch the merged timetable.json.
export async function runKmbOnly(options: { fresh?: boolean } = {}): Promise<void> {
  const gtfs = await fetchAndParseGtfs({ fresh: options.fresh });
  const slice = await kmb.run(gtfs);
  const path = "out/kmb/timetable.json";
  await writeJson(path, slice);
  console.log(`[time_table] wrote ${Object.keys(slice).length} KMB entries to ${path}`);
}

export async function runCtbOnly(options: { fresh?: boolean } = {}): Promise<void> {
  const gtfs = await fetchAndParseGtfs({ fresh: options.fresh });
  const slice = await ctb.run(gtfs);
  const path = "out/ctb/timetable.json";
  await writeJson(path, slice);
  console.log(`[time_table] wrote ${Object.keys(slice).length} CTB entries to ${path}`);
}
