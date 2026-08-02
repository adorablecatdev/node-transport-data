// Shared helpers for the *-gtfs-map targets. Both KMB and CTB compare
// GTFS route_long_name against the operator's own TC origin/destination
// strings, so normalization, "FROM - TO" splitting, and fuzzy similarity all
// live here.

// Strip anything that isn't a letter or digit (Unicode-aware) so " ", "-",
// "(", ")", "、", "／", full-width punctuation, etc. all collapse away before
// compare.
export function normalize(s: string): string {
  return s.replace(/[^\p{L}\p{N}]/gu, "");
}

// route_long_name is "<FROM> - <TO>" in Traditional Chinese in the pt-headway
// GTFS feed. Some entries contain further parenthetical suffixes with more
// "-" chars (e.g. "翔東邨 - 機場(貨運及航膳區)(循環線)(經東涌發展碼頭)"), so
// keep the first "-" as the split point and let the rest become TO.
export function splitFromTo(longName: string): { from: string; to: string } | undefined {
  const idx = longName.indexOf("-");
  if (idx < 0) return undefined;
  return {
    from: longName.slice(0, idx),
    to: longName.slice(idx + 1),
  };
}

// Iterative Wagner–Fischer over two rolling rows. Strings are short (Chinese
// place names, typically < 20 chars) so O(m*n) is fine.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

// 1.0 = identical, 0.0 = fully different. Length-normalized so long strings
// aren't unfairly penalised for having room for more edits.
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Minimum avg-of-(sim_from, sim_to) required for a fuzzy match to be accepted.
// Route number already matches exactly, so 0.6 catches typos + extra
// "(循環線)"-style suffixes without letting through unrelated same-number
// routes. Bump higher for stricter matching, lower to accept more. Applies to
// both kmb-gtfs-map and ctb-gtfs-map; borderline rejects are surfaced in each
// company's gtfs-unmapped.csv with their scores so you can see the impact.
export const FUZZY_THRESHOLD = 0.3;

// RFC 4180 CSV field quoting. GTFS Chinese names occasionally contain ASCII
// commas inside parentheses (e.g. "(不經麗晶花園及啟業, 不停曲街)"), so bare
// comma joins would produce malformed CSV; wrap when needed and escape inner
// quotes by doubling.
export function csvField(v: string | number): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(fields: Array<string | number>): string {
  return fields.map(csvField).join(",");
}
