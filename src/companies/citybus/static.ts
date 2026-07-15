// CTB routes that are circular. For these routes:
// - routes.json emits only the outbound record (no inbound record).
// - route-stops.json emits only the outbound record; inbound stops are
//   appended after the outbound stops with continued seq numbering.
export const CTB_CIRCULAR_ROUTES: ReadonlySet<string> = new Set([
  "1M", "4", "4X", "11", "12", "12A", "12M", "12S", "14",
  "22D", "22M", "22X", "25", "25A", "25C", "26", "27",
  "37A", "37B", "37X", "43M", "43R", "48", "50M", "60R",
  "73A", "76", "78", "82X", "85", "92", "94A", "95", "110"
]);
