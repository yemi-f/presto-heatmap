// Unit tests for js/stations.js — pure functions, no globals required.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalize, resolveCurated, CURATED_STATIONS } from "../js/stations.js";

describe("normalize()", () => {
  test("strips platform/direction junk", () => {
    assert.deepEqual(normalize("Union Station - Northbound Platform Tow"), {
      canonical: "Union Station",
      key: "union station",
    });
  });

  test("collapses GO rail suffixes", () => {
    assert.equal(normalize("Malton GO Station Rail").canonical, "Malton GO");
    assert.equal(normalize("Union Station Rail").canonical, "Union Station");
    assert.equal(normalize("West Harbour GO Rail").canonical, "West Harbour GO");
  });

  test("rewrites intersections", () => {
    assert.equal(
      normalize("College St at Grace St").canonical,
      "College St & Grace St"
    );
    assert.equal(
      normalize("DERRY RD at DIXIE RD").canonical,
      "Derry Rd & Dixie Rd"
    );
  });

  test("strips trailing directional-side junk", () => {
    assert.equal(
      normalize("Bay St at Queens Quay West North Side -").canonical,
      "Bay St & Queens Quay West"
    );
  });

  test("title-cases shouty TTC names", () => {
    assert.equal(normalize("ST CLAIR STATION").canonical, "St Clair Station");
    assert.equal(normalize("TMU STATION").canonical, "TMU Station");
  });

  test("applies explicit aliases", () => {
    assert.equal(
      normalize("Toronto- New USBT").canonical,
      "Union Station Bus Terminal"
    );
    assert.equal(
      normalize("Hamilton - HamiltonGOCentre At HunterSt").canonical,
      "Hamilton GO Centre"
    );
    assert.equal(
      normalize("Hamilton Go Station Rail").canonical,
      "Hamilton GO Centre"
    );
  });

  test("merges TTC/GO/UP Union Station taps into one canonical name", () => {
    for (const raw of [
      "Union Station",
      "Union Station Rail",
      "Union Station - Northbound Platform Tow",
    ]) {
      assert.equal(normalize(raw).key, "union station");
    }
  });

  test("returns null for non-places", () => {
    assert.equal(normalize(""), null);
    assert.equal(normalize("   "), null);
    assert.equal(normalize("0"), null);
    assert.equal(normalize("Zone31"), null);
    assert.equal(normalize("Zone2"), null);
    assert.equal(normalize(null), null);
    assert.equal(normalize(undefined), null);
  });

  test("collapses internal whitespace", () => {
    assert.equal(normalize("  ST   CLAIR   STATION  ").canonical, "St Clair Station");
  });
});

describe("resolveCurated()", () => {
  test("resolves a known TTC station with coordinates", () => {
    const hit = resolveCurated("ST CLAIR STATION", "Toronto Transit Commission");
    assert.ok(hit);
    assert.equal(hit.canonical, "St Clair Station");
    assert.equal(typeof hit.lat, "number");
    assert.equal(typeof hit.lng, "number");
  });

  test("resolves GO and UP Express stations", () => {
    assert.ok(resolveCurated("Pearson Station", "Union Pearson Express"));
    assert.ok(resolveCurated("Malton GO Station Rail", "GO Transit"));
    assert.ok(resolveCurated("Union Station Rail", "GO Transit"));
  });

  test("returns null for a surface stop that needs geocoding", () => {
    assert.equal(
      resolveCurated("College St at Grace St", "Toronto Transit Commission"),
      null
    );
  });

  test("returns null for non-places", () => {
    assert.equal(resolveCurated("0", "Toronto Transit Commission"), null);
    assert.equal(resolveCurated("Zone31", "GO Transit"), null);
  });

  test("disambiguates Bloor Station by service provider", () => {
    const up = resolveCurated("Bloor Station", "Union Pearson Express");
    const ttc = resolveCurated("Bloor Station", "Toronto Transit Commission");
    assert.ok(up);
    assert.ok(ttc);
    assert.notDeepEqual(
      { lat: up.lat, lng: up.lng },
      { lat: ttc.lat, lng: ttc.lng }
    );
    assert.equal(ttc.canonical, "Bloor-Yonge Station");
  });

  test("every curated entry has finite coordinates", () => {
    for (const [key, s] of Object.entries(CURATED_STATIONS)) {
      assert.ok(Number.isFinite(s.lat), `${key} has a numeric lat`);
      assert.ok(Number.isFinite(s.lng), `${key} has a numeric lng`);
      assert.ok(s.lat > 40 && s.lat < 47, `${key} lat looks like southern Ontario`);
      assert.ok(s.lng < -76 && s.lng > -82, `${key} lng looks like southern Ontario`);
    }
  });
});
