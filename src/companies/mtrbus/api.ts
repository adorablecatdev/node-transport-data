import { fetchText } from "../../lib/http.js";

const ROUTES_URL = "https://opendata.mtr.com.hk/data/mtr_bus_routes.csv";
const STOPS_URL = "https://opendata.mtr.com.hk/data/mtr_bus_stops.csv";

export type MtrbDir = "O" | "I";

export type MtrbRoute = {
  ROUTE_ID: string;
  ROUTE_NAME_CHI: string;
  ROUTE_NAME_ENG: string;
  IS_CIRCULAR: string;
  LINE_UP: string;
  LINE_DOWN: string;
  REFERENCE_ID: string;
};

export type MtrbStop = {
  ROUTE_ID: string;
  DIRECTION: MtrbDir;
  STATION_SEQNO: string;
  STATION_ID: string;
  STATION_LATITUDE: string;
  STATION_LONGITUDE: string;
  STATION_NAME_CHI: string;
  STATION_NAME_ENG: string;
  REFERENCE_ID: string;
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

function parseCsv<T extends Record<string, string>>(text: string): T[] {
  const stripped = text.replace(/^﻿/, "");
  const lines = stripped.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvRow(lines[0]!);
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]!);
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]!] = cells[c] ?? "";
    }
    rows.push(row as T);
  }
  return rows;
}

export async function fetchRoutes(): Promise<MtrbRoute[]> {
  const text = await fetchText(ROUTES_URL);
  const rows = parseCsv<MtrbRoute>(text);
  console.log(`[mtrb] fetched ${rows.length} routes`);
  return rows;
}

export async function fetchStops(): Promise<MtrbStop[]> {
  const text = await fetchText(STOPS_URL);
  const rows = parseCsv<MtrbStop>(text);
  console.log(`[mtrb] fetched ${rows.length} route-stops`);
  return rows;
}
