// Unit tests for js/parse.js. parsePresto() calls window.Papa.parse(), so we shim
// `window` with the real PapaParse before importing it — same library the browser
// loads from a CDN in index.html.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Papa from "papaparse";

globalThis.window = { Papa };

const { parsePresto, parsePrestoDate, CsvError } = await import("../js/parse.js");

const sampleCsv = readFileSync(new URL("../Presto_Transaction_history.csv", import.meta.url), "utf8");
const fiveRowCsv = readFileSync(new URL("./fixtures/presto-5-rows.csv", import.meta.url), "utf8");

describe("parsePrestoDate()", () => {
  test("parses Presto's 'D Month YYYY h:mm a.m./p.m.' format", () => {
    const d = parsePrestoDate("23 August 2026 12:47 p.m.");
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 7); // August = index 7
    assert.equal(d.getDate(), 23);
    assert.equal(d.getHours(), 12);
    assert.equal(d.getMinutes(), 47);
  });

  test("handles a.m. and 12-hour rollover correctly", () => {
    const am = parsePrestoDate("15 August 2026 08:05 a.m.");
    assert.equal(am.getHours(), 8);

    const pmRollover = parsePrestoDate("15 August 2026 09:57 p.m.");
    assert.equal(pmRollover.getHours(), 21);

    const noonPm = parsePrestoDate("1 January 2026 12:00 p.m.");
    assert.equal(noonPm.getHours(), 12);

    const midnightAm = parsePrestoDate("1 January 2026 12:00 a.m.");
    assert.equal(midnightAm.getHours(), 0);
  });

  test("returns null for empty or unparseable input", () => {
    assert.equal(parsePrestoDate(""), null);
    assert.equal(parsePrestoDate(null), null);
    assert.equal(parsePrestoDate("not a date"), null);
  });
});

describe("parsePresto() — validation", () => {
  test("rejects a CSV missing required columns", () => {
    assert.throws(() => parsePresto("foo,bar\n1,2\n"), CsvError);
  });

  test("rejects a CSV with a header but no data rows", () => {
    assert.throws(
      () => parsePresto("Date,Service Provider Name,Location,Type\n"),
      CsvError
    );
  });

  test("rejects a CSV where nothing resolves to a usable location", () => {
    const csv =
      'Date,Sequence Number,Service Provider Name,Location,Type,Discount Sum,Amount,Balance\n' +
      '"1 January 2026 09:00 a.m.","0","PRESTO System","","Load Amount","0","$50.00","$50.00"\n';
    assert.throws(() => parsePresto(csv), CsvError);
  });

  test("tolerates header casing/whitespace differences", () => {
    const csv =
      ' date , service provider name , location , type \n' +
      '"1 January 2026 09:00 a.m.","Toronto Transit Commission","ST CLAIR STATION","Fare Payment"\n';
    const result = parsePresto(csv);
    assert.equal(result.counts.taps, 1);
  });
});

describe("parsePresto() — the 5-row fixture", () => {
  let result;
  before(() => {
    result = parsePresto(fiveRowCsv);
  });

  test("counts rows/taps/skips correctly", () => {
    // St Clair (TTC), Union Station (TTC), PRESTO top-up (skipped),
    // Union Station Rail (GO), West Harbour GO Rail (GO)
    assert.equal(result.counts.rows, 5);
    assert.equal(result.counts.taps, 4);
    assert.equal(result.counts.skipped, 1);
    assert.equal(result.counts.stations, 3);
  });

  test("merges the two Union Station taps into one entry", () => {
    const union = result.stations.find((s) => s.key === "union station");
    assert.ok(union);
    assert.equal(union.visits, 2);
    assert.ok(union.systems.includes("Toronto Transit Commission"));
    assert.ok(union.systems.includes("GO Transit"));
  });

  test("computes the date range across the 5 rows", () => {
    const { start, end } = result.dateRange;
    assert.equal(start.getTime(), new Date(2026, 7, 15, 20, 5).getTime());
    assert.equal(end.getTime(), new Date(2026, 7, 23, 12, 47).getTime());
  });

  test("stations are sorted by visit count descending", () => {
    const visits = result.stations.map((s) => s.visits);
    assert.deepEqual(visits, [...visits].sort((a, b) => b - a));
  });
});

describe("parsePresto() — the full sample file", () => {
  let result;
  before(() => {
    result = parsePresto(sampleCsv);
  });

  test("matches the documented counts", () => {
    assert.equal(result.counts.rows, 110);
    assert.equal(result.counts.taps, 99);
    assert.equal(result.counts.stations, 22);
  });

  test("covers the documented date range", () => {
    assert.equal(
      result.dateRange.start.getTime(),
      new Date(2025, 10, 30, 12, 10).getTime()
    );
    assert.equal(
      result.dateRange.end.getTime(),
      new Date(2026, 7, 23, 12, 47).getTime()
    );
  });

  test("Union Station is the most-visited location", () => {
    assert.equal(result.stations[0].key, "union station");
    assert.equal(result.stations[0].visits, 38);
  });
});
