import { fetchText } from "../../lib/http.js";

const LINES_AND_STATIONS_URL =
  "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv";

export type MtrDirection = "DT" | "UT" | "LMC-DT" | "LMC-UT" | "TKS-DT" | "TKS-UT";

export type MtrLineStation = {
  LINE_CODE: string;
  DIRECTION: MtrDirection;
  STATION_CODE: string;
  STATION_ID: string;
  STATION_NAME_CHI: string;
  STATION_NAME_ENG: string;
  SEQUENCE: string;
};

const HEADER_MAP: Record<string, keyof MtrLineStation> = {
  "Line Code": "LINE_CODE",
  Direction: "DIRECTION",
  "Station Code": "STATION_CODE",
  "Station ID": "STATION_ID",
  "Chinese Name": "STATION_NAME_CHI",
  "English Name": "STATION_NAME_ENG",
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

function parseCsv(text: string): MtrLineStation[] {
  const stripped = text.replace(/^﻿/, "");
  const lines = stripped.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvRow(lines[0]!);
  const rows: MtrLineStation[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]!);
    if (cells.every((c) => c === "" || c === "-")) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const key = HEADER_MAP[header[c]!];
      if (key) row[key] = cells[c] ?? "";
    }
    rows.push(row as unknown as MtrLineStation);
  }
  return rows;
}

export async function fetchLineStations(): Promise<MtrLineStation[]> {
  const text = await fetchText(LINES_AND_STATIONS_URL);
  const rows = parseCsv(text);
  console.log(`[mtr] fetched ${rows.length} line-station rows`);
  return rows;
}
