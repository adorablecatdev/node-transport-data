import { fetchJson } from "../../lib/http.js";

const BASE = "https://data.etabus.gov.hk/v1/transport/kmb";

export type KmbBound = "O" | "I";

export type KmbRoute = {
  route: string;
  bound: KmbBound;
  service_type: string;
  orig_en: string;
  orig_tc: string;
  orig_sc: string;
  dest_en: string;
  dest_tc: string;
  dest_sc: string;
};

export type KmbStop = {
  stop: string;
  name_en: string;
  name_tc: string;
  name_sc: string;
  lat: string;
  long: string;
};

export type KmbRouteStop = {
  route: string;
  bound: KmbBound;
  service_type: string;
  seq: string;
  stop: string;
};

type Envelope<T> = { type: string; version: string; generated_timestamp: string; data: T };

export async function fetchRoutes(): Promise<KmbRoute[]> {
  const r = await fetchJson<Envelope<KmbRoute[]>>(`${BASE}/route/`);
  console.log(`[kmb] fetched ${r?.data?.length} routes`);
  return r.data;
}

export async function fetchStops(): Promise<KmbStop[]> {
  const r = await fetchJson<Envelope<KmbStop[]>>(`${BASE}/stop`);
  console.log(`[kmb] fetched ${r?.data?.length} stops`);
  return r.data;
}

export async function fetchRouteStops(): Promise<KmbRouteStop[]> {
  const r = await fetchJson<Envelope<KmbRouteStop[]>>(`${BASE}/route-stop`);
  console.log(`[kmb] fetched ${r?.data?.length} route-stops`);
  return r.data;
}
