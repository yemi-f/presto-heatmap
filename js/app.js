// Wires the UI together: token -> map -> (CSV upload) -> parse -> geocode ->
// GeoJSON heatmap + sidebar.

import { parsePresto, CsvError } from "./parse.js";
import { geocodeStations } from "./geocode.js";

const $ = (sel) => document.querySelector(sel);
const els = {
  tokenSection: $("#token-section"),
  tokenInput: $("#token-input"),
  tokenRemember: $("#token-remember"),
  tokenSave: $("#token-save"),
  dropzone: $("#dropzone"),
  fileInput: $("#file-input"),
  browse: $("#browse"),
  sampleBtn: $("#sample-btn"),
  status: $("#status"),
  summarySection: $("#summary-section"),
  summaryLine: $("#summary-line"),
  stationsSection: $("#stations-section"),
  stationCount: $("#station-count"),
  stationList: $("#station-list"),
  unresolvedSection: $("#unresolved-section"),
  unresolvedCount: $("#unresolved-count"),
  unresolvedList: $("#unresolved-list"),
  legend: $("#legend"),
};

const TOKEN_KEY = "presto_mapbox_token";
const TORONTO = [-79.3832, 43.6532];
const HEATMAP_COLOR = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(33,102,172,0)",
  0.2, "rgb(103,169,207)",
  0.4, "rgb(209,229,240)",
  0.6, "rgb(253,219,199)",
  0.8, "rgb(239,138,98)",
  1, "rgb(178,24,43)",
];

let map = null;
let mapReady = false;
let pendingData = null;
let activePopup = null; // only one open at a time

function setStatus(msg, kind = "") {
  els.status.textContent = msg || "";
  els.status.className = "status" + (kind ? " " + kind : "");
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------- token ----------

function getToken() {
  const fromConfig = (window.MAPBOX_TOKEN || "").trim();
  if (fromConfig) return fromConfig;
  try {
    return (localStorage.getItem(TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function initTokenUI(onReady) {
  els.tokenSection.hidden = false;
  setStatus("Add a Mapbox token to begin.");
  els.tokenSave.addEventListener("click", () => {
    const t = els.tokenInput.value.trim();
    if (!/^pk\./.test(t)) {
      setStatus("That doesn't look like a public token (it should start with 'pk.').", "error");
      return;
    }
    if (els.tokenRemember.checked) {
      try {
        localStorage.setItem(TOKEN_KEY, t);
      } catch {
        /* private mode — token stays in memory only */
      }
    }
    els.tokenSection.hidden = true;
    setStatus("");
    onReady(t);
  });
}

// ---------- map ----------

function initMap(token) {
  mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: TORONTO,
    zoom: 9,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource("stations", { type: "geojson", data: emptyFC() });

    map.addLayer({
      id: "stations-heat",
      type: "heatmap",
      source: "stations",
      maxzoom: 17,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0.12, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 1, 15, 3],
        "heatmap-color": HEATMAP_COLOR,
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 14, 15, 40],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 17, 0.35],
      },
    });

    map.addLayer({
      id: "stations-point",
      type: "circle",
      source: "stations",
      minzoom: 11,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "visits"], 1, 4, 40, 22],
        "circle-color": "rgb(239,138,98)",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.15, 13, 0.85],
      },
    });

    map.on("click", "stations-point", (e) => {
      const f = e.features[0];
      showPopup(f.geometry.coordinates.slice(), f.properties);
    });
    map.on("mouseenter", "stations-point", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "stations-point", () => (map.getCanvas().style.cursor = ""));

    mapReady = true;
    if (pendingData) {
      applyData(pendingData);
      pendingData = null;
    }
  });

  map.on("error", (e) => {
    const m = (e && e.error && e.error.message) || "";
    if (/access token|401|unauthorized|not authorized/i.test(m)) {
      setStatus("Mapbox rejected that token. Fix it and reload the page.", "error");
    }
  });
}

const emptyFC = () => ({ type: "FeatureCollection", features: [] });

function showPopup(lngLat, props) {
  if (activePopup) activePopup.remove(); // keep at most one open

  const visits = Number(props.visits);
  const systems = props.systems ? ` · ${props.systems}` : "";
  activePopup = new mapboxgl.Popup({ closeButton: true, offset: 10 })
    .setLngLat(lngLat)
    .setHTML(
      `<h3>${escapeHtml(props.name)}</h3>` +
        `<p><span class="v">${visits}</span> visit${visits === 1 ? "" : "s"}${escapeHtml(systems)}</p>` +
        (props.span ? `<p>${escapeHtml(props.span)}</p>` : "")
    )
    .addTo(map);
  activePopup.on("close", () => {
    activePopup = null;
  });
}

// ---------- pipeline ----------

async function handleCsvText(text, label) {
  let parsed;
  try {
    parsed = parsePresto(text);
  } catch (err) {
    setStatus(
      err instanceof CsvError ? err.message : "Couldn't read that file as CSV.",
      "error"
    );
    return;
  }

  setStatus(
    `Parsed ${parsed.counts.taps.toLocaleString()} taps at ${parsed.counts.stations} locations. Geocoding…`,
    "working"
  );

  const { resolved, unresolved } = await geocodeStations(
    parsed.stations,
    mapboxgl.accessToken,
    (done, total) => setStatus(`Geocoding ${done}/${total}…`, "working")
  );

  renderUnresolved(unresolved);

  if (!resolved.length) {
    setStatus("Couldn't place any of the locations on the map.", "error");
    return;
  }

  const fc = toGeoJSON(resolved);
  if (mapReady) applyData(fc);
  else pendingData = fc;

  renderSummary(parsed, resolved.length, unresolved.length);
  renderStationList(resolved);

  const missed = unresolved.length ? `, ${unresolved.length} skipped` : "";
  setStatus(
    `${label ? label + " — " : ""}${resolved.length} location${
      resolved.length === 1 ? "" : "s"
    } mapped${missed}.`,
    "ok"
  );
}

function toGeoJSON(resolved) {
  const maxVisits = Math.max(...resolved.map((s) => s.visits));
  return {
    type: "FeatureCollection",
    features: resolved.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: {
        name: s.canonical,
        visits: s.visits,
        weight: s.visits / maxVisits,
        systems: s.systems.join(", "),
        span: spanText(s.first, s.last),
      },
    })),
  };
}

function applyData(fc) {
  const src = map.getSource("stations");
  if (src) src.setData(fc);
  if (!fc.features.length) return;
  const bb = new mapboxgl.LngLatBounds();
  fc.features.forEach((f) => bb.extend(f.geometry.coordinates));
  map.fitBounds(bb, { padding: 60, maxZoom: 13, duration: 700 });
}

// ---------- sidebar ----------

function fmtDate(d) {
  return d instanceof Date && !isNaN(d)
    ? d.toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric" })
    : "?";
}

function spanText(a, b) {
  if (!(a instanceof Date) && !(b instanceof Date)) return "";
  if (a && b && a.getTime() === b.getTime()) return `on ${fmtDate(a)}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

function renderSummary(parsed, placed, missed) {
  const { start, end } = parsed.dateRange;
  const range = start && end ? `${fmtDate(start)} – ${fmtDate(end)}` : "date range unknown";
  els.summaryLine.innerHTML =
    `<span class="big">${parsed.counts.taps.toLocaleString()} taps</span>` +
    `<span class="range">${escapeHtml(range)}</span><br>` +
    `<span class="range">${placed} location${placed === 1 ? "" : "s"} mapped` +
    (missed ? `, ${missed} unplaced` : "") +
    `</span>`;
  els.summarySection.hidden = false;
}

function renderStationList(resolved) {
  els.stationList.innerHTML = "";
  resolved
    .slice()
    .sort((a, b) => b.visits - a.visits)
    .forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="name">${escapeHtml(s.canonical)}` +
        `<span class="sys">${escapeHtml(s.systems.join(", "))}</span></span>` +
        `<span class="count">${s.visits}</span>`;
      li.addEventListener("click", () => {
        map.flyTo({ center: [s.lng, s.lat], zoom: 14, duration: 800 });
        showPopup([s.lng, s.lat], {
          name: s.canonical,
          visits: s.visits,
          systems: s.systems.join(", "),
          span: spanText(s.first, s.last),
        });
      });
      els.stationList.appendChild(li);
    });
  els.stationCount.textContent = resolved.length;
  els.stationsSection.hidden = false;
  els.legend.hidden = false;
}

function renderUnresolved(unresolved) {
  if (!unresolved.length) {
    els.unresolvedSection.hidden = true;
    return;
  }
  els.unresolvedList.innerHTML = "";
  unresolved.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = `${s.rawSamples[0] || s.canonical} (${s.visits})`;
    els.unresolvedList.appendChild(li);
  });
  els.unresolvedCount.textContent = unresolved.length;
  els.unresolvedSection.hidden = false;
}

// ---------- file inputs ----------

function readFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && !/csv|text/.test(file.type || "")) {
    setStatus("Please choose a .csv file.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => handleCsvText(String(reader.result), file.name);
  reader.onerror = () => setStatus("Couldn't read that file.", "error");
  reader.readAsText(file);
}

function wireInputs() {
  els.browse.addEventListener("click", (e) => {
    e.stopPropagation();
    els.fileInput.click();
  });
  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener("change", () => readFile(els.fileInput.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    })
  );
  els.dropzone.addEventListener("drop", (e) => {
    readFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  els.sampleBtn.addEventListener("click", async () => {
    setStatus("Loading sample data…", "working");
    try {
      const res = await fetch("./presto-sample.csv");
      if (!res.ok) throw new Error(String(res.status));
      await handleCsvText(await res.text(), "Sample");
    } catch {
      setStatus("Couldn't load the bundled sample file.", "error");
    }
  });
}

// ---------- sidebar collapse ----------

function wireSidebarToggle() {
  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const buttons = [
    document.getElementById("sidebar-toggle"),
    document.getElementById("sidebar-show"),
  ].filter(Boolean);
  if (!app || !buttons.length) return;

  const KEY = "presto_sidebar_collapsed";

  function apply(collapsed, persist) {
    app.classList.toggle("sidebar-collapsed", collapsed);
    buttons.forEach((b) => b.setAttribute("aria-expanded", String(!collapsed)));
    if (persist) {
      try {
        localStorage.setItem(KEY, collapsed ? "1" : "0");
      } catch {
        /* private mode — preference just isn't remembered */
      }
    }
  }

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(KEY) === "1";
  } catch {
    /* ignore */
  }
  apply(collapsed, false);

  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      collapsed = !collapsed;
      apply(collapsed, true);
      // keep the Mapbox canvas in step with the size transition
      const start = performance.now();
      (function tick(now) {
        if (map) map.resize();
        if (now - start < 340) requestAnimationFrame(tick);
      })(start);
    })
  );

  sidebar.addEventListener("transitionend", (e) => {
    if ((e.propertyName === "width" || e.propertyName === "height") && map) map.resize();
  });
}

// ---------- boot ----------

function start(token) {
  initMap(token);
  wireInputs();
}

wireSidebarToggle();

const existingToken = getToken();
if (existingToken) {
  start(existingToken);
} else {
  initTokenUI(start);
}
