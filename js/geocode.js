// Turn aggregated stations into coordinates: curated table first, then a
// localStorage cache, then the Photon geocoder (OpenStreetMap data, no API key).
// Results (including misses) are cached so repeat uploads don't re-hit the API.

import { resolveCurated } from "./stations.js";

const CACHE_KEY = "presto_geocode_cache_v2"; // v1 held the previous geocoder's results
const PHOTON_URL = "https://photon.komoot.io/api/";
const PROXIMITY = { lat: "43.6532", lon: "-79.3832" }; // downtown Toronto
const BBOX = "-80.9,42.8,-78.2,44.6"; // Greater Golden Horseshoe-ish
const CONCURRENCY = 2; // public, free instance — keep it gentle

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* private mode / quota — geocoding still works, just no caching */
  }
}

async function photonGeocode(query) {
  const params = new URLSearchParams({
    q: query,
    limit: "1",
    lang: "en",
    lat: PROXIMITY.lat,
    lon: PROXIMITY.lon,
    bbox: BBOX,
  });

  const res = await fetch(`${PHOTON_URL}?${params}`);
  if (!res.ok) throw new Error(`Photon geocoding failed: ${res.status}`);
  const json = await res.json();
  const feature = json.features && json.features[0];
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates;
  const p = feature.properties || {};
  const place = [p.name, p.street, p.city].filter(Boolean).join(", ");
  return { lng, lat, place };
}

/**
 * @param {Array} stations  from parsePresto().stations
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{resolved: Array, unresolved: Array}>}
 */
export async function geocodeStations(stations, onProgress) {
  const cache = loadCache();
  const resolved = [];
  const unresolved = [];
  const queue = [...stations];
  let done = 0;
  let cacheDirty = false;

  async function locate(station) {
    const raw = station.rawSamples[0] || station.canonical;
    const provider = station.systems[0] || "";

    const curated = resolveCurated(raw, provider);
    if (curated) {
      return { lat: curated.lat, lng: curated.lng, source: "curated" };
    }

    if (Object.prototype.hasOwnProperty.call(cache, station.key)) {
      const cached = cache[station.key];
      return cached ? { ...cached, source: "cache" } : null;
    }

    const hit = await photonGeocode(`${station.canonical}, Toronto, Ontario, Canada`);
    const value = hit ? { lat: hit.lat, lng: hit.lng, place: hit.place } : null;
    cache[station.key] = value;
    cacheDirty = true;
    return value ? { ...value, source: "photon" } : null;
  }

  async function worker() {
    while (queue.length) {
      const station = queue.shift();
      try {
        const r = await locate(station);
        if (r && r.lat != null && r.lng != null) {
          resolved.push({ ...station, lat: r.lat, lng: r.lng, source: r.source, place: r.place });
        } else {
          unresolved.push({ ...station, reason: "no match" });
        }
      } catch (err) {
        unresolved.push({ ...station, reason: err.message || String(err) });
      }
      done++;
      onProgress && onProgress(done, stations.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, stations.length || 1) }, worker)
  );

  if (cacheDirty) saveCache(cache);
  return { resolved, unresolved };
}
