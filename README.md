# Presto Heatmap

**A Strava-like heatmap of Presto card taps.** Upload a Presto (Toronto-area transit
card) transaction-history CSV; it geocodes every station or stop you tapped at and
renders a **heatmap weighted by how often you go there**, plus a ranked list and
the date range covered by the file.

No API keys or accounts needed: the map is [MapLibre GL](https://maplibre.org) with a custom
[VersaTiles](https://tiles.versatiles.org/) style (`assets/map-style.json`, free OpenStreetMap tiles),
and surface stops are geocoded with [Photon](https://photon.komoot.io) (OpenStreetMap data).

`assets/presto-sample.csv` is a small **synthetic** dataset used for the "Load sample data" button and the tests. The real
flow works with any valid Presto export.

![Presto Heatmap with the sample data loaded — heat over the Toronto–Hamilton GO corridor and a ranked station list in the sidebar](docs/screenshot.png)

---

## Quick start

1. **Serve the folder over HTTP** (ES modules + `fetch` don't work from `file://`):
   ```bash
   cd presto-heatmap
   python3 -m http.server 8000
   ```
   Any static server works (`npx serve`, VS Code Live Server, GitHub Pages, etc.).
2. Open <http://localhost:8000>.
3. Click **Load sample data**, or drag your own Presto CSV onto the drop zone.

Your CSV never leaves the browser. The only third-party requests are map tiles (VersaTiles)
and lookups of station/stop *names* that aren't in the built-in table (Photon).

---

## Getting your own Presto CSV

1. Sign in at <https://www.prestocard.ca>.
2. **Transaction History** → choose a date range → **Download** / export as CSV.
3. Drop that file on the app.

---

## Expected CSV format

Header row plus one row per transaction. Required columns (case/spacing tolerant):

| Column | Used for |
| --- | --- |
| `Date` | e.g. `23 August 2026 12:47 p.m.` — parsed for the overall date range |
| `Service Provider Name` | e.g. `Toronto Transit Commission` — shown as the "system"; `PRESTO System` rows (top-ups) are ignored |
| `Location` | station / stop name — the thing that gets mapped |
| `Type` | present-check only (kept for future filtering) |

Other columns in the standard export (`Sequence Number`, `Discount Sum`, `Amount`,
`Balance`) are ignored.

**Validation:** if the file has no data rows, or any required column is missing, the app
shows a clear error and renders nothing. A file that parses but has no usable location
names is also rejected.

**Rows that are counted but not mapped as their own point:**

- `Location` empty or `0`
- `Location` matching a GO fare zone like `Zone31` (not a place)
- `Service Provider Name` = `PRESTO System` (card loads)

---

## How it works

```
CSV text
  → parse.js      PapaParse → validate headers → per-location visit counts + date range
  → stations.js   normalize messy names ("Union Station - Northbound Platform Tow"
                  → "Union Station"), look up curated coordinates
  → geocode.js    curated hit? else localStorage cache? else Photon geocoder
  → app.js        build GeoJSON (weight = visits / maxVisits) → MapLibre heatmap +
                  circle layer + sidebar list + date-range summary
```

### Files

| File | Responsibility |
| --- | --- |
| `index.html` | Layout; loads the MapLibre stylesheet + PapaParse from CDN, then `js/app.js` (ES module) |
| `css/styles.css` | Dark theme matching the map; sidebar collapses above the map under 820 px |
| `js/parse.js` | `parsePresto(text)` → `{ stations, dateRange, counts }`; `parsePrestoDate()` |
| `js/stations.js` | `normalize(raw)`, `resolveCurated(raw, provider)`, `CURATED_STATIONS` table |
| `js/geocode.js` | `geocodeStations(stations, onProgress)` → `{ resolved, unresolved }` |
| `js/app.js` | Map setup (imports MapLibre as an ES module), upload wiring, rendering |
| `tests/` | `node:test` unit tests for `parse.js` / `stations.js` / `geocode.js` — see [Tests](#tests) |

### Name normalization (`stations.js`)

Presto location strings are inconsistent and often truncated at ~38 chars. `normalize()`:

- strips platform/direction noise — `Union Station - Northbound Platform Tow` → `Union Station`
- collapses GO rail suffixes — `Malton GO Station Rail` → `Malton GO`, `Union Station Rail` → `Union Station`
- rewrites intersections — `College St at Grace St` → `College St & Grace St`
- title-cases shouty TTC names — `ST CLAIR STATION` → `St Clair Station`
- applies explicit aliases — `Toronto- New USBT` → `Union Station Bus Terminal`,
  `Hamilton - HamiltonGOCentre At HunterSt` → `Hamilton GO Centre`

### Geocoding strategy (`geocode.js`)

For each unique location, in order:

1. **Curated table** — `CURATED_STATIONS` in `stations.js` covers all TTC subway stations,
   the four UP Express stops, ~35 GO stations, and everything in the sample file. Instant,
   offline, accurate. This is where the sample resolves 100%.
2. **`localStorage` cache** (`presto_geocode_cache_v2`) — previous Photon results, including
   misses, so re-uploads don't re-hit the API.
3. **[Photon](https://photon.komoot.io)** — free, keyless OpenStreetMap geocoder. Query is
   `"<canonical>, Toronto, Ontario, Canada"` with a downtown-Toronto `lat`/`lon` bias and a
   Greater-Golden-Horseshoe `bbox`. Used mainly for surface bus/streetcar stops like
   `Bay St & Queens Quay West`.

Requests run 2 at a time (the public Photon instance is fair-use) with a progress readout. Anything still unresolved is listed in the
**"Couldn't place"** panel with its visit count, so nothing disappears silently.

**To add a station**, drop an entry into `CURATED_STATIONS` keyed by the lowercased
normalized name, e.g.:

```js
["kennedy station", { lat: 43.7325, lng: -79.2635, canonical: "Kennedy Station", system: "TTC" }],
```

### Map layers (`app.js`)

- MapLibre GL with the VersaTiles style in `assets/map-style.json` (generated at
  <https://tiles.versatiles.org> with the "muted dark" theme; tiles, fonts and sprites are
  served keyless from `tiles.versatiles.org`). To change the look, generate a new style there
  and replace the file — no code changes needed. Fits to the data bounds on load.
- Both data layers are inserted before the style's empty `slot-below-labels` layer, so place
  names stay readable on top of the heat (falls back to top-of-stack if a style lacks it).
- **`stations-heat`** (heatmap): `heatmap-weight` interpolates `visits / maxVisits`;
  intensity & radius grow with zoom; opacity fades out past zoom 12 so individual points
  take over.
- **`stations-point`** (circles, from zoom 11): radius scales with `visits`; click → popup
  with name, visit count, system(s), and the first→last tap dates for that stop.
- Sidebar station list is click-to-fly-to; the header icon button hides/shows the sidebar
  (state persisted in `localStorage`).

---

## Known limitations

- Coordinates are approximate station centroids — fine for a heatmap, not for routing.
- TTC / GO / UP Express taps at Union are merged into one `Union Station` point (they're
  within ~150 m); this makes Union the natural hot spot, which is accurate.
- GO fare-zone rows (`Zone31`, …) can't be placed and are excluded from the map.
- Surface-stop geocoding depends on the public Photon instance (fair use, no SLA) and needs
  network access. OSM matches for intersections are usually close but not always exact.
  Results are cached per browser after the first lookup; for heavy traffic, consider
  self-hosting Photon and changing `PHOTON_URL` in `js/geocode.js`.
- `Bloor Station` is ambiguous (UP Express vs TTC Bloor-Yonge); it's disambiguated by the
  row's service provider.

---

## Tests

Automated unit tests use Node's built-in test runner (`node:test`) — no browser and no
network required.

```bash
npm install   # pulls in PapaParse as a dev dependency, for tests/parse.test.js
npm test
```

| File | Covers |
| --- | --- |
| `tests/stations.test.js` | `normalize()` (truncation stripping, GO/intersection rewrites, alias table, non-place filtering) and `resolveCurated()` (curated hits, uncurated misses, the Bloor Station TTC/UP disambiguation, and a sanity check that every curated entry has plausible southern-Ontario coordinates) |
| `tests/parse.test.js` | `parsePrestoDate()`; `parsePresto()` validation (missing columns, no data rows, nothing geocodable, tolerant header casing/whitespace); the [5-row fixture](tests/fixtures/presto-5-rows.csv) and the full sample (62 rows → 56 taps across 5 stations, `3 Jun – 7 Sep 2026`, Union Station top at 28) |
| `tests/geocode.test.js` | `geocodeStations()` with `fetch`/`localStorage` mocked: curated stations skip the network, uncurated ones call Photon and get cached, no-match / HTTP-error / offline responses land in `unresolved` with a reason, and every input station ends up counted exactly once |

`tests/fixtures/presto-5-rows.csv` is the header plus the first 5 data rows of
`assets/presto-sample.csv`, used as a small hand-checkable fixture alongside the full sample.

Manual end-to-end check: serve the folder, click **Load sample
data** → heatmap over the Toronto–Hamilton GO corridor, Union Station hottest, summary line
shows `56 taps · 3 Jun 2026 – 7 Sep 2026`; zoom in for circles + popups; drag the CSV
file itself for the same result; drag an unrelated CSV for a validation error.
