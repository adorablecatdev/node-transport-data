import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";
import { delay } from "./http.js";

const MAX_ATTEMPTS = 5;
const RETRY_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

const inflateRawAsync = promisify(inflateRaw);

export async function fetchGtfsZip(url: string, logTag: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "node-transport-data/0.1 (+https://github.com/local)",
          Accept: "application/zip, application/octet-stream, */*",
        },
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (!RETRY_STATUSES.has(res.status)) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 500 * 2 ** (attempt - 1);
      console.warn(`[${logTag}] attempt ${attempt} failed; retrying in ${backoff}ms`);
      await delay(backoff);
    }
  }
  throw lastError;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEocd(zip: Buffer): number {
  const scanFrom = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= scanFrom; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("Not a valid ZIP archive (EOCD not found)");
}

export async function extractZipEntries(
  zip: Buffer,
  wanted: Set<string>,
): Promise<Map<string, string>> {
  const eocd = findEocd(zip);
  const cdEntries = zip.readUInt16LE(eocd + 10);
  const cdOffset = zip.readUInt32LE(eocd + 16);

  const files = new Map<string, string>();
  let p = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    if (zip.readUInt32LE(p) !== CDH_SIG) throw new Error(`Bad central directory signature at ${p}`);
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (!wanted.has(name)) continue;

    if (zip.readUInt32LE(localOffset) !== LFH_SIG) {
      throw new Error(`Bad local file header signature for ${name}`);
    }
    const lfhNameLen = zip.readUInt16LE(localOffset + 26);
    const lfhExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
    const raw = zip.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = (await inflateRawAsync(raw)) as Buffer;
    else throw new Error(`Unsupported compression method ${method} for ${name}`);

    files.set(name, data.toString("utf8"));
  }

  for (const name of wanted) {
    if (!files.has(name)) throw new Error(`Missing ${name} in GTFS archive`);
  }
  return files;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else if (c === '"') {
      inQ = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv<T extends Record<string, string>>(text: string): T[] {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = stripped.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const first = lines[0];
  if (!first) return [];
  const headers = parseCsvLine(first);
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (h === undefined) continue;
      row[h] = values[j] ?? "";
    }
    rows.push(row as T);
  }
  return rows;
}
