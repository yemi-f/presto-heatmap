// Turns messy Presto "Location" strings into a canonical name + key, and holds a
// curated name -> coordinate lookup for known Toronto-area transit stations so the
// common cases resolve instantly and offline. Anything not found here falls back to
// the Mapbox Geocoding API (see geocode.js).

// --- normalisation --------------------------------------------------------------

// "Union Station - Northbound Platform Tow" (Presto truncates at ~38 chars)
const PLATFORM_JUNK = /\s*-\s*(north|south|east|west)bound.*$/i;
// "Bay St at Queens Quay West North Side -"
const DIRECTIONAL_JUNK = /\s+(north|south|east|west)\s+side\s*-?\s*$/i;

// Checked against the raw (whitespace-collapsed) string before any stripping.
const ALIASES = [
  [/^toronto[-\s]*new\s+usbt$/i, "Union Station Bus Terminal"],
  [/hamiltongocentre/i, "Hamilton GO Centre"],
  [/^hamilton go station(\s+rail)?$/i, "Hamilton GO Centre"],
  [/^union station\b/i, "Union Station"], // TTC / GO / UP all tap within ~150 m
];

const ACRONYM_FIXES = [
  [/\bGo\b/g, "GO"],
  [/\bTmu\b/g, "TMU"],
  [/\bUsbt\b/g, "USBT"],
  [/\bTtc\b/g, "TTC"],
  [/\bUp\b/g, "UP"],
  [/\bMccowan\b/g, "McCowan"],
];

function capitalize(w) {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

function titleCase(s) {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.split("-").map(capitalize).join("-"))
    .join(" ");
}

function fixTokens(s) {
  return ACRONYM_FIXES.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

/**
 * @param {string} raw  the Presto "Location" cell
 * @returns {{canonical: string, key: string} | null}  null => not a real place, skip it
 */
export function normalize(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s+/g, " ");
  if (!s || s === "0") return null;
  if (/^zone\s*\d+$/i.test(s)) return null; // GO fare zone, not a location

  for (const [re, name] of ALIASES) {
    if (re.test(s)) return finalize(name);
  }

  s = s.replace(PLATFORM_JUNK, "");
  s = s.replace(/\s+Station\s+Rail$/i, " Station");
  s = s.replace(/\s+GO\s+Station(\s+Rail)?$/i, " GO");
  s = s.replace(/\s+Rail$/i, "");
  s = s.replace(DIRECTIONAL_JUNK, "");
  s = s.replace(/\s*-\s*$/, "").trim();
  s = s.replace(/\s+at\s+/i, " & "); // "College St at Grace St" -> "College St & Grace St"

  if (s === s.toUpperCase()) s = titleCase(s); // shouty TTC names

  return finalize(s);
}

function finalize(name) {
  const canonical = fixTokens(name).trim();
  return { canonical, key: canonical.toLowerCase().replace(/\s+/g, " ").trim() };
}

// --- curated coordinates ------------------------------------------------------
// Keyed by normalize().key. Coordinates are approximate (station centroids) —
// plenty precise for a heatmap. system is informational only.

function ttc(name, lat, lng) {
  return [name, { lat, lng, canonical: titleCaseName(name), system: "TTC" }];
}
function titleCaseName(key) {
  return fixTokens(titleCase(key));
}

export const CURATED_STATIONS = Object.fromEntries([
  // Line 1 — Yonge-University-Spadina
  ttc("finch station", 43.7806, -79.4148),
  ttc("north york centre station", 43.769, -79.4125),
  ttc("sheppard-yonge station", 43.7615, -79.411),
  ttc("york mills station", 43.744, -79.4067),
  ttc("lawrence station", 43.7255, -79.4023),
  ttc("eglinton station", 43.7057, -79.3983),
  ttc("davisville station", 43.6978, -79.3971),
  ttc("st clair station", 43.6879, -79.3931),
  ttc("summerhill station", 43.6824, -79.3908),
  ttc("rosedale station", 43.6773, -79.3888),
  ttc("bloor-yonge station", 43.6709, -79.3857),
  ttc("wellesley station", 43.6653, -79.3838),
  ttc("college station", 43.6613, -79.383),
  ttc("dundas station", 43.6561, -79.3808),
  ttc("tmu station", 43.6561, -79.3808), // renamed from Dundas
  ttc("queen station", 43.6524, -79.3791),
  ttc("king station", 43.6488, -79.3777),
  ttc("union station", 43.6453, -79.3806),
  ttc("st andrew station", 43.6479, -79.3846),
  ttc("osgoode station", 43.6509, -79.3866),
  ttc("st patrick station", 43.6549, -79.3884),
  ttc("queen's park station", 43.6598, -79.3903),
  ttc("museum station", 43.6674, -79.3936),
  ttc("st george station", 43.668, -79.3998),
  ttc("spadina station", 43.6674, -79.4041),
  ttc("dupont station", 43.6745, -79.4067),
  ttc("st clair west station", 43.684, -79.4155),
  ttc("eglinton west station", 43.698, -79.4353),
  ttc("cedarvale station", 43.698, -79.4353),
  ttc("glencairn station", 43.7085, -79.4409),
  ttc("lawrence west station", 43.7157, -79.4442),
  ttc("yorkdale station", 43.7247, -79.4477),
  ttc("wilson station", 43.7343, -79.4503),
  ttc("sheppard west station", 43.7496, -79.462),
  ttc("downsview park station", 43.753, -79.4787),
  ttc("finch west station", 43.7647, -79.4903),
  ttc("york university station", 43.7741, -79.4991),
  ttc("pioneer village station", 43.7773, -79.5104),
  ttc("highway 407 station", 43.7838, -79.5253),
  ttc("vaughan metropolitan centre station", 43.7942, -79.5273),
  // Line 2 — Bloor-Danforth
  ttc("kipling station", 43.6367, -79.5357),
  ttc("islington station", 43.6453, -79.524),
  ttc("royal york station", 43.6482, -79.5113),
  ttc("old mill station", 43.6503, -79.4947),
  ttc("jane station", 43.6497, -79.4842),
  ttc("runnymede station", 43.6519, -79.4757),
  ttc("high park station", 43.6539, -79.4667),
  ttc("keele station", 43.6558, -79.4597),
  ttc("dundas west station", 43.657, -79.453),
  ttc("lansdowne station", 43.6592, -79.4426),
  ttc("dufferin station", 43.66, -79.4356),
  ttc("ossington station", 43.6624, -79.4266),
  ttc("christie station", 43.6642, -79.4185),
  ttc("bathurst station", 43.6663, -79.4113),
  ttc("bay station", 43.6704, -79.3903),
  ttc("sherbourne station", 43.6722, -79.3767),
  ttc("castle frank station", 43.6739, -79.3689),
  ttc("broadview station", 43.6769, -79.3585),
  ttc("chester station", 43.6785, -79.3524),
  ttc("pape station", 43.6798, -79.3452),
  ttc("donlands station", 43.6809, -79.3379),
  ttc("greenwood station", 43.6825, -79.33),
  ttc("coxwell station", 43.6842, -79.3227),
  ttc("woodbine station", 43.6866, -79.3128),
  ttc("main street station", 43.689, -79.3017),
  ttc("victoria park station", 43.6952, -79.2886),
  ttc("warden station", 43.7113, -79.2795),
  ttc("kennedy station", 43.7325, -79.2635),
  // Line 4 — Sheppard
  ttc("bayview station", 43.7672, -79.3866),
  ttc("bessarion station", 43.769, -79.376),
  ttc("leslie station", 43.771, -79.3654),
  ttc("don mills station", 43.7757, -79.3462),
  // TTC surface / other
  ttc("queens quay/ferry docks station", 43.6408, -79.3765),
  ["spadina station (line 2)", { lat: 43.6673, lng: -79.4036, canonical: "Spadina Station", system: "TTC" }],

  // UP Express
  ["union station bus terminal", { lat: 43.6432, lng: -79.3806, canonical: "Union Station Bus Terminal", system: "GO Transit" }],
  ["pearson station", { lat: 43.6772, lng: -79.6248, canonical: "Pearson Station (UP Express)", system: "UP Express" }],
  ["weston station", { lat: 43.7, lng: -79.5108, canonical: "Weston Station (UP Express)", system: "UP Express" }],
  ["bloor station", { lat: 43.6555, lng: -79.4109, canonical: "Bloor Station (UP Express)", system: "UP Express" }],

  // GO Transit — rail
  ["exhibition go", { lat: 43.6353, lng: -79.4166, canonical: "Exhibition GO", system: "GO Transit" }],
  ["mimico go", { lat: 43.6155, lng: -79.4988, canonical: "Mimico GO", system: "GO Transit" }],
  ["long branch go", { lat: 43.5926, lng: -79.543, canonical: "Long Branch GO", system: "GO Transit" }],
  ["port credit go", { lat: 43.5537, lng: -79.5875, canonical: "Port Credit GO", system: "GO Transit" }],
  ["clarkson go", { lat: 43.5147, lng: -79.632, canonical: "Clarkson GO", system: "GO Transit" }],
  ["oakville go", { lat: 43.4561, lng: -79.6832, canonical: "Oakville GO", system: "GO Transit" }],
  ["bronte go", { lat: 43.397, lng: -79.715, canonical: "Bronte GO", system: "GO Transit" }],
  ["burlington go", { lat: 43.335, lng: -79.807, canonical: "Burlington GO", system: "GO Transit" }],
  ["aldershot go", { lat: 43.3106, lng: -79.8517, canonical: "Aldershot GO", system: "GO Transit" }],
  ["west harbour go", { lat: 43.2685, lng: -79.8699, canonical: "West Harbour GO", system: "GO Transit" }],
  ["hamilton go centre", { lat: 43.2558, lng: -79.8697, canonical: "Hamilton GO Centre", system: "GO Transit" }],
  ["hamilton go", { lat: 43.2558, lng: -79.8697, canonical: "Hamilton GO Centre", system: "GO Transit" }],
  ["malton go", { lat: 43.7075, lng: -79.636, canonical: "Malton GO", system: "GO Transit" }],
  ["bramalea go", { lat: 43.7145, lng: -79.6905, canonical: "Bramalea GO", system: "GO Transit" }],
  ["brampton go", { lat: 43.691, lng: -79.753, canonical: "Brampton GO", system: "GO Transit" }],
  ["mount pleasant go", { lat: 43.664, lng: -79.8095, canonical: "Mount Pleasant GO", system: "GO Transit" }],
  ["georgetown go", { lat: 43.647, lng: -79.9165, canonical: "Georgetown GO", system: "GO Transit" }],
  ["milton go", { lat: 43.516, lng: -79.879, canonical: "Milton GO", system: "GO Transit" }],
  ["cooksville go", { lat: 43.571, lng: -79.617, canonical: "Cooksville GO", system: "GO Transit" }],
  ["danforth go", { lat: 43.6866, lng: -79.3128, canonical: "Danforth GO", system: "GO Transit" }],
  ["scarborough go", { lat: 43.7135, lng: -79.253, canonical: "Scarborough GO", system: "GO Transit" }],
  ["guildwood go", { lat: 43.755, lng: -79.198, canonical: "Guildwood GO", system: "GO Transit" }],
  ["pickering go", { lat: 43.831, lng: -79.077, canonical: "Pickering GO", system: "GO Transit" }],
  ["ajax go", { lat: 43.851, lng: -79.029, canonical: "Ajax GO", system: "GO Transit" }],
  ["whitby go", { lat: 43.864, lng: -78.941, canonical: "Whitby GO", system: "GO Transit" }],
  ["oshawa go", { lat: 43.888, lng: -78.894, canonical: "Oshawa GO", system: "GO Transit" }],
  ["unionville go", { lat: 43.859, lng: -79.317, canonical: "Unionville GO", system: "GO Transit" }],
  ["markham go", { lat: 43.872, lng: -79.262, canonical: "Markham GO", system: "GO Transit" }],
  ["richmond hill go", { lat: 43.872, lng: -79.426, canonical: "Richmond Hill GO", system: "GO Transit" }],
  ["aurora go", { lat: 44.001, lng: -79.464, canonical: "Aurora GO", system: "GO Transit" }],
  ["newmarket go", { lat: 44.048, lng: -79.482, canonical: "Newmarket GO", system: "GO Transit" }],
  ["barrie south go", { lat: 44.321, lng: -79.648, canonical: "Barrie South GO", system: "GO Transit" }],
  ["allandale waterfront go", { lat: 44.367, lng: -79.683, canonical: "Allandale Waterfront GO", system: "GO Transit" }],
  ["kitchener go", { lat: 43.459, lng: -80.493, canonical: "Kitchener GO", system: "GO Transit" }],
  ["guelph central go", { lat: 43.543, lng: -80.247, canonical: "Guelph Central GO", system: "GO Transit" }],

  // MiWay (Mississauga)
  ["derry rd & dixie rd", { lat: 43.6957, lng: -79.648, canonical: "Derry Rd & Dixie Rd", system: "MiWay" }],
]);

/**
 * Resolve a raw Presto location against the curated table.
 * @returns {{lat, lng, canonical, key, system} | null}
 */
export function resolveCurated(raw, provider = "") {
  const n = normalize(raw);
  if (!n) return null;

  // "Bloor Station" is ambiguous: UP Express stop vs TTC Bloor-Yonge.
  if (n.key === "bloor station" && /toronto transit/i.test(provider)) {
    const b = CURATED_STATIONS["bloor-yonge station"];
    return { ...b, key: n.key };
  }

  const hit = CURATED_STATIONS[n.key];
  return hit ? { ...hit, key: n.key } : null;
}
