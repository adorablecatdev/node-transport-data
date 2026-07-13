// Routes jointly operated by KMB and CTB.
// The KMB record is treated as primary; a matching CTB record must exist
// (same route number) for a joint entry to be produced.
export const JOINTLY_OPERATED_ROUTES: ReadonlySet<string> = new Set([
  "101", "101X", "102", "102P", "103", "104", "106", "106P", "107", "107P",
  "109", "110", "111", "111P", "112", "113", "115", "115P", "116", "117",
  "118", "118P", "170", "171", "171A", "171P", "182", "182X",
  "302", "302A", "307", "307A", "307P",
  "601", "601P", "606", "606A", "606X", "619", "619P", "619X", "621",
  "641", "671", "671X", "678", "680", "680B", "680P", "680X", "681",
  "681P", "690", "690P",
  "904", "905", "905A", "905P", "907B", "907C", "914", "914X",
  "948", "948A", "948B", "948E", "948P", "948X",
  "980A", "980X", "981P", "982X",
  "985", "985A", "985B",
]);

// Subset of JOINTLY_OPERATED_ROUTES where CTB's direction convention is
// reversed relative to KMB (KMB inbound == CTB outbound, and vice versa).
export const REVERSE_DIR_ROUTES: ReadonlySet<string> = new Set([
  "101", "101X", "103", "106", "106P", "107", "109", "111", "113",
  "115", "116", "117", "118", "170", "171", "182",
  "601", "601P", "606", "606X", "619", "641", "671", "680", "680X",
  "690", "904", "905", "982X",
]);
