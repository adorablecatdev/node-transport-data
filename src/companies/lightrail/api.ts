import { fetchText } from "../../lib/http.js";

const ROUTES_AND_STOPS_URL =
  "https://opendata.mtr.com.hk/data/light_rail_routes_and_stops.csv";

export type LrtDirection = "1" | "2";

export type LrtRouteStop = {
  LINE_CODE: string;
  DIRECTION: LrtDirection;
  STOP_CODE: string;
  STOP_ID: string;
  STOP_NAME_CHI: string;
  STOP_NAME_ENG: string;
  SEQUENCE: string;
};

const HEADER_MAP: Record<string, keyof LrtRouteStop> = {
  "Line Code": "LINE_CODE",
  Direction: "DIRECTION",
  "Stop Code": "STOP_CODE",
  "Stop ID": "STOP_ID",
  "Chinese Name": "STOP_NAME_CHI",
  "English Name": "STOP_NAME_ENG",
  Sequence: "SEQUENCE",
};

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): LrtRouteStop[] {
  const stripped = text.replace(/^﻿/, "");
  const lines = stripped.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvRow(lines[0]!);
  const rows: LrtRouteStop[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]!);
    if (cells.every((c) => c === "" || c === "-")) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const key = HEADER_MAP[header[c]!];
      if (key) row[key] = cells[c] ?? "";
    }
    rows.push(row as unknown as LrtRouteStop);
  }
  return rows;
}

export async function fetchRouteStops(): Promise<LrtRouteStop[]> {
  const text = await fetchText(ROUTES_AND_STOPS_URL);
  const rows = parseCsv(text);
  console.log(`[lrt] fetched ${rows.length} route-stop rows`);
  return rows;
}
