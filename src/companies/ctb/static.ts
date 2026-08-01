// CTB routes that are circular. For these routes:
// - routes.json emits only the outbound record (no inbound record).
// - route-stops.json emits only the outbound record; inbound stops are
//   appended after the outbound stops with continued seq numbering.
export const CTB_CIRCULAR_ROUTES: ReadonlySet<string> = new Set([
  "110"
]);
