// Turn aggregated stations into coordinates: curated table first, then a
// localStorage cache, then the Mapbox Geocoding API. Results (including misses)
// are cached so repeat uploads don't re-hit the API.

import { resolveCurated } from "./stations.js";

const CACHE_KEY = "presto_geocode_cache_v1";
const PROXIMITY = "-79.3832,43.6532"; // downtown Toronto
const BBOX = "-80.9,42.8,-78.2,44.6"; // Greater Golden Horseshoe-ish
const CONCURRENCY = 4;

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

async function mapboxGeocode(query, token) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      query
    )}.json?access_token=${encodeURIComponent(token)}` +
    `&country=ca&language=en&limit=1&types=poi,address,place,neighborhood` +
    `&proximity=${PROXIMITY}&bbox=${BBOX}`;

  const res = await fetch(url);
  if (!res.ok) {
    const detail = res.status === 401 ? " (token rejected)" : "";
    throw new Error(`Mapbox geocoding failed: ${res.status}${detail}`);
  }
  const json = await res.json();
  const feature = json.features && json.features[0];
  if (!feature) return null;
  return { lng: feature.center[0], lat: feature.center[1], place: feature.place_name };
}

/**
 * @param {Array} stations  from parsePresto().stations
 * @param {string} token     Mapbox public token
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{resolved: Array, unresolved: Array}>}
 */
export async function geocodeStations(stations, token, onProgress) {
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

    const hit = await mapboxGeocode(
      `${station.canonical}, Toronto, Ontario, Canada`,
      token
    );
    const value = hit ? { lat: hit.lat, lng: hit.lng, place: hit.place } : null;
    cache[station.key] = value;
    cacheDirty = true;
    return value ? { ...value, source: "mapbox" } : null;
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
