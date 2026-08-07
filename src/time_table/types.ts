import { Company } from "../types.js";

// Schedule map: weekday code (e.g. "1111100") → time window (e.g. "07:00-09:00"
// or a bare "HH:MM" for scheduled trips without frequencies.txt entries) →
// interval in minutes (or null for scheduled one-off departures).
// MTR/LRT entries use symbolic keys like "AM-Peak" / "Non-Peak" / "All-Day"
// and string values like "3.6-5" or "2.5 / 4".
export type Schedule = Record<string, Record<string, number | string | null>>;

// Per-route-record entry. One route record (e.g. "KMB-1-O-1") can produce
// multiple variants when multiple GTFS route_ids share the same short_name;
// each variant carries its own from/to (from route_long_name) and schedule.
export type TimetableVariant = {
  from: string;
  to: string;
  schedule: Schedule;
};

// Top-level shape shared across all company timetable slices. Keys follow the
// convention `${company}-${route}-${bound}-${service_type}` (matching the
// existing routes.json record_id).
export type Timetable = Record<string, TimetableVariant[]>;

// Parsed GTFS CSVs handed to every GTFS-based company transform. Each company
// filters this data down to its own agency_id(s) and applies its own quirks.
export type ParsedGtfs = {
  routes: RouteRow[];
  trips: TripRow[];
  calendar: CalendarRow[];
  frequencies: FrequencyRow[];
};

export type RouteRow = {
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
};
export type TripRow = { trip_id: string; route_id: string; service_id: string };
export type CalendarRow = {
  service_id: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
};
export type FrequencyRow = {
  trip_id: string;
  start_time: string;
  end_time: string;
  headway_secs: string;
};

// Shape each company module exports. `run` receives whatever inputs the company
// needs — GTFS-based companies take ParsedGtfs; MTR/LRT take nothing and fetch
// on their own. The union is intentionally loose; index.ts wires each call.
export type CompanyTimetableModule = {
  company: Company | Company[];
  run: (...args: never[]) => Promise<Timetable>;
};
