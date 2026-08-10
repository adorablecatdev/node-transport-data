export enum Company {
  KMB = "KMB",
  CTB = "CTB",
  KMBCTB = "KMBCTB",
  MTRB = "MTRB",
  MTR = "MTR",
  LRT = "LRT",
  GMBHKI = "GMBHKI",
  GMBKLN = "GMBKLN",
  GMBNT = "GMBNT",
  NLB = "NLB",
}

export enum Bound {
  Inbound = "inbound",
  Outbound = "outbound",
}

export type Localized = { en: string; tc: string; sc: string };

export type RouteOutput<TRoute = string> = {
  record_id: string;
  company: Company;
  route_id?: string;
  route: TRoute;
  bound: Bound;
  service_type?: string;
  origin: Localized;
  destination: Localized;
  ctb_bound?: Bound;
};

export type StopOutput = {
  seq: number;
  stop_id: string;
  name: Localized;
  lat: number;
  long: number;
  ctb_stop_id?: string;
};

export type RouteStopsOutput<TRoute = string> = {
  record_id: string;
  company: Company;
  route_id?: string;
  route: TRoute;
  bound: Bound;
  service_type?: string;
  stops: StopOutput[];
  ctb_bound?: Bound;
};

export function compositeId(
  company: Company,
  route: string,
  bound: Bound,
  service_type: string,
): string {
  return `${company}-${route}-${bound}-${service_type}`;
}

export type Schedule = Record<string, Record<string, number | string | null>>;

export type TimetableVariant = {
  from: string;
  to: string;
  schedule: Schedule;
};

export type Timetable = Record<string, TimetableVariant[]>;

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

export type CompanyTimetableModule = {
  company: Company | Company[];
  run: (...args: never[]) => Promise<Timetable>;
};
