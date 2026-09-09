// Unit tests for js/geocode.js. It talks to `localStorage` and `fetch` directly
// (as it does in the browser), so we shim both before importing it — no real
// network calls happen in this file.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  #store = new Map();
  getItem(key) {
    return this.#store.has(key) ? this.#store.get(key) : null;
  }
  setItem(key, value) {
    this.#store.set(key, String(value));
  }
  removeItem(key) {
    this.#store.delete(key);
  }
  clear() {
    this.#store.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

/** @type {Array<string>} URLs every mocked fetch() call received */
let fetchCalls;
/** @type {(url: string) => Promise<Response> | Response} */
let fetchImpl;

globalThis.fetch = (url) => {
  fetchCalls.push(url);
  return fetchImpl(url);
};

const { geocodeStations } = await import("../js/geocode.js");

// A mock Mapbox Geocoding API response landing near downtown Toronto.
function mockGeocodeOk(lng = -79.39, lat = 43.65, place = "Mock Place, Toronto, ON") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ features: [{ center: [lng, lat], place_name: place }] }),
  };
}

function station({ key, canonical, raw, provider, visits = 1 }) {
  return {
    key,
    canonical,
    visits,
    systems: [provider],
    rawSamples: [raw ?? canonical],
    first: null,
    last: null,
  };
}

beforeEach(() => {
  localStorage.clear();
  fetchCalls = [];
  fetchImpl = () => mockGeocodeOk();
});

describe("geocodeStations()", () => {
  test("resolves curated stations without touching the network", async () => {
    const stClair = station({
      key: "st clair station",
      canonical: "St Clair Station",
      raw: "ST CLAIR STATION",
      provider: "Toronto Transit Commission",
    });

    const { resolved, unresolved } = await geocodeStations([stClair], "pk.test");

    assert.equal(unresolved.length, 0);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].source, "curated");
    assert.equal(typeof resolved[0].lat, "number");
    assert.equal(typeof resolved[0].lng, "number");
    assert.equal(fetchCalls.length, 0);
  });

  test("falls back to the Mapbox Geocoding API for uncurated locations", async () => {
    const intersection = station({
      key: "college st & grace st",
      canonical: "College St & Grace St",
      provider: "Toronto Transit Commission",
    });

    const { resolved, unresolved } = await geocodeStations([intersection], "pk.test");

    assert.equal(unresolved.length, 0);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].source, "mapbox");
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], /^https:\/\/api\.mapbox\.com\/geocoding\/v5\/mapbox\.places\//);
    assert.match(fetchCalls[0], /access_token=pk\.test/);
  });

  test("caches Mapbox results across calls so a repeat lookup skips the network", async () => {
    const intersection = station({
      key: "queen st west & john st",
      canonical: "Queen St West & John St",
      provider: "Toronto Transit Commission",
    });

    await geocodeStations([intersection], "pk.test");
    assert.equal(fetchCalls.length, 1);

    await geocodeStations([station({ ...intersection })], "pk.test");
    assert.equal(fetchCalls.length, 1, "second lookup should hit the cache, not fetch again");
  });

  test("marks a location unresolved when the API returns no features", async () => {
    fetchImpl = () => ({ ok: true, status: 200, json: async () => ({ features: [] }) });
    const nowhere = station({
      key: "nowhere in particular",
      canonical: "Nowhere In Particular",
      provider: "Toronto Transit Commission",
    });

    const { resolved, unresolved } = await geocodeStations([nowhere], "pk.test");

    assert.equal(resolved.length, 0);
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].key, "nowhere in particular");
    assert.equal(unresolved[0].reason, "no match");
  });

  test("marks a location unresolved (with a reason) on an HTTP error", async () => {
    fetchImpl = () => ({ ok: false, status: 401 });
    const s = station({
      key: "somewhere",
      canonical: "Somewhere",
      provider: "Toronto Transit Commission",
    });

    const { resolved, unresolved } = await geocodeStations([s], "pk.bad-token");

    assert.equal(resolved.length, 0);
    assert.equal(unresolved.length, 1);
    assert.match(unresolved[0].reason, /401/);
  });

  test("marks a location unresolved when fetch itself rejects (offline)", async () => {
    fetchImpl = () => Promise.reject(new Error("network down"));
    const s = station({
      key: "somewhere-else",
      canonical: "Somewhere Else",
      provider: "Toronto Transit Commission",
    });

    const { resolved, unresolved } = await geocodeStations([s], "pk.test");

    assert.equal(resolved.length, 0);
    assert.equal(unresolved.length, 1);
    assert.match(unresolved[0].reason, /network down/);
  });

  test("every input station ends up in exactly one of resolved/unresolved", async () => {
    fetchImpl = (url) =>
      /Fails/.test(decodeURIComponent(url))
        ? { ok: true, status: 200, json: async () => ({ features: [] }) }
        : mockGeocodeOk();

    const stations = [
      station({ key: "st clair station", canonical: "St Clair Station", raw: "ST CLAIR STATION", provider: "Toronto Transit Commission" }),
      station({ key: "a", canonical: "College St & A St", provider: "TTC" }),
      station({ key: "b", canonical: "College St & B St", provider: "TTC" }),
      station({ key: "c-fails", canonical: "College St & Fails St", provider: "TTC" }),
    ];

    const { resolved, unresolved } = await geocodeStations(stations, "pk.test");

    assert.equal(resolved.length + unresolved.length, stations.length);
    const seenKeys = new Set([...resolved, ...unresolved].map((s) => s.key));
    assert.equal(seenKeys.size, stations.length);
  });

  test("reports progress once per station via onProgress", async () => {
    const stations = [
      station({ key: "x1", canonical: "X1 St & Y St", provider: "TTC" }),
      station({ key: "x2", canonical: "X2 St & Y St", provider: "TTC" }),
      station({ key: "x3", canonical: "X3 St & Y St", provider: "TTC" }),
    ];
    const ticks = [];
    await geocodeStations(stations, "pk.test", (done, total) => ticks.push([done, total]));

    assert.equal(ticks.length, stations.length);
    assert.deepEqual(
      ticks.map((t) => t[1]),
      stations.map(() => stations.length)
    );
    assert.deepEqual(
      ticks.map((t) => t[0]).sort((a, b) => a - b),
      [1, 2, 3]
    );
  });
});
