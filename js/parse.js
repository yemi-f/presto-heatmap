// Parse + validate a Presto transaction-history CSV and aggregate it into per-station
// visit counts plus the overall date range.

import { normalize } from "./stations.js";

const REQUIRED_COLUMNS = ["Date", "Service Provider Name", "Location", "Type"];

export class CsvError extends Error {}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// "23 August 2026 12:47 p.m."  ->  Date
export function parsePrestoDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i
  );
  if (!m) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  const [, dd, mon, yyyy, hh, mm, ap] = m;
  const month = MONTHS[mon.toLowerCase()];
  if (month == null) return null;
  let hour = Number(hh) % 12;
  if (/p/i.test(ap)) hour += 12;
  return new Date(Number(yyyy), month, Number(dd), hour, Number(mm));
}

/**
 * @param {string} text  raw CSV file contents
 * @returns {{
 *   stations: Array<{key,canonical,visits,systems:string[],rawSamples:string[],first:Date,last:Date}>,
 *   dateRange: {start: Date|null, end: Date|null},
 *   counts: {rows:number, taps:number, skipped:number, stations:number}
 * }}
 */
export function parsePresto(text) {
  const parsed = window.Papa.parse(String(text).trim(), {
    header: true,
    skipEmptyLines: "greedy",
  });

  const rows = parsed.data || [];
  if (!rows.length) throw new CsvError("That file has no data rows.");

  // rawHeaders are the exact field names PapaParse used as row object keys;
  // lower is only for case/whitespace-tolerant matching against REQUIRED_COLUMNS.
  const rawHeaders = parsed.meta.fields || [];
  const lower = rawHeaders.map((h) => (h || "").trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(
    (c) => !lower.includes(c.toLowerCase())
  );
  if (missing.length) {
    throw new CsvError(
      `This doesn't look like a Presto transaction export — missing column${
        missing.length > 1 ? "s" : ""
      }: ${missing.join(", ")}.`
    );
  }

  // Resolve the real (untrimmed) header text for each required column, so it
  // matches the keys PapaParse actually put on each row — tolerates casing and
  // surrounding whitespace in the header cell itself.
  const col = {};
  for (const c of REQUIRED_COLUMNS) col[c] = rawHeaders[lower.indexOf(c.toLowerCase())];

  const stations = new Map();
  let start = null;
  let end = null;
  let taps = 0;
  let skipped = 0;

  for (const row of rows) {
    const provider = (row[col["Service Provider Name"]] || "").trim();
    const locationRaw = (row[col["Location"]] || "").trim();
    const when = parsePrestoDate(row[col["Date"]]);

    if (when) {
      if (!start || when < start) start = when;
      if (!end || when > end) end = when;
    }

    if (provider === "PRESTO System") {
      skipped++;
      continue; // card top-ups, no location
    }

    const norm = normalize(locationRaw);
    if (!norm) {
      skipped++;
      continue; // empty / "0" / GO fare zone
    }

    taps++;
    let entry = stations.get(norm.key);
    if (!entry) {
      entry = {
        key: norm.key,
        canonical: norm.canonical,
        visits: 0,
        systems: new Set(),
        rawSamples: new Set(),
        first: when,
        last: when,
      };
      stations.set(norm.key, entry);
    }
    entry.visits++;
    if (provider) entry.systems.add(provider);
    entry.rawSamples.add(locationRaw);
    if (when) {
      if (!entry.first || when < entry.first) entry.first = when;
      if (!entry.last || when > entry.last) entry.last = when;
    }
  }

  if (!stations.size) {
    throw new CsvError(
      "Parsed the file, but none of the rows had a usable station or stop name."
    );
  }

  return {
    stations: [...stations.values()]
      .map((s) => ({
        ...s,
        systems: [...s.systems],
        rawSamples: [...s.rawSamples],
      }))
      .sort((a, b) => b.visits - a.visits),
    dateRange: { start, end },
    counts: { rows: rows.length, taps, skipped, stations: stations.size },
  };
}
