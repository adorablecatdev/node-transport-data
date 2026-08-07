import type { Timetable } from "./types.js";

// Merge per-company Timetable slices into one. Keys are `${company}-...` so
// collisions across slices shouldn't happen; when they do, concatenate the
// variant arrays so nothing is silently dropped.
export function mergeTimetables(slices: Timetable[]): Timetable {
  const merged: Timetable = {};
  for (const slice of slices) {
    for (const [key, variants] of Object.entries(slice)) {
      const existing = merged[key];
      if (existing) existing.push(...variants);
      else merged[key] = [...variants];
    }
  }
  return merged;
}
