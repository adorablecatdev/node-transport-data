# Transform Logic

Per-company mapping from source data to `out/<company>/routes.json` and `out/<company>/route-stops.json`.

The **Origin** column names where each value comes from:

- Named API endpoint or CSV file — external data
- `Derived` — computed locally from other fields (composition, splitting strings, direction flipping, nearest-neighbour, snake_case conversion, etc.)
- `Static` — hardcoded table in `src/companies/<company>/static.ts`
- `Literal` — hardcoded constant string
- `<Company> record` — a record produced by an upstream transform in a prior pass

---

## KMB

**Composite key:** `KMB-{route}-{bound}-{service_type}` — e.g. `KMB-1-I-1`

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | `route`, `bound`, `service_type` | Derived | Composed as `KMB-{route}-{bound}-{service_type}` |
| `company` | — | Literal | `"KMB"` |
| `route` | `route` | KMB `/route/` API | e.g. `"1"`, `"101"` |
| `bound` | `bound` | KMB `/route/` API | Raw API value, `"I"` or `"O"` |
| `service_type` | `service_type` | KMB `/route/` API | e.g. `"1"` |
| `origin.en` | `orig_en` | KMB `/route/` API | English origin name |
| `origin.tc` | `orig_tc` | KMB `/route/` API | Traditional Chinese origin name |
| `origin.sc` | `orig_sc` | KMB `/route/` API | Simplified Chinese origin name |
| `destination.en` | `dest_en` | KMB `/route/` API | English destination name |
| `destination.tc` | `dest_tc` | KMB `/route/` API | Traditional Chinese destination name |
| `destination.sc` | `dest_sc` | KMB `/route/` API | Simplified Chinese destination name |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | route-stop: `route`, `bound`, `service_type` | Derived | Composed as `KMB-{route}-{bound}-{service_type}` |
| `company` | — | Literal | `"KMB"` |
| `route` | `route` | KMB `/route-stop/` API | e.g. `"1"` |
| `bound` | `bound` | KMB `/route-stop/` API | `"I"` or `"O"` |
| `service_type` | `service_type` | KMB `/route-stop/` API | e.g. `"1"` |
| `stops[i].seq` | `seq` | KMB `/route-stop/` API | `Number(seq)`; stops sorted ascending |
| `stops[i].stop_id` | `stop` | KMB `/route-stop/` API | KMB stop id string |
| `stops[i].name.en` | `name_en` | KMB `/stop` API | Joined by stop id; empty string if missing |
| `stops[i].name.tc` | `name_tc` | KMB `/stop` API | Empty string if missing |
| `stops[i].name.sc` | `name_sc` | KMB `/stop` API | Empty string if missing |
| `stops[i].lat` | `lat` | KMB `/stop` API | `Number(lat)`; `NaN` if missing |
| `stops[i].long` | `long` | KMB `/stop` API | `Number(long)`; `NaN` if missing |

---

## CTB

**Composite key:** `CTB-{route}-{bound}` — e.g. `CTB-1-I`

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | `route`, direction | Derived | Composed as `CTB-{route}-{bound}` |
| `company` | — | Literal | `"CTB"` |
| `route` | `route` | CTB `/route/CTB` API | e.g. `"1"` |
| `bound` | direction (loop over `"outbound"`/`"inbound"`) | Derived | `"outbound"` → `"O"`, `"inbound"` → `"I"` |
| `origin.en` | outbound: `orig_en`; inbound: `dest_en` | CTB `/route/CTB` API | Inbound swaps origin/destination |
| `origin.tc` | outbound: `orig_tc`; inbound: `dest_tc` | CTB `/route/CTB` API | Inbound swaps |
| `origin.sc` | outbound: `orig_sc`; inbound: `dest_sc` | CTB `/route/CTB` API | Inbound swaps |
| `destination.en` | outbound: `dest_en`; inbound: `orig_en` | CTB `/route/CTB` API | Mirror of `origin.en` |
| `destination.tc` | outbound: `dest_tc`; inbound: `orig_tc` | CTB `/route/CTB` API | Mirror of `origin.tc` |
| `destination.sc` | outbound: `dest_sc`; inbound: `orig_sc` | CTB `/route/CTB` API | Mirror of `origin.sc` |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | group: `route`, `direction` | Derived | Composed as `CTB-{route}-{bound}` |
| `company` | — | Literal | `"CTB"` |
| `route` | group: `route` | CTB `/route-stop/CTB/{route}/{dir}` API | e.g. `"1"` |
| `bound` | group: `direction` | Derived | `"outbound"` → `"O"`, `"inbound"` → `"I"` |
| `stops[i].seq` | `seq` | CTB `/route-stop/CTB/{route}/{dir}` API (non-circular) / Derived (circular) | Non-circular: `Number(seq)` sorted ascending. Circular: renumbered `1..N` after concatenating outbound + inbound |
| `stops[i].stop_id` | `stop` | CTB `/route-stop/CTB/{route}/{dir}` API | CTB stop id string |
| `stops[i].name.en` | `name_en` | CTB `/stop/{id}` API | Empty string if the stop is missing |
| `stops[i].name.tc` | `name_tc` | CTB `/stop/{id}` API | Empty string if missing |
| `stops[i].name.sc` | `name_sc` | CTB `/stop/{id}` API | Empty string if missing |
| `stops[i].lat` | `lat` | CTB `/stop/{id}` API | `Number(lat)`; `NaN` if missing |
| `stops[i].long` | `long` | CTB `/stop/{id}` API | `Number(long)`; `NaN` if missing |

---

## KMBCTB (joint)

**Composite key:** `KMBCTB-{route}-{bound}-{service_type}` — e.g. `KMBCTB-101-O-1`

Reads `out/kmb/*.json` and `out/ctb/*.json`; emits only KMB routes listed in `JOINTLY_OPERATED_ROUTES`.

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | KMB record: `route`, `bound`, `service_type` | Derived | Composed as `KMBCTB-{route}-{bound}-{service_type}` |
| `company` | — | Literal | `"KMBCTB"` |
| `route` | `route` | KMB record | e.g. `"101"` |
| `bound` | `bound` | KMB record | `"I"` or `"O"`, copied verbatim from KMB |
| `ctb_bound` | KMB record: `bound` | Derived | Same as `bound` unless the route is in `REVERSE_DIR_ROUTES`, then flipped |
| `service_type` | `service_type` | KMB record | e.g. `"1"` |
| `origin.en` | `origin.en` | KMB record | Copied from KMB |
| `origin.tc` | `origin.tc` | KMB record | Copied from KMB |
| `origin.sc` | `origin.sc` | KMB record | Copied from KMB |
| `destination.en` | `destination.en` | KMB record | Copied from KMB |
| `destination.tc` | `destination.tc` | KMB record | Copied from KMB |
| `destination.sc` | `destination.sc` | KMB record | Copied from KMB |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | KMB record: `route`, `bound`, `service_type` | Derived | Composed as `KMBCTB-{route}-{bound}-{service_type}` |
| `company` | — | Literal | `"KMBCTB"` |
| `route` | `route` | KMB record | e.g. `"101"` |
| `bound` | `bound` | KMB record | `"I"` / `"O"` |
| `ctb_bound` | KMB record: `bound` | Derived | Flipped when route is in `REVERSE_DIR_ROUTES` |
| `service_type` | `service_type` | KMB record | e.g. `"1"` |
| `stops[i].seq` | `seq` | KMB stop | Copied from KMB |
| `stops[i].stop_id` | `stop_id` | KMB stop | Copied from KMB |
| `stops[i].name.en` | `name.en` | KMB stop | Copied from KMB |
| `stops[i].name.tc` | `name.tc` | KMB stop | Copied from KMB |
| `stops[i].name.sc` | `name.sc` | KMB stop | Copied from KMB |
| `stops[i].lat` | `lat` | KMB stop | Copied from KMB |
| `stops[i].long` | `long` | KMB stop | Copied from KMB |
| `stops[i].ctb_stop_id` | CTB stop: `stop_id` | Derived (haversine nearest) | Nearest neighbour over counterpart CTB stops; omitted if KMB stop has non-finite lat/long |

---

## GMB (HKI / KLN / NT)

**Composite key:** `{company}-{route}-{route_id}-{route_seq}` — e.g. `GMBHKI-52-2005220-1`

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | region, `route_code`, `route_id`, `route_seq` | Derived | Composed as `{company}-{route}-{route_id}-{route_seq}` |
| `company` | region | Derived | `"HKI"` → `"GMBHKI"`, `"KLN"` → `"GMBKLN"`, `"NT"` → `"GMBNT"` |
| `route_id` | route info: `route_id` | GMB `/route/{region}/{route_code}` API | `String(route_id)`, e.g. `"2005220"` |
| `route` | route info: `route_code` | GMB `/route/{region}/{route_code}` API | e.g. `"52"` |
| `route_seq` | direction: `route_seq` | GMB `/route/{region}/{route_code}` API | Raw number (`1`, `2`, `3`, …); no inbound/outbound translation |
| `region` | region | Literal (per run) | `"HKI"` / `"KLN"` / `"NT"` |
| `origin.en` | direction: `orig_en` | GMB `/route/{region}/{route_code}` API | English origin name |
| `origin.tc` | direction: `orig_tc` | GMB `/route/{region}/{route_code}` API | Traditional Chinese origin name |
| `origin.sc` | direction: `orig_sc` | GMB `/route/{region}/{route_code}` API | Simplified Chinese origin name |
| `destination.en` | direction: `dest_en` | GMB `/route/{region}/{route_code}` API | English destination name |
| `destination.tc` | direction: `dest_tc` | GMB `/route/{region}/{route_code}` API | Traditional Chinese destination name |
| `destination.sc` | direction: `dest_sc` | GMB `/route/{region}/{route_code}` API | Simplified Chinese destination name |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | region, `route_code`, `route_id`, `route_seq` | Derived | Composed as `{company}-{route}-{route_id}-{route_seq}` |
| `company` | region | Derived | `"HKI"` → `"GMBHKI"`, etc. |
| `route_id` | `route_id` | GMB `/route-stop/{route_id}/{route_seq}` API (group meta) | `String(route_id)` |
| `route` | `route_code` | GMB `/route-stop/{route_id}/{route_seq}` API (group meta) | e.g. `"52"` |
| `route_seq` | `route_seq` | GMB `/route-stop/{route_id}/{route_seq}` API (group meta) | Raw number |
| `region` | region | Literal (per run) | `"HKI"` / `"KLN"` / `"NT"` |
| `stops[i].seq` | `stop_seq` | GMB `/route-stop/{route_id}/{route_seq}` API | `Number(stop_seq)`; stops sorted ascending |
| `stops[i].stop_id` | `stop_id` | GMB `/route-stop/{route_id}/{route_seq}` API | `String(stop_id)` |
| `stops[i].name.en` | `name_en` | GMB `/route-stop/{route_id}/{route_seq}` API | English stop name |
| `stops[i].name.tc` | `name_tc` | GMB `/route-stop/{route_id}/{route_seq}` API | Traditional Chinese stop name |
| `stops[i].name.sc` | `name_sc` | GMB `/route-stop/{route_id}/{route_seq}` API | Simplified Chinese stop name |
| `stops[i].lat` | `coordinates.wgs84.latitude` | GMB `/stop/{stop_id}` API | `NaN` if the stop id is not in the `/stop` catalogue |
| `stops[i].long` | `coordinates.wgs84.longitude` | GMB `/stop/{stop_id}` API | `NaN` if missing |

---

## MTR

**Composite key:** `MTR-{LINE_CODE}-{DIRECTION}` — e.g. `MTR-EAL-UT`, `MTR-EAL-LMC-DT`

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | csv row: `LINE_CODE`, `DIRECTION` | Derived | Composed as `MTR-{LINE_CODE}-{DIRECTION}` |
| `company` | — | Literal | `"MTR"` |
| `route_id` | `LINE_CODE` | `mtr_lines_and_stations.csv` | e.g. `"EAL"`; branch info now lives in `bound` |
| `route.en` | `ROUTE_NAME_EN[DIRECTION or LINE_CODE]` | Static (`ROUTE_NAME_EN`) | Lookup tries direction first (`"LMC-DT"`), falls back to `LINE_CODE` (`"EAL"`), then to the raw `LINE_CODE` string |
| `route.tc` | `ROUTE_NAME_TC[DIRECTION or LINE_CODE]` | Static (`ROUTE_NAME_TC`) | Same fallback chain as `route.en` |
| `route.sc` | `ROUTE_NAME_TC[DIRECTION or LINE_CODE]` | Static (`ROUTE_NAME_TC`) | Same string as `route.tc` (no separate Simplified table) |
| `bound` | `DIRECTION` | `mtr_lines_and_stations.csv` | Raw CSV value: `"DT"`, `"UT"`, `"LMC-DT"`, `"LMC-UT"`, `"TKS-DT"`, `"TKS-UT"` |
| `origin.en` | first row in group: `STATION_NAME_ENG` | `mtr_lines_and_stations.csv` | e.g. `"Admiralty"` |
| `origin.tc` | first row in group: `STATION_NAME_CHI` | `mtr_lines_and_stations.csv` | e.g. `"金鐘"` |
| `origin.sc` | first row in group: `STATION_NAME_CHI` | `mtr_lines_and_stations.csv` | Same string as `origin.tc` |
| `destination.en` | last row in group: `STATION_NAME_ENG` | `mtr_lines_and_stations.csv` | e.g. `"LOHAS Park"` |
| `destination.tc` | last row in group: `STATION_NAME_CHI` | `mtr_lines_and_stations.csv` | e.g. `"康城"` |
| `destination.sc` | last row in group: `STATION_NAME_CHI` | `mtr_lines_and_stations.csv` | Same string as `destination.tc` |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | csv row: `LINE_CODE`, `DIRECTION` | Derived | Composed as `MTR-{LINE_CODE}-{DIRECTION}` |
| `company` | — | Literal | `"MTR"` |
| `route_id` | `LINE_CODE` | `mtr_lines_and_stations.csv` | e.g. `"EAL"` |
| `route.en` | `ROUTE_NAME_EN[DIRECTION or LINE_CODE]` | Static (`ROUTE_NAME_EN`) | Same lookup chain as routes.json |
| `route.tc` | `ROUTE_NAME_TC[DIRECTION or LINE_CODE]` | Static (`ROUTE_NAME_TC`) | Same lookup chain as routes.json |
| `route.sc` | `ROUTE_NAME_TC[DIRECTION or LINE_CODE]` | Static (`ROUTE_NAME_TC`) | Same string as `route.tc` |
| `bound` | `DIRECTION` | `mtr_lines_and_stations.csv` | e.g. `"UT"`, `"LMC-DT"` |
| `stops[i].seq` | `SEQUENCE` | `mtr_lines_and_stations.csv` | `Number(SEQUENCE)`; stops sorted ascending |
| `stops[i].stop_id` | `STATION_CODE` | `mtr_lines_and_stations.csv` | e.g. `"ADM"` |
| `stops[i].name.en` | `STATION_NAME_ENG` | `mtr_lines_and_stations.csv` | |
| `stops[i].name.tc` | `STATION_NAME_CHI` | `mtr_lines_and_stations.csv` | |
| `stops[i].name.sc` | `STATION_NAME_CHI` | `mtr_lines_and_stations.csv` | Same string as `name.tc` |
| `stops[i].lat` | `STATION_LOCATION[STATION_CODE].lat` | Static (`STATION_LOCATION`) | `NaN` if code not in static table |
| `stops[i].long` | `STATION_LOCATION[STATION_CODE].long` | Static (`STATION_LOCATION`) | `NaN` if code not in static table |

---

## MTRB (mtrbus / feeder)

**Composite key:** `MTRB-{ROUTE_ID}-{bound}` where `bound` is the `LINE_UP` / `LINE_DOWN` value — e.g. `MTRB-K68-K68_CIR`

Internally the transform emits `bound_temp` (`"o"` from LINE_UP, `"i"` from LINE_DOWN) to correlate route rows with stop rows via the stops CSV's `DIRECTION` column; it is deleted in `index.ts` before writing.

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | csv row: `ROUTE_ID`, `LINE_UP` / `LINE_DOWN` | Derived | Composed as `MTRB-{ROUTE_ID}-{bound}` |
| `company` | — | Literal | `"MTRB"` |
| `route` | `ROUTE_ID` | `mtr_bus_routes.csv` | e.g. `"K68"`, `"506"` |
| `bound` | `LINE_UP` (outbound record) or `LINE_DOWN` (inbound record) | `mtr_bus_routes.csv` | Raw variant identifier like `"K68_CIR"`. Blank values skip the record |
| `origin.en` | outbound: `splitName(ROUTE_NAME_ENG, " to ").origin`; inbound: `.destination` | Derived (from `mtr_bus_routes.csv`) | Inbound swaps origin/destination |
| `origin.tc` | outbound: `splitName(ROUTE_NAME_CHI, "至").origin`; inbound: `.destination` | Derived (from `mtr_bus_routes.csv`) | Inbound swaps |
| `origin.sc` | outbound: `splitName(ROUTE_NAME_CHI, "至").origin`; inbound: `.destination` | Derived (from `mtr_bus_routes.csv`) | Same string as `origin.tc` (no Simplified column in CSV) |
| `destination.en` | outbound: `splitName(ROUTE_NAME_ENG, " to ").destination`; inbound: `.origin` | Derived (from `mtr_bus_routes.csv`) | Mirror of `origin.en` |
| `destination.tc` | outbound: `splitName(ROUTE_NAME_CHI, "至").destination`; inbound: `.origin` | Derived (from `mtr_bus_routes.csv`) | Mirror of `origin.tc` |
| `destination.sc` | outbound: `splitName(ROUTE_NAME_CHI, "至").destination`; inbound: `.origin` | Derived (from `mtr_bus_routes.csv`) | Same string as `destination.tc` |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | routes csv row: `ROUTE_ID`, `LINE_UP` / `LINE_DOWN` | Derived | Resolved via stops csv `REFERENCE_ID` → route row, then `DIRECTION` picks LINE_UP (`"O"`) or LINE_DOWN (`"I"`) |
| `company` | — | Literal | `"MTRB"` |
| `route` | `ROUTE_ID` | `mtr_bus_routes.csv` | e.g. `"K68"` |
| `bound` | `LINE_UP` / `LINE_DOWN` | `mtr_bus_routes.csv` | e.g. `"K68_CIR"`; groups whose pick is blank are skipped |
| `stops[i].seq` | `STATION_SEQNO` | `mtr_bus_stops.csv` | `Number(STATION_SEQNO)`; stops sorted ascending |
| `stops[i].stop_id` | `STATION_ID` | `mtr_bus_stops.csv` | e.g. `"K68-U001"` |
| `stops[i].name.en` | `STATION_NAME_ENG` | `mtr_bus_stops.csv` | |
| `stops[i].name.tc` | `STATION_NAME_CHI` | `mtr_bus_stops.csv` | |
| `stops[i].name.sc` | `STATION_NAME_CHI` | `mtr_bus_stops.csv` | Same string as `name.tc` |
| `stops[i].lat` | `STATION_LATITUDE` | `mtr_bus_stops.csv` | `Number(STATION_LATITUDE)` |
| `stops[i].long` | `STATION_LONGITUDE` | `mtr_bus_stops.csv` | `Number(STATION_LONGITUDE)` |

---

## LRT (light rail)

**Composite key:** `LRT-{LINE_CODE}-{bound}` where `bound` is snake_case English destination — e.g. `LRT-505-sam_shing`

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | csv row: `LINE_CODE`; last row in group: `STOP_NAME_ENG` | Derived | Composed as `LRT-{LINE_CODE}-{snake_case destination}` |
| `company` | — | Literal | `"LRT"` |
| `route` | `LINE_CODE` | `light_rail_routes_and_stops.csv` | e.g. `"505"` |
| `bound` | last row in group: `STOP_NAME_ENG` | Derived (from `light_rail_routes_and_stops.csv`) | snake_case: lowercase, non-alphanumerics collapsed to `_`. `"Sam Shing"` → `"sam_shing"`, `"Tin Shui Wai"` → `"tin_shui_wai"` |
| `origin.en` | first row in group: `STOP_NAME_ENG` | `light_rail_routes_and_stops.csv` | |
| `origin.tc` | first row in group: `STOP_NAME_CHI` | `light_rail_routes_and_stops.csv` | |
| `origin.sc` | first row in group: `STOP_NAME_CHI` | `light_rail_routes_and_stops.csv` | Same string as `origin.tc` |
| `destination.en` | last row in group: `STOP_NAME_ENG` | `light_rail_routes_and_stops.csv` | |
| `destination.tc` | last row in group: `STOP_NAME_CHI` | `light_rail_routes_and_stops.csv` | |
| `destination.sc` | last row in group: `STOP_NAME_CHI` | `light_rail_routes_and_stops.csv` | Same string as `destination.tc` |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | csv row: `LINE_CODE`; last row in group: `STOP_NAME_ENG` | Derived | Composed as `LRT-{LINE_CODE}-{snake_case destination}` |
| `company` | — | Literal | `"LRT"` |
| `route` | `LINE_CODE` | `light_rail_routes_and_stops.csv` | e.g. `"505"` |
| `bound` | last row in group: `STOP_NAME_ENG` | Derived (from `light_rail_routes_and_stops.csv`) | snake_case (see routes.json) |
| `stops[i].seq` | `SEQUENCE` | `light_rail_routes_and_stops.csv` | `Number(SEQUENCE)`; stops sorted ascending |
| `stops[i].stop_id` | `STOP_ID` | `light_rail_routes_and_stops.csv` | e.g. `"100"` (not `STOP_CODE`) |
| `stops[i].name.en` | `STOP_NAME_ENG` | `light_rail_routes_and_stops.csv` | |
| `stops[i].name.tc` | `STOP_NAME_CHI` | `light_rail_routes_and_stops.csv` | |
| `stops[i].name.sc` | `STOP_NAME_CHI` | `light_rail_routes_and_stops.csv` | Same string as `name.tc` |
| `stops[i].lat` | `STOP_LOCATION[STOP_ID].lat` | Static (`STOP_LOCATION`) | `NaN` if id not in static table |
| `stops[i].long` | `STOP_LOCATION[STOP_ID].long` | Static (`STOP_LOCATION`) | `NaN` if id not in static table |

---

## NLB

**Composite key:** `NLB-{routeNo}-{routeId}` — e.g. `NLB-1-2`

### routes.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | route: `routeNo`, `routeId` | Derived | Composed as `NLB-{routeNo}-{routeId}` |
| `company` | — | Literal | `"NLB"` |
| `route_id` | `routeId` | NLB `/route.php?action=list` API | Numeric string, e.g. `"2"` |
| `route` | `routeNo` | NLB `/route.php?action=list` API | e.g. `"1"` |
| `origin.en` | `splitName(routeName_e).origin` | Derived (from NLB `/route.php`) | Split on `">"`. `"Tai O > Tung Chung Town Centre"` → `"Tai O"` |
| `origin.tc` | `splitName(routeName_c).origin` | Derived (from NLB `/route.php`) | Traditional Chinese origin |
| `origin.sc` | `splitName(routeName_s).origin` | Derived (from NLB `/route.php`) | Simplified Chinese origin |
| `destination.en` | `splitName(routeName_e).destination` | Derived (from NLB `/route.php`) | e.g. `"Tung Chung Town Centre"` |
| `destination.tc` | `splitName(routeName_c).destination` | Derived (from NLB `/route.php`) | Traditional Chinese destination |
| `destination.sc` | `splitName(routeName_s).destination` | Derived (from NLB `/route.php`) | Simplified Chinese destination |

### route-stops.json

| Output field | Source field | Origin | Remark |
|---|---|---|---|
| `record_id` | route: `routeNo`, `routeId` | Derived | Composed as `NLB-{routeNo}-{routeId}` |
| `company` | — | Literal | `"NLB"` |
| `route_id` | `routeId` | NLB `/route.php?action=list` API | e.g. `"2"` |
| `route` | `routeNo` | NLB `/route.php?action=list` API | e.g. `"1"` |
| `stops[i].seq` | stop array position | Derived | Sequential `1..N` in the order the API returned them |
| `stops[i].stop_id` | `stopId` | NLB `/stop.php?action=list&routeId={id}` API | e.g. `"221"` |
| `stops[i].name.en` | `stopName_e` | NLB `/stop.php?action=list&routeId={id}` API | |
| `stops[i].name.tc` | `stopName_c` | NLB `/stop.php?action=list&routeId={id}` API | |
| `stops[i].name.sc` | `stopName_s` | NLB `/stop.php?action=list&routeId={id}` API | |
| `stops[i].lat` | `latitude` | NLB `/stop.php?action=list&routeId={id}` API | `Number(latitude)` |
| `stops[i].long` | `longitude` | NLB `/stop.php?action=list&routeId={id}` API | `Number(longitude)` |
