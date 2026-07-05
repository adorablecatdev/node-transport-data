export enum Company {
  KMB = "KMB",
  CTB = "CTB",
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
  route_id: string;
  route: TRoute;
  bound: Bound;
  service_type: string;
  origin: Localized;
  destination: Localized;
};

export type StopOutput = {
  seq: number;
  stop_id: string;
  name: Localized;
  lat: number;
  long: number;
};

export type RouteStopsOutput<TRoute = string> = {
  record_id: string;
  company: Company;
  route_id: string;
  route: TRoute;
  bound: Bound;
  service_type: string;
  stops: StopOutput[];
};

export function compositeId(
  company: Company,
  route: string,
  bound: Bound,
  service_type: string,
): string {
  return `${company}-${route}-${bound}-${service_type}`;
}
