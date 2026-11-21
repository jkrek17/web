import { WindLayer } from "./wind.js?v=41";
import { SCALES, paintBar, tickPosition } from "./palettes.js?v=40";

// Static hosting (GitHub Pages): the build injects <meta name="wind-data" content="data/">
// and the forecast is read from pre-built, gzipped files next to the page. Without the tag
// the page talks to the dev server's /api endpoints (relative, so any mount point works).
const DATA_BASE = document.querySelector('meta[name="wind-data"]')?.content || null;
const STATIC_MODE = DATA_BASE !== null;
document.documentElement.dataset.mode = STATIC_MODE ? "static" : "server";

const hhh = (hour) => String(hour).padStart(3, "0");
// Absolute, because the frame worker would otherwise resolve against its own URL.
const resolveUrl = (path) => new URL(path, document.baseURI).href;
// Pages caches every file for about 10 minutes and the data paths do not change between
// runs, so the catalog is always fetched fresh and each data URL carries its run: a new run
// can never be served from cache under the old run's URL, or mixed with it in one loop.
const catalogUrl = () =>
  resolveUrl(STATIC_MODE ? `${DATA_BASE}catalog.json?t=${Date.now()}` : "api/catalog");
const runTag = (model) => {
  const cycle = catalog?.models?.find((item) => item.id === model)?.cycle || "";
  return cycle.replace(/\D/g, "").slice(0, 10);
};
const fieldUrl = (model, layer, hour) =>
  resolveUrl(STATIC_MODE
    ? `${DATA_BASE}${model}/${layer}/f${hhh(hour)}.bin.gz?run=${runTag(model)}`
    : `api/field?model=${encodeURIComponent(model)}&hour=${hour}&layer=${encodeURIComponent(layer)}`);
const pressureUrl = (model, hour) =>
  resolveUrl(STATIC_MODE
    ? `${DATA_BASE}${model}/pressure/f${hhh(hour)}.bin.gz?run=${runTag(model)}`
    : `api/pressure?model=${model}&hour=${hour}`);

const hourInput = document.querySelector("#hour");
const playButton = document.querySelector("#play");
const freezeButton = document.querySelector("#freeze");
const flowInput = document.querySelector("#flow");
const densityInput = document.querySelector("#density");
const trailInput = document.querySelector("#trail");
const flowValue = document.querySelector("#flow-value");
const densityValue = document.querySelector("#density-value");
const trailValue = document.querySelector("#trail-value");
const validEl = document.querySelector("#valid");
const leadEl = document.querySelector("#lead");
const initEl = document.querySelector("#init");
const ageEl = document.querySelector("#age");
const statusEl = document.querySelector("#status");
const stepBackButton = document.querySelector("#step-back");
const stepFwdButton = document.querySelector("#step-fwd");
const speedSelect = document.querySelector("#speed");
const settingsOpen = document.querySelector("#settings-open");
const helpOpen = document.querySelector("#help-open");
const helpDialog = document.querySelector("#help");
const readout = document.querySelector("#readout");
const readoutSpeed = document.querySelector("#readout-speed");
const readoutDir = document.querySelector("#readout-dir");
const readoutCoord = document.querySelector("#readout-coord");
const layerOpen = document.querySelector("#layer-open");
const layerPanel = document.querySelector("#layer-panel");
const layerName = document.querySelector("#layer-name");
const layerLevel = document.querySelector("#layer-level");
const pinCard = document.querySelector("#pin");
const pinPlace = document.querySelector("#pin-place");
const pinFocus = document.querySelector("#pin-focus");
const pinWind = document.querySelector("#pin-wind");
const pinWaves = document.querySelector("#pin-waves");
const pinUnder = document.querySelector("#pin-under");
const pinVert = document.querySelector("#pin-vert");
const pinChart = document.querySelector("#pin-chart");
const hourTicks = document.querySelector("#hour-ticks");
const pinClose = document.querySelector("#pin-close");
const settingsPanel = document.querySelector("#settings");
const settingsClose = document.querySelector("#settings-close");
const themeToggle = document.querySelector("#theme-toggle");
const themeLabel = document.querySelector("#theme-label");
const isobarToggle = document.querySelector("#isobar-toggle");
const legendEl = document.querySelector("#legend");

// Per layer: `legend` is the color scale in palettes.js (map and legend both
// draw from it), `hover` picks the readout format.
const PRESENT = {
  wind10: { legend: "wind", hover: "wind" },
  wind850: { legend: "wind", hover: "wind" },
  wind700: { legend: "wind", hover: "wind" },
  wind500: { legend: "wind", hover: "wind" },
  wind250: { legend: "wind", hover: "wind" },
  t2m: { legend: "temp", hover: "temp" },
  t850: { legend: "temp", hover: "temp" },
  t500: { legend: "temp", hover: "temp" },
  apcp: { legend: "precip", hover: "mm" },
  cape: { legend: "cape", hover: "cape" },
  rh2m: { legend: "rh", hover: "rh" },
  vis: { legend: "vis", hover: "vis" },
  mslp: { legend: "mslp", hover: "hpa" },
  wvht: { legend: "waves", hover: "meters" },
  wvdir: { legend: "waves", hover: "wave" },
  wvper: { legend: "period", hover: "seconds" },
};

const C_TO_F = 9 / 5;
const FREEZING_F = 32;
const MM_PER_IN = 25.4;
const KM_PER_MI = 1.609344;

const MENU = [
  { name: "Surface wind", ids: ["wind10"] },
  { name: "Upper air", ids: ["wind850", "wind700", "wind500", "wind250"] },
  { name: "Thermo", ids: ["t2m", "t850", "t500", "apcp", "cape", "rh2m", "vis", "mslp"] },
  { name: "Marine", ids: ["wvht", "wvdir", "wvper"] },
];

const DISPLAY_UNIT = {
  wind10: "kt",
  wind850: "kt",
  wind700: "kt",
  wind500: "kt",
  wind250: "kt",
  t2m: "°F",
  t850: "°F",
  t500: "°F",
  apcp: "in",
  cape: "J/kg",
  rh2m: "%",
  vis: "mi",
  mslp: "hPa",
  wvht: "m",
  wvdir: "°",
  wvper: "s",
};

const LAYER_FACE = {
  wind10: ["Wind", "10 m"],
  wind850: ["Wind", "850 hPa"],
  wind700: ["Wind", "700 hPa"],
  wind500: ["Wind", "500 hPa"],
  wind250: ["Wind", "250 hPa"],
  t2m: ["Temperature", "2 m"],
  t850: ["Temperature", "850 hPa"],
  t500: ["Temperature", "500 hPa"],
  apcp: ["Precipitation", "6 h"],
  cape: ["CAPE", "surface"],
  rh2m: ["Humidity", "2 m"],
  vis: ["Visibility", "surface"],
  mslp: ["Pressure", "MSLP"],
  wvht: ["Wave height", "significant"],
  wvdir: ["Wave direction", "primary"],
  wvper: ["Wave period", "primary"],
};

const fieldFrames = new Map();
const pressureFrames = new Map();
const pending = new Map();
const loading = new Map();
let catalog = null;
let modelId = "gfs";
let motionId = "wind10";
let underlayId = null;
let displayHour = 0;
let pin = null;
let pinMarker = null;
let pinChartKey = "";
let pinJob = 0;
let pinData = null;
let pinWanted = "";
let pinTimer = 0;
let pinAbort = null;
const PIN_POLL_MS = 1500;
const PIN_RETRY_MS = 5000;
let statusHold = "";
let forecastPlaying = false;
const SPEEDS = [1, 2, 4, 8];
let playSpeed = Number(speedSelect?.value) > 0 ? Number(speedSelect.value) : 4;
let lastUi = performance.now();
const rangeFill = new WeakMap();

const THEME_KEY = "wind-theme";
const ISOBARS_KEY = "wind-isobars";

// The Isobars switch: pressure contours, their labels and the H/L markers, together.
// On unless the viewer turned it off.
function initialIsobars() {
  try {
    return localStorage.getItem(ISOBARS_KEY) !== "off";
  } catch {
    return true; // storage can be blocked
  }
}

let isobarsOn = initialIsobars();
const BASEMAP = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};
const THEME_COLOR = { dark: "#151b22", light: "#ffffff" };
// Isobar label ink per theme; the halo keeps the numbers readable over fields and coastlines.
const ISOBAR_INK = {
  dark: { color: "#e3eaef", halo: "rgba(10, 18, 24, 0.9)" },
  light: { color: "#18222b", halo: "rgba(255, 255, 255, 0.92)" },
};
// H (blue) and L (red) markers: the letter takes the hue, the halo keeps it legible on
// any fill, and the central pressure beneath uses the isobar label ink.
const CENTER_INK = {
  dark: { high: "#6bb4ff", low: "#ff7468", halo: "rgba(8, 14, 20, 0.92)" },
  light: { high: "#0a56c2", low: "#c0241a", halo: "rgba(255, 255, 255, 0.95)" },
};

function initialTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* storage can be blocked */
  }
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let theme = initialTheme();
document.documentElement.dataset.theme = theme;

const layer = new WindLayer();
if (!layer.animate) {
  freezeButton.setAttribute("aria-pressed", "true");
  freezeButton.textContent = "Frozen";
}

const map = new maplibregl.Map({
  container: "map",
  style: BASEMAP[theme],
  center: [-28, 32],
  zoom: 3.15,
  hash: true,
  projection: { type: "globe" },
  maxPitch: 0,
  attributionControl: true,
  fadeDuration: 0,
});
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
map.dragRotate.enable();
map.touchZoomRotate.disableRotation();

map.on("error", (event) => {
  const message = event?.error?.message || "";
  if (message) statusEl.textContent = message;
});

// Paint tweaks that make the stock CARTO styles work as a backdrop for the data layers.
function tuneBasemap() {
  for (const styleLayer of map.getStyle().layers) {
    try {
      if (styleLayer.type === "hillshade" || /hillshade/i.test(styleLayer.id)) {
        map.setLayoutProperty(styleLayer.id, "visibility", "none");
      }
      if (theme !== "dark") continue;
      if (styleLayer.type === "symbol") {
        map.setPaintProperty(styleLayer.id, "text-opacity", 0.92);
      }
      if (styleLayer.id === "background" || styleLayer.id === "landcover" || styleLayer.id === "landuse") {
        const prop = styleLayer.type === "background" ? "background-color" : "fill-color";
        map.setPaintProperty(styleLayer.id, prop, "#556068");
      }
      if (styleLayer.id === "water") {
        map.setPaintProperty(styleLayer.id, "fill-color", "#143246");
      }
    } catch {
      /* some style expressions are not plain colors */
    }
  }
}

// Ink for the land outline drawn over the data: coastlines and the borders that
// stay readable through a colored fill. Thin, translucent, and keyed to the basemap.
const OUTLINE_INK = {
  dark: {
    coast: { color: "#e3eaef", opacity: 0.85, casing: "#0b1218" },
    country: { color: "#d2dbe1", opacity: 0.6 },
    state: { color: "#c3ced6", opacity: 0.4 },
  },
  light: {
    coast: { color: "#1d2832", opacity: 0.8, casing: "#ffffff" },
    country: { color: "#2b3641", opacity: 0.55 },
    state: { color: "#3a4650", opacity: 0.38 },
  },
};
const ZOOM_WIDTH = (near, mid, far) => ["interpolate", ["linear"], ["zoom"], 1, near, 4, mid, 9, far];
const BASE_FILL_LAYERS = new Set(["landcover", "landuse", "park", "water"]);

// Where the pieces go in the basemap stack (the two CARTO styles differ in layer
// order, so this reads the stack instead of naming layers):
//   floor   the first layer above the last basemap fill: the data layer goes here, so
//           land, parks and water are under it and roads, buildings and labels over it.
//   anchor  the first symbol layer of the closing run of labels: outlines, isobar
//           labels and H/L markers go just below it, so place names stay on top.
function overlaySlots() {
  const layers = map.getStyle().layers;
  let lastFill = -1;
  let anchor = null;
  layers.forEach((styleLayer, index) => {
    const base = styleLayer.type === "background"
      || (styleLayer.type === "fill" && BASE_FILL_LAYERS.has(styleLayer["source-layer"]));
    if (base) lastFill = index;
    if (styleLayer.type !== "symbol") anchor = null;
    else if (anchor === null) anchor = styleLayer.id;
  });
  return { floor: layers[lastFill + 1]?.id, anchor: anchor || undefined };
}

// Coastlines come from the water polygons; state and country borders are the style's
// own layers, lifted out from under the data and restyled to read through it.
function installOutlines(anchor) {
  const ink = OUTLINE_INK[theme];
  for (const [id, kind, width] of [
    ["boundary_state", "state", ZOOM_WIDTH(0.4, 0.6, 0.9)],
    ["boundary_country_inner", "country", ZOOM_WIDTH(0.6, 0.9, 1.2)],
  ]) {
    if (!map.getLayer(id)) continue;
    map.moveLayer(id, anchor);
    map.setPaintProperty(id, "line-color", ink[kind].color);
    map.setPaintProperty(id, "line-opacity", ink[kind].opacity);
    map.setPaintProperty(id, "line-width", width);
    map.setPaintProperty(id, "line-dasharray", kind === "state" ? [4, 2] : [1, 0]);
  }
  // The wide halo under the country line would smear over the data, so it is dropped.
  if (map.getLayer("boundary_country_outline")) {
    map.setLayoutProperty("boundary_country_outline", "visibility", "none");
  }
  if (!map.getLayer("coastline") && map.getSource("carto")) {
    // A faint halo of the opposite tone keeps the coast apart from the data's own
    // contours, which draw in the same ink family, and readable on any fill color.
    const coast = {
      type: "line",
      source: "carto",
      "source-layer": "water",
      filter: ["==", "$type", "Polygon"],
      layout: { "line-cap": "round", "line-join": "round" },
    };
    map.addLayer({
      ...coast,
      id: "coastline-casing",
      paint: {
        "line-color": ink.coast.casing,
        "line-opacity": 0.4,
        "line-width": ZOOM_WIDTH(2, 2.4, 2.8),
      },
    }, anchor);
    map.addLayer({
      ...coast,
      id: "coastline",
      paint: {
        "line-color": ink.coast.color,
        "line-opacity": ink.coast.opacity,
        "line-width": ZOOM_WIDTH(0.8, 1.05, 1.3),
      },
    }, anchor);
  }
}

// Everything that lives on top of the basemap. A style change throws the old
// layers away, so this runs after the first style and after every theme swap.
// Final order, bottom to top: basemap fills, the data layer, state and country
// borders, coastline, isobar labels, H/L markers, then the basemap's own labels.
function installOverlays() {
  map.setProjection({ type: "globe" });
  tuneBasemap();
  const slots = overlaySlots();
  if (!map.getLayer(layer.id)) {
    // The layer is added to a new GL state: its textures are recreated in onAdd,
    // so forget which frames were "already uploaded" and let syncTextures send them again.
    for (const key of Object.keys(layer)) {
      if (/^uploaded/.test(key)) layer[key] = null;
    }
    map.addLayer(layer, slots.floor);
  }
  installOutlines(slots.anchor);
  if (!map.getSource("isobars")) {
    map.addSource("isobars", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getLayer("isobar-labels")) {
    const ink = ISOBAR_INK[theme];
    map.addLayer({
      id: "isobar-labels",
      type: "symbol",
      source: "isobars",
      layout: {
        "text-field": ["get", "label"],
        "text-font": heavyFont(),
        "text-size": 13,
        "text-padding": 6,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": ink.color,
        "text-halo-color": ink.halo,
        "text-halo-width": 1.8,
      },
    }, slots.anchor);
  }
  if (!map.getSource("pressure-centers")) {
    map.addSource("pressure-centers", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getLayer("pressure-centers")) {
    const ink = CENTER_INK[theme];
    map.addLayer({
      id: "pressure-centers",
      type: "symbol",
      source: "pressure-centers",
      layout: {
        // a large letter with the central pressure below it in smaller type
        "text-field": ["format",
          ["get", "kind"], { "font-scale": 1 },
          "\n", {},
          ["get", "hpa"], { "font-scale": 0.45, "text-color": ISOBAR_INK[theme].color },
        ],
        "text-font": heavyFont(),
        "text-size": 34,
        "text-line-height": 1,
        "text-padding": 10,
        "text-allow-overlap": false,
        "symbol-sort-key": ["get", "sort"],
      },
      paint: {
        "text-color": ["match", ["get", "kind"], "H", ink.high, ink.low],
        "text-halo-color": ink.halo,
        "text-halo-width": 2.2,
      },
    }, slots.anchor);
  }
  // the label sources are new, so their cached "already applied" state no longer holds
  labelsApplied.source = null;
  centersApplied.source = null;
  if (typeof layer.setTheme === "function") layer.setTheme(theme);
  refreshField();
}

map.on("style.load", installOverlays);

function syncThemeChrome() {
  const light = theme === "light";
  themeToggle.setAttribute("aria-checked", light ? "true" : "false");
  themeLabel.textContent = "Light theme";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

function setTheme(next) {
  if (next !== "dark" && next !== "light") return;
  if (next === theme) return;
  theme = next;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage can be blocked */
  }
  syncThemeChrome();
  if (typeof layer.setTheme === "function") layer.setTheme(theme);
  // diff: false rebuilds the style from scratch; installOverlays() runs on its style.load
  map.setStyle(BASEMAP[theme], { diff: false });
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

function toggleTheme() {
  setTheme(theme === "dark" ? "light" : "dark");
}

function syncIsobarSwitch() {
  isobarToggle?.setAttribute("aria-checked", isobarsOn ? "true" : "false");
}

// No fetching here: the pressure frames keep loading as before, so turning the
// isobars back on is instant. The scene key changes, which re-sends the contour spec to
// the layer and clears or restores the labels and markers once.
function setIsobars(on) {
  const next = !!on;
  if (next === isobarsOn) return;
  isobarsOn = next;
  try {
    localStorage.setItem(ISOBARS_KEY, next ? "on" : "off");
  } catch {
    /* storage can be blocked */
  }
  syncIsobarSwitch();
  refreshField();
}

function toggleIsobars() {
  setIsobars(!isobarsOn);
}

window.windApp = Object.assign(window.windApp || {}, {
  setTheme,
  toggleTheme,
  get theme() {
    return theme;
  },
});
themeToggle.addEventListener("click", toggleTheme);
syncThemeChrome();
isobarToggle?.addEventListener("click", toggleIsobars);
syncIsobarSwitch();

let hoverPoint = null;
// Static mode has no point forecast, so a click or tap shows the readout for that point
// and keeps it until the next tap, Esc, or (with a mouse) the pointer moving again.
let tappedReadout = false;

function clearTappedReadout() {
  if (!tappedReadout) return;
  tappedReadout = false;
  hoverPoint = null;
  hideReadout();
}

// Touch has no hover. Browsers still fire emulated mouse events after a tap, which would
// leave the readout stuck on screen, so the pointer type of the latest interaction decides.
let touchPointer = false;
for (const type of ["pointerdown", "pointermove"]) {
  map.getCanvasContainer().addEventListener(type, (event) => {
    touchPointer = event.pointerType === "touch";
    // A touch drag moves the map away from the tapped point; a tap shows it again on click.
    if (touchPointer && hoverPoint && (!STATIC_MODE || type === "pointermove")) {
      tappedReadout = false;
      hoverPoint = null;
      hideReadout();
    }
  }, { capture: true, passive: true });
}

map.on("mousemove", (event) => {
  if (touchPointer) return;
  tappedReadout = false;
  hoverPoint = event.lngLat;
  showHover(event.lngLat.lng, event.lngLat.lat);
});

map.on("mouseout", () => {
  if (tappedReadout) return;
  hoverPoint = null;
  hideReadout();
});

map.on("click", (event) => {
  if (STATIC_MODE) {
    tappedReadout = true;
    hoverPoint = event.lngLat;
    showHover(event.lngLat.lng, event.lngLat.lat);
    return;
  }
  if (pin && pinDistance(event.point) < 18) {
    clearPin();
    return;
  }
  pinAt(event.lngLat.lng, event.lngLat.lat);
});

map.on("move", () => {
  placePin();
});

map.on("moveend", () => {
  refreshLabels();
  placePin();
});

pinClose.addEventListener("click", () => {
  clearPin();
});

document.querySelector("#model-gfs").addEventListener("click", () => selectModel("gfs"));
document.querySelector("#model-aigfs").addEventListener("click", () => selectModel("aigfs"));
hourInput.addEventListener("input", () => {
  displayHour = Number(hourInput.value);
  setPlaying(false);
  updateClock();
  refreshField();
  ensureAround(displayHour);
});
playButton.addEventListener("click", () => {
  setPlaying(!forecastPlaying);
});
stepBackButton?.addEventListener("click", () => stepForecast(-1, false));
stepFwdButton?.addEventListener("click", () => stepForecast(1, false));
speedSelect?.addEventListener("change", () => {
  const value = Number(speedSelect.value);
  if (value > 0) playSpeed = value;
});
freezeButton.addEventListener("click", () => {
  layer.animate = !layer.animate;
  freezeButton.setAttribute("aria-pressed", layer.animate ? "false" : "true");
  freezeButton.textContent = layer.animate ? "Freeze" : "Frozen";
  if (layer.animate) map.triggerRepaint();
});
flowInput.addEventListener("input", () => {
  layer.flow = Number(flowInput.value);
  syncControls();
});
densityInput.addEventListener("input", () => {
  layer.density = Number(densityInput.value);
  syncControls();
  map.triggerRepaint();
});
trailInput.addEventListener("input", () => {
  layer.segments = Number(trailInput.value);
  syncControls();
  map.triggerRepaint();
});
layerOpen.addEventListener("click", () => {
  if (layerOpen.getAttribute("aria-expanded") === "true") closeMenu(true);
  else openMenu();
});
document.addEventListener("click", (event) => {
  if (!inMenu(event.target)) closeMenu();
});

// ---- settings sheet and help dialog -------------------------------------
let settingsReturn = null;

function settingsIsOpen() {
  return !settingsPanel.hidden;
}

function openSettings() {
  if (settingsIsOpen()) return;
  closeMenu();
  settingsReturn = document.activeElement instanceof HTMLElement ? document.activeElement : settingsOpen;
  settingsPanel.hidden = false;
  settingsOpen.setAttribute("aria-expanded", "true");
  // keyboard and touch users land inside the panel; the close button is always the first stop
  settingsClose.focus({ preventScroll: true });
}

function closeSettings(restoreFocus = true) {
  if (!settingsIsOpen()) return false;
  const inside = settingsPanel.contains(document.activeElement);
  settingsPanel.hidden = true;
  settingsOpen.setAttribute("aria-expanded", "false");
  if (restoreFocus && inside) (settingsReturn?.isConnected ? settingsReturn : settingsOpen).focus({ preventScroll: true });
  settingsReturn = null;
  return true;
}

function toggleSettings() {
  if (settingsIsOpen()) closeSettings();
  else openSettings();
}

settingsOpen.addEventListener("click", toggleSettings);
settingsClose.addEventListener("click", () => closeSettings());
helpOpen.addEventListener("click", () => {
  if (helpDialog.open) return;
  closeMenu();
  closeSettings(false);
  helpDialog.showModal();
});
// clicking the dimmed area outside the dialog box closes it
helpDialog.addEventListener("click", (event) => {
  if (event.target !== helpDialog) return;
  const box = helpDialog.getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (outside) helpDialog.close();
});
document.addEventListener("pointerdown", (event) => {
  if (!settingsIsOpen()) return;
  if (settingsPanel.contains(event.target) || settingsOpen.contains(event.target)) return;
  closeSettings(false);
});
// ---- responsive hooks ---------------------------------------------------
// Narrow windows get a compact horizontal legend; the sheet query matches the
// layouts where the pin card and settings dock to a screen edge instead of floating.
const narrowQuery = window.matchMedia("(max-width: 720px)");
const sheetQuery = window.matchMedia(
  "(max-width: 720px) and (orientation: portrait), (max-height: 480px) and (orientation: landscape)"
);

function syncLegendOrient() {
  const orient = narrowQuery.matches ? "horizontal" : "vertical";
  if (legendEl.dataset.orient === orient) return;
  legendEl.dataset.orient = orient;
  window.dispatchEvent(new CustomEvent("legendorient", { detail: { orient } }));
}

syncLegendOrient();
narrowQuery.addEventListener("change", () => {
  syncLegendOrient();
  placePin();
});
sheetQuery.addEventListener("change", () => placePin());
layerPanel.addEventListener("keydown", (event) => {
  const key = event.key;
  if (key === "Tab") {
    closeMenu();
    return;
  }
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
  event.preventDefault();
  moveMenuFocus(key);
});
layerPanel.addEventListener("focusout", (event) => {
  if (event.relatedTarget && !inMenu(event.relatedTarget)) closeMenu();
});
syncControls();
installKeyboard();

function inMenu(node) {
  return !!node && (layerPanel.contains(node) || layerOpen.contains(node));
}

function menuOptions() {
  return [...layerPanel.querySelectorAll("button.layer-option:not(:disabled)")];
}

// Roving focus: only the focused option is in the tab order.
function focusOption(option) {
  for (const other of menuOptions()) other.tabIndex = other === option ? 0 : -1;
  option?.focus();
}

function moveMenuFocus(key) {
  const options = menuOptions();
  if (!options.length) return;
  const at = options.indexOf(document.activeElement);
  let next = 0;
  if (key === "End") next = options.length - 1;
  else if (key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % options.length;
  else if (key === "ArrowUp") next = at < 0 ? options.length - 1 : (at - 1 + options.length) % options.length;
  focusOption(options[next]);
}

function openMenu() {
  renderMenu();
  layerPanel.hidden = false;
  layerOpen.setAttribute("aria-expanded", "true");
  const options = menuOptions();
  focusOption(options.find((option) => option.getAttribute("aria-selected") === "true") || options[0]);
}

function closeMenu(returnFocus = false) {
  const wasOpen = !layerPanel.hidden;
  const hadFocus = layerPanel.contains(document.activeElement);
  layerPanel.hidden = true;
  layerOpen.setAttribute("aria-expanded", "false");
  if (wasOpen && (returnFocus || hadFocus)) layerOpen.focus();
}

function menuOpen() {
  return !layerPanel.hidden;
}

// Playback state in one place, so the button, its label and the field stay in step.
function setPlaying(on) {
  const next = !!on;
  const changed = next !== forecastPlaying;
  forecastPlaying = next;
  playButton.setAttribute("aria-pressed", next ? "true" : "false");
  playButton.setAttribute("aria-label", next ? "Pause forecast" : "Play forecast");
  if (changed && !next) refreshField();
}

function setSpeed(value) {
  playSpeed = value;
  if (speedSelect && speedSelect.value !== String(value)) speedSelect.value = String(value);
}

function cycleSpeed(direction) {
  const options = speedSelect
    ? [...speedSelect.options].map((option) => Number(option.value)).filter((value) => value > 0)
    : SPEEDS;
  if (!options.length) return;
  let at = options.indexOf(playSpeed);
  if (at < 0) at = options.findIndex((value) => value >= playSpeed);
  if (at < 0) at = options.length - 1;
  setSpeed(options[Math.min(options.length - 1, Math.max(0, at + direction))]);
}

function goToHour(hour) {
  displayHour = Math.min(forecastEnd(), Math.max(0, hour));
  setPlaying(false);
  updateClock();
  refreshField();
  ensureAround(displayHour);
}

// Step through the model's own hour list, not by a fixed hour. `day` jumps 24 forecast
// hours and lands on the listed hour nearest the target.
function stepForecast(direction, day) {
  const hours = forecastHours();
  const eps = 1e-6;
  const later = hours.find((hour) => hour > displayHour + eps);
  const earlier = [...hours].reverse().find((hour) => hour < displayHour - eps);
  let target = direction > 0 ? later : earlier;
  if (day && target != null) {
    const wanted = displayHour + direction * 24;
    const inDirection = hours.filter((hour) => (direction > 0 ? hour > displayHour + eps : hour < displayHour - eps));
    target = inDirection.reduce((best, hour) => (Math.abs(hour - wanted) < Math.abs(best - wanted) ? hour : best), target);
  }
  setPlaying(false);
  if (target != null) goToHour(target);
}

function textEntry(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(node.type);
}

// Whether the focused control got focus from a mouse or touch press (focus lands right
// after the pointer goes down). :focus-visible cannot tell, because the key press itself
// turns it on.
let pointerDownAt = -1e9;
let focusFromPointer = false;

function keyboardFocus() {
  return !focusFromPointer;
}

function enabledLayerIds() {
  return MENU.flatMap((group) => group.ids).filter((id) => layerReady(id));
}

function toggleHelp() {
  if (!helpDialog) return;
  if (helpDialog.open) helpDialog.close();
  else if (helpOpen) helpOpen.click();
  else helpDialog.showModal?.();
}

function installKeyboard() {
  const hints = [
    [playButton, "Space"],
    [stepBackButton, "ArrowLeft"],
    [stepFwdButton, "ArrowRight"],
    [speedSelect, "[ ]"],
    [layerOpen, "L"],
    [document.querySelector("#model-gfs"), "M"],
    [document.querySelector("#model-aigfs"), "M"],
    [settingsOpen, "S"],
    [helpOpen, "?"],
    [document.querySelector("#theme-toggle"), "T"],
    [isobarToggle, "P"],
  ];
  for (const [node, keys] of hints) node?.setAttribute("aria-keyshortcuts", keys);
  // Capture phase: runs before the map's own keyboard handling and any panel handlers.
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", () => {
    pointerDownAt = performance.now();
  }, { capture: true, passive: true });
  window.addEventListener("focusin", () => {
    focusFromPointer = performance.now() - pointerDownAt < 400;
  }, true);
  // A button activates on the Space key-up, so a handled Space must not reach it.
  window.addEventListener("keyup", (event) => {
    if (event.key === " " && spaceHandled) {
      spaceHandled = false;
      event.preventDefault();
    }
  }, true);
}

let spaceHandled = false;

function onKey(event) {
  if (event.defaultPrevented || event.isComposing) return;
  const key = event.key;
  const target = event.target;
  if (key === "Escape") {
    escapeOne(event);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (textEntry(target)) return;
  if (helpDialog?.open && key !== "?") return;
  const tag = target?.tagName;
  const onHour = target === hourInput;
  const onRange = tag === "INPUT" && target.type === "range";
  const arrows = key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
  // Sliders other than the forecast hour keep their own arrow, Home and End keys.
  if (onRange && !onHour && (arrows || key === "Home" || key === "End")) return;
  // A button, link or summary the keyboard moved to keeps Space for itself. One that was
  // only clicked with the mouse does not, so Space still plays after clicking a button.
  if (key === " " && (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") && keyboardFocus()) return;
  // Home and End move within the layer menu while it has focus.
  if ((key === "Home" || key === "End") && layerPanel.contains(target)) return;
  // Up and Down belong to the layer menu, except on the hour slider.
  if ((key === "ArrowUp" || key === "ArrowDown") && !onHour) {
    if (menuOpen() && !layerPanel.contains(target)) {
      event.preventDefault();
      moveMenuFocus(key);
    }
    return;
  }
  const once = !event.repeat;
  switch (key) {
    case " ":
      if (once) setPlaying(!forecastPlaying);
      spaceHandled = true;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      stepForecast(-1, event.shiftKey);
      break;
    case "ArrowRight":
    case "ArrowUp":
      stepForecast(1, event.shiftKey);
      break;
    case "Home":
      goToHour(forecastHours()[0]);
      break;
    case "End":
      goToHour(forecastEnd());
      break;
    case "[":
      cycleSpeed(-1);
      break;
    case "]":
      cycleSpeed(1);
      break;
    case "l":
    case "L":
      if (once) {
        if (menuOpen()) closeMenu(true);
        else openMenu();
      }
      break;
    case "m":
    case "M":
      if (once) {
        closeMenu();
        const other = catalog?.models.find((model) => model.id !== modelId && model.available);
        if (other) selectModel(other.id);
      }
      break;
    case "t":
    case "T":
      if (once) window.windApp?.toggleTheme?.();
      break;
    case "p":
    case "P":
      if (once) toggleIsobars();
      break;
    case "s":
    case "S":
      if (once) {
        closeMenu();
        settingsOpen?.click();
      }
      break;
    case "?":
      if (once) toggleHelp();
      break;
    default: {
      if (key.length !== 1 || key < "1" || key > "9") return;
      const id = enabledLayerIds()[Number(key) - 1];
      if (id && once) chooseLayer(id);
    }
  }
  event.preventDefault();
  // The map would also pan on arrow keys when it has focus.
  if (arrows && target?.closest?.("#map")) event.stopPropagation();
}

// Esc closes one thing: the layer menu, else the help dialog (natively), else the
// settings panel, else the pin (static mode: the tapped readout).
function escapeOne(event) {
  if (menuOpen()) {
    closeMenu(true);
  } else if (helpDialog?.open) {
    return;
  } else if (settingsOpen?.getAttribute("aria-expanded") === "true") {
    settingsOpen.click();
    settingsOpen.focus();
  } else if (pin) {
    clearPin();
  } else if (tappedReadout) {
    clearTappedReadout();
  } else {
    return;
  }
  event.preventDefault();
}

function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const span = max - min;
  const pct = span === 0 ? 0 : ((value - min) / span) * 100;
  const fill = `${pct}%`;
  if (rangeFill.get(input) === fill) return;
  rangeFill.set(input, fill);
  input.style.setProperty("--fill", fill);
}

function syncControls() {
  flowValue.textContent = Number(flowInput.value).toFixed(2);
  densityValue.textContent = Number(densityInput.value).toFixed(2);
  trailValue.textContent = String(Math.round(Number(trailInput.value)));
  paintRange(flowInput);
  paintRange(densityInput);
  paintRange(trailInput);
  paintRange(hourInput);
}

function cardinal(deg) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(deg / 45) % 8];
}

function modelMeta() {
  return catalog?.models.find((model) => model.id === modelId) || null;
}

function specById(id) {
  return catalog?.layers?.find((item) => item.id === id) || null;
}

function motionSpec() {
  return specById(motionId);
}

function underlaySpec() {
  return underlayId ? specById(underlayId) : null;
}

function activeSpec() {
  return underlaySpec() || motionSpec();
}

function focusId() {
  return underlayId || motionId;
}

function layerReady(id, model = modelId) {
  const spec = catalog?.layers?.find((item) => item.id === id);
  return !!spec && spec.models.includes(model);
}

function presentFor(spec) {
  return PRESENT[spec.id] || PRESENT.wind10;
}

function contourFor(id) {
  const temp = {
    source: "scalar",
    minor: 5,
    major: 10,
    zero: 1,
    plotScale: C_TO_F,
    plotOffset: FREEZING_F,
    label: "temp",
    labelStep: 10,
    labelMin: -130,
    labelMax: 140,
    emphasize: FREEZING_F,
  };
  const pressure = { source: "pressure", minor: 4, major: 20, label: "hpa", labelStep: 20, labelMin: 900, labelMax: 1080 };
  const height = { source: "hgt", minor: 60, major: 120, label: "hgt", labelStep: 120, labelMin: 0, labelMax: 16000 };
  if (id === "wind10") return pressure;
  if (id === "wind850" || id === "wind700" || id === "wind500" || id === "wind250") return height;
  if (id === "t2m" || id === "t850" || id === "t500") return temp;
  if (id === "mslp") return { ...pressure, source: "scalar" };
  const waves = {
    minor: 1,
    major: 5,
    label: "m",
    labelStep: 5,
    labelMin: 5,
    labelMax: 40,
  };
  if (id === "wvht") return { source: "scalar", ...waves };
  if (id === "wvdir") return { source: "wave", ...waves };
  if (id === "wvper") return { source: "scalar", minor: 2, major: 10, label: "s", labelStep: 10, labelMin: 0, labelMax: 40 };
  if (id === "cape") return { source: "scalar", levels: [500, 1000, 2000, 3000], label: "cape", labelLevels: [500, 1000, 2000, 3000] };
  if (id === "rh2m") return { source: "scalar", minor: 10, rh: 1, label: "rh", labelLevels: [50, 90] };
  if (id === "vis") return { source: "scalar", levels: [1, 3, 5], plotScale: 1 / KM_PER_MI, label: "mi", labelLevels: [1, 3, 5] };
  if (id === "apcp") return { source: "scalar", levels: [0.05, 0.25, 0.5, 1], thin: 1, plotScale: 1 / MM_PER_IN, label: "in", labelLevels: [0.05, 0.25, 0.5, 1] };
  return null;
}

function sceneFor() {
  const motion = motionSpec();
  if (!motion) return null;
  const under = underlaySpec();
  const painted = under || motion;
  const waveMotion = motion.kind === "wave";
  // Pressure contours go away with the Isobars switch. The scene then has no contour, so
  // the layer draws none and the labels and H/L markers are cleared; its key changes so
  // both follow once, and the other contour sets (temperature, height, waves) stay.
  const full = contourFor(painted.id);
  const hidden = full?.label === "hpa" && !isobarsOn;
  return {
    key: `${motion.id}|${under?.id || ""}${hidden ? "|noiso" : ""}`,
    motionKey: motion.id,
    motion: waveMotion ? "wave" : "wind",
    color: under ? "scalar" : waveMotion ? "wave" : "none",
    scale: presentFor(painted).legend,
    contour: hidden ? null : full,
    aux: waveMotion,
  };
}

function updateLayerChrome() {
  const spec = activeSpec();
  if (!spec) return;
  layerName.textContent = spec.name;
  layerLevel.textContent = spec.level;
  layerLevel.title = contourFor(spec.id)?.source === "hgt" ? "Geopotential height contours, meters" : "";
  const meta = modelMeta();
  document.title = `${spec.name} · ${spec.level} · ${meta?.label || "Forecast"}`;
  if (!layerPanel.hidden) renderMenu();
  paintLegend(spec);
}

function renderMenu() {
  if (!catalog?.layers) return;
  const focusedId = layerPanel.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
  layerPanel.replaceChildren();
  const chosen = focusId();
  for (const group of MENU) {
    const kicker = document.createElement("div");
    kicker.className = "layer-kicker";
    kicker.textContent = group.name;
    layerPanel.appendChild(kicker);
    for (const id of group.ids) {
      const spec = specById(id);
      const face = LAYER_FACE[id] || [spec?.name || id, spec?.level || ""];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "layer-option";
      button.dataset.id = id;
      button.tabIndex = -1;
      const available = layerReady(id);
      button.disabled = !available;
      button.setAttribute("aria-selected", id === chosen ? "true" : "false");
      const label = document.createElement("span");
      label.textContent = face[0];
      button.appendChild(label);
      const hint = document.createElement("span");
      hint.className = "layer-hint";
      hint.textContent = `${face[1]} · ${DISPLAY_UNIT[id] || spec?.unit || ""}`;
      button.appendChild(hint);
      if (!available) {
        button.title = `${face[0]} is not in this ${modelMeta()?.label || "model"} cycle`;
      }
      button.addEventListener("click", () => chooseLayer(id));
      layerPanel.appendChild(button);
    }
  }
  if (focusedId) focusOption(menuOptions().find((option) => option.dataset.id === focusedId));
}

function chooseLayer(id) {
  if (!layerReady(id)) return;
  const spec = specById(id);
  if (!spec) return;
  statusHold = "";
  if (spec.kind === "wind" || spec.kind === "wave") {
    motionId = id;
    underlayId = null;
  } else {
    underlayId = id;
    if (motionSpec()?.kind === "wave") motionId = layerReady("wind10") ? "wind10" : motionId;
  }
  updateLayerChrome();
  refreshField();
  ensureAround(displayHour);
  ensurePinHours();
  closeMenu();
}

// Legend. The bar is painted from the same scale definition the map shader
// samples (palettes.js), so colors cannot differ. Markup contract with the
// stylesheet: #legend[data-orient="vertical"|"horizontal"] holds #legend-title,
// #legend-bar (a canvas fills it), #legend-ticks and #legend-unit. Each tick is
// `span.legend-tick` with --p, its position along the bar in percent from the
// low end (bottom when vertical, left when horizontal), `.is-key` for the value
// worth emphasizing (freezing, 1013 hPa) and data-edge="start"|"end" on a tick
// that sits on an end of the bar. Ticks that would overlap are left out.
const legendBox = document.querySelector("#legend");
const legendBar = document.querySelector("#legend-bar");
const legendTicks = document.querySelector("#legend-ticks");
const legendTitle = document.querySelector("#legend-title");
const legendUnit = document.querySelector("#legend-unit");
let legendScale = null;
let legendDrawn = "";

function paintLegend(spec) {
  const present = presentFor(spec);
  const scale = SCALES[present.legend];
  if (!scale || !legendBox || !legendBar) return;
  const level = scale.level || spec.level;
  const key = `${present.legend}|${level}`;
  if (key !== legendScale?.key) {
    legendScale = { key, scale };
    legendDrawn = "";
    const title = level ? `${scale.title} · ${level}` : scale.title;
    if (legendTitle) legendTitle.textContent = title;
    if (legendUnit) legendUnit.textContent = scale.unit;
    legendBox.setAttribute("aria-label", `${title}, ${scale.unit}`);
  }
  drawLegend();
}

function drawLegend() {
  if (!legendScale) return;
  const { scale } = legendScale;
  const vertical = legendBox.dataset.orient !== "horizontal";
  legendBar.style.background = "none";
  let canvas = legendBar.firstElementChild;
  if (!(canvas instanceof HTMLCanvasElement)) {
    canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    legendBar.replaceChildren(canvas);
  }
  let rect = legendBar.getBoundingClientRect();
  // A stylesheet that gives the bar no length along its axis gets the scale's own.
  if ((vertical ? rect.height : rect.width) < 24) {
    legendBar.style[vertical ? "height" : "width"] = `${scale.height}px`;
    rect = legendBar.getBoundingClientRect();
  }
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const outline = getComputedStyle(legendBox).getPropertyValue("--muted").trim() || "#8a949c";
  const drawn = `${legendScale.key}|${vertical}|${width}x${height}@${dpr}|${outline}`;
  if (drawn === legendDrawn) return;
  legendDrawn = drawn;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  paintBar(canvas.getContext("2d"), scale, canvas.width, canvas.height, vertical, outline);
  placeTicks(scale, vertical ? height : width, vertical);
}

function placeTicks(scale, length, vertical) {
  // Space each label needs along the bar: a line of text when vertical, its
  // width when horizontal. Higher priority labels (key values, then names)
  // claim their place first.
  const items = scale.ticks.map((tick, index) => {
    const p = tickPosition(scale, tick);
    const need = vertical ? 15 : tick.label.length * 6.6 + 10;
    const priority = tick.key ? 3 : /[A-Za-z]/.test(tick.label) ? 2 : 1;
    return { tick, index, p, need, priority };
  });
  const taken = [];
  const keep = new Set();
  for (const item of [...items].sort((a, b) => b.priority - a.priority || a.index - b.index)) {
    const at = item.p * length;
    // A horizontal label is centered on its tick, so keep it inside the strip
    // unless it is an end tick (the stylesheet aligns those to the end).
    if (!vertical && item.p > 0.02 && item.p < 0.98 && (at - item.need / 2 < -8 || at + item.need / 2 > length + 8)) continue;
    if (taken.some((other) => Math.abs(other.at - at) < (other.need + item.need) / 2)) continue;
    taken.push({ at, need: item.need });
    keep.add(item.index);
  }
  const spans = [];
  for (const item of items) {
    if (!keep.has(item.index)) continue;
    const span = document.createElement("span");
    span.className = item.tick.key ? "legend-tick is-key" : "legend-tick";
    span.style.setProperty("--p", (item.p * 100).toFixed(2));
    if (item.p < 0.02) span.dataset.edge = "start";
    else if (item.p > 0.98) span.dataset.edge = "end";
    span.textContent = item.tick.label;
    spans.push(span);
  }
  legendTicks.replaceChildren(...spans);
}

if (legendBox && legendBar) {
  new MutationObserver(drawLegend).observe(legendBox, { attributes: true, attributeFilter: ["data-orient"] });
  new ResizeObserver(drawLegend).observe(legendBar);
  window.addEventListener("themechange", drawLegend);
  window.addEventListener("legendorient", drawLegend);
}

function selectModel(next) {
  const meta = catalog?.models.find((model) => model.id === next);
  if (!meta?.available) return;
  modelId = next;
  for (const id of ["gfs", "aigfs"]) {
    const button = document.querySelector(`#model-${id}`);
    button.setAttribute("aria-selected", id === modelId ? "true" : "false");
  }
  const dropped = [];
  if (underlayId && !layerReady(underlayId)) {
    dropped.push(underlaySpec()?.name || underlayId);
    underlayId = null;
  }
  if (!layerReady(motionId)) {
    dropped.push(motionSpec()?.name || motionId);
    motionId = layerReady("wind10") ? "wind10" : catalog.layers.find((item) => item.models.includes(modelId))?.id;
  }
  statusHold = dropped.length ? `${dropped[0]} is not in this ${meta.label} cycle` : "";
  updateLayerChrome();
  syncHourRange();
  updateClock();
  refreshField();
  ensureAround(displayHour);
  ensurePinHours();
}

function forecastHours() {
  const hours = modelMeta()?.hours;
  return Array.isArray(hours) && hours.length ? hours : [0];
}

function forecastEnd() {
  const hours = forecastHours();
  return hours[hours.length - 1];
}

function waveSampleHours() {
  if (!layerReady("wvdir") && !layerReady("wvht")) return [];
  const listed = modelMeta()?.waveHours;
  return Array.isArray(listed) ? listed : [];
}

function wavesInModel() {
  return waveSampleHours().length > 0;
}

function hourTickMarks(end) {
  const last = Math.max(0, end);
  if (last === 0) return [0];
  const width = 250;
  const minGap = 32;
  let step = 24;
  while (step < last && (last / step) * minGap > width) step += 24;
  const ticks = [];
  for (let hour = 0; hour <= last; hour += step) ticks.push(hour);
  if (ticks[ticks.length - 1] !== last) {
    if (ticks.length && ((last - ticks[ticks.length - 1]) / last) * width < minGap) ticks.pop();
    ticks.push(last);
  }
  return ticks;
}

let hourTicksEnd = null;

function syncHourRange() {
  const end = forecastEnd();
  hourInput.max = String(end);
  if (displayHour > end) displayHour = end;
  if (hourTicksEnd === end) return;
  hourTicksEnd = end;
  hourTicks.replaceChildren();
  for (const hour of hourTickMarks(end)) {
    const span = document.createElement("span");
    span.style.setProperty("--p", String(end === 0 ? 0 : (hour / end) * 100));
    span.textContent = hour === end ? `${hour}h` : String(hour);
    hourTicks.appendChild(span);
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR_MS = 3600 * 1000;
const AGING_MS = 12 * HOUR_MS;
const STALE_MS = 18 * HOUR_MS;
const CATALOG_CHECK_MS = 10 * 60 * 1000;

function two(value) {
  return String(value).padStart(2, "0");
}

// "Tue 07 Oct 18:00 UTC", or "07 Oct 18:00 UTC" without the weekday.
function utcStamp(ms, weekday) {
  const date = new Date(ms);
  const day = `${two(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC`;
  return weekday ? `${WEEKDAYS[date.getUTCDay()]} ${day}` : day;
}

const clock = {
  cycle: null,
  label: null,
  cycleMs: 0,
  validMinute: NaN,
  validText: "",
  lead: NaN,
  atStart: null,
  atEnd: null,
};
let newerRuns = [];

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function setStepEnabled(button, other, disabled) {
  if (!button || button.disabled === disabled) return;
  // A disabled button drops keyboard focus, so hand it to the opposite step button.
  const focused = document.activeElement === button;
  button.disabled = disabled;
  if (focused && other && !other.disabled) other.focus();
}

// Called per animation frame while playing: nothing here touches the DOM unless a value
// changed (the valid time changes every frame on fast loops, as before).
function updateClock() {
  const meta = modelMeta();
  const rounded = Math.round(displayHour);
  if (rounded !== clock.lead) {
    clock.lead = rounded;
    setText(leadEl, `F${String(rounded).padStart(3, "0")}`);
  }
  const hourText = String(displayHour);
  if (hourInput.value !== hourText) hourInput.value = hourText;
  paintRange(hourInput);
  const hours = forecastHours();
  const atStart = displayHour <= hours[0] + 1e-6;
  const atEnd = displayHour >= hours[hours.length - 1] - 1e-6;
  if (atStart !== clock.atStart) {
    clock.atStart = atStart;
    setStepEnabled(stepBackButton, stepFwdButton, atStart);
  }
  if (atEnd !== clock.atEnd) {
    clock.atEnd = atEnd;
    setStepEnabled(stepFwdButton, stepBackButton, atEnd);
  }
  if (!meta?.cycle) {
    setText(validEl, "–");
    if (clock.cycle) {
      clock.cycle = null;
      setText(initEl, "–");
      updateAge();
    }
    return;
  }
  if (clock.cycle !== meta.cycle || clock.label !== meta.label) {
    clock.cycle = meta.cycle;
    clock.label = meta.label;
    clock.cycleMs = new Date(meta.cycle).getTime();
    clock.validMinute = NaN;
    const resolution = /(\d+(?:\.\d+)?)\s*°/.exec(meta.source || "")?.[1] || "0.25";
    setText(initEl, `${meta.label} ${resolution}° · init ${utcStamp(clock.cycleMs, false)}`);
    updateAge();
  }
  const validMs = clock.cycleMs + displayHour * HOUR_MS;
  const minute = Math.round(validMs / 60000);
  if (minute !== clock.validMinute) {
    clock.validMinute = minute;
    clock.validText = utcStamp(minute * 60000, true);
  }
  setText(validEl, clock.validText);
}

// Data age: now minus the init time of the loaded run. GFS and AIGFS start a run every
// 6 h and it shows up 3.5 to 5 h later, so 12 h is one missed cycle (aging) and 18 h is
// two (stale). Runs once a minute, never per frame.
function updateAge() {
  if (!ageEl) return;
  if (!clock.cycle) {
    setText(ageEl, "");
    ageEl.removeAttribute("data-stale");
    ageEl.removeAttribute("data-newer");
    return;
  }
  const age = Math.max(0, Date.now() - clock.cycleMs);
  const hours = Math.floor(age / HOUR_MS);
  let text;
  if (age < HOUR_MS) text = `run ${Math.max(1, Math.floor(age / 60000))} min old`;
  else if (hours < 48) text = `run ${hours} h old`;
  else text = `run ${Math.floor(hours / 24)} d ${hours % 24} h old`;
  let newer = "";
  if (newerRuns.length) {
    const current = newerRuns.some((model) => model.id === modelId);
    newer = current ? "newer run available — reload" : `newer ${newerRuns[0].label} run available — reload`;
    text += ` · ${newer}`;
  }
  const state = age > STALE_MS ? "stale" : age >= AGING_MS ? "aging" : "ok";
  setText(ageEl, text);
  if (ageEl.getAttribute("data-stale") !== state) ageEl.setAttribute("data-stale", state);
  if (newer) ageEl.setAttribute("data-newer", "true");
  else ageEl.removeAttribute("data-newer");
  ageEl.title = newer ? "A newer model run has been published. Reload the page to load it." : "";
}

// The loaded catalog is never swapped under the user. A fresh copy is only compared
// with it, and a newer run is announced in the age line.
let catalogChecking = false;
let catalogCheckedAt = 0;

async function checkCatalog() {
  if (catalogChecking || !catalog) return;
  catalogChecking = true;
  catalogCheckedAt = Date.now();
  try {
    const response = await fetch(catalogUrl(), { cache: "no-store" });
    if (!response.ok) return;
    const latest = await response.json();
    const fresher = [];
    for (const model of latest.models || []) {
      if (!model.cycle) continue;
      const loaded = catalog.models.find((item) => item.id === model.id);
      if (!loaded?.cycle || model.cycle > loaded.cycle) fresher.push({ id: model.id, label: model.label });
    }
    const same = fresher.length === newerRuns.length && fresher.every((model, i) => model.id === newerRuns[i].id);
    newerRuns = fresher;
    if (!same) updateAge();
  } catch {
    /* offline or server restarting: try again next time */
  } finally {
    catalogChecking = false;
  }
}

function startClockTimers() {
  setInterval(updateAge, 60 * 1000);
  setInterval(checkCatalog, CATALOG_CHECK_MS);
  // Timers are throttled in background tabs, so catch up as soon as the tab is shown.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    updateAge();
    if (Date.now() - catalogCheckedAt > CATALOG_CHECK_MS) checkCatalog();
  });
}

// Sorted hour lists per bucket. Buckets are managed elsewhere and frames can be
// evicted, so a cached list is reused only while it matches the bucket exactly:
// same size and every cached hour still present.
const sortedHours = new WeakMap();

function hoursOf(store) {
  const cached = sortedHours.get(store);
  if (cached && cached.length === store.size) {
    let same = true;
    for (let i = 0; i < cached.length; i++) {
      if (!store.has(cached[i])) {
        same = false;
        break;
      }
    }
    if (same) return cached;
  }
  const fresh = [...store.keys()].sort((a, b) => a - b);
  sortedHours.set(store, fresh);
  return fresh;
}

function bracketFrom(store, hour) {
  const have = hoursOf(store);
  if (!have.length) return null;
  let before = have[0];
  let after = have[have.length - 1];
  for (const value of have) {
    if (value <= hour) before = value;
    if (value >= hour) {
      after = value;
      break;
    }
  }
  if (after < hour) after = before;
  const mix = before === after ? 0 : (hour - before) / (after - before);
  return { before, after, mix };
}

function covers(span, hour) {
  if (!span) return false;
  if (span.before - 1e-6 > hour || span.after + 1e-6 < hour) return false;
  if (span.before === span.after && Math.abs(span.before - hour) > 1e-3) return false;
  return true;
}

function frameCovers(span, hour) {
  if (covers(span, hour)) return true;
  if (!span || span.before !== span.after) return false;
  const next = forecastHours().find((value) => value > span.before + 1e-6);
  if (next == null) return Math.abs(span.before - hour) <= 1e-3;
  return span.before <= hour && hour < next;
}

// Frame cache. Every decoded grid (u, v, texture copies, height, analysis...) is counted
// by the real byte length of the buffers it holds, and the total is kept under
// FRAME_BUDGET by evicting the frames that are needed last. A later request for an
// evicted frame simply fetches it again.
const MB = 1048576;
const frameMeta = new WeakMap();
const frameBytesByLayer = new Map();
const FRAME_BUDGET = frameBudgetBytes();
let cacheBytes = 0;
let useClock = 0;

// Budget for cached frames (one 0.25 degree wind or scalar frame is about 20 MB, pressure
// about 8 MB). Mobile Safari kills tabs at roughly 1 to 1.5 GB for everything including
// GPU textures, so phones get 256 MB (200 MB when deviceMemory reports 2 GB or less) and
// tablets 400 MB. Laptops and desktops get 320, 640 or 800 MB for deviceMemory of 2 or
// less, 4, 8, and 640 MB when it is unknown (Safari, Firefox). "?frameBudgetMB=n" overrides.
function frameBudgetBytes() {
  try {
    const override = Number(new URLSearchParams(location.search).get("frameBudgetMB"));
    if (override > 0) return override * MB;
  } catch {}
  const memory = Number(navigator.deviceMemory) || 0;
  let mb = 640;
  if (memory) mb = memory >= 8 ? 800 : memory >= 4 ? 640 : 320;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (coarse) {
    const phone = Math.min(screen.width, screen.height) < 600;
    mb = Math.min(mb, phone ? (memory && memory <= 2 ? 200 : 256) : 400);
  }
  return mb * MB;
}

function frameBytes(grid) {
  const seen = new Set();
  let total = 0;
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (ArrayBuffer.isView(value)) {
      if (!seen.has(value.buffer)) {
        seen.add(value.buffer);
        total += value.buffer.byteLength;
      }
      return;
    }
    for (const key in value) visit(value[key]);
  };
  visit(grid);
  return total;
}

class FrameStore extends Map {
  constructor(model, id) {
    super();
    this.model = model;
    this.id = id;
  }

  get(hour) {
    const grid = super.get(hour);
    const meta = grid && frameMeta.get(grid);
    if (meta) meta.used = ++useClock;
    return grid;
  }

  set(hour, grid) {
    const old = super.get(hour);
    if (old === grid) return this;
    if (old) this.release(old);
    super.set(hour, grid);
    const bytes = frameBytes(grid);
    frameMeta.set(grid, { bytes, used: ++useClock });
    frameBytesByLayer.set(this.id, bytes);
    cacheBytes += bytes;
    trimFrames();
    return this;
  }

  delete(hour) {
    const grid = super.get(hour);
    if (!grid) return false;
    this.release(grid);
    return super.delete(hour);
  }

  clear() {
    for (const grid of super.values()) this.release(grid);
    super.clear();
  }

  release(grid) {
    const meta = frameMeta.get(grid);
    if (!meta) return;
    cacheBytes -= meta.bytes;
    frameMeta.delete(grid);
  }
}

function cacheStores() {
  return [...fieldFrames.values(), ...pressureFrames.values()];
}

// Forecast hours until a frame is needed: distance from displayHour, and while playing
// only the way ahead counts (wrapping to the start), so frames just behind the playhead
// are the cheapest to give up.
function neededIn(model, hour) {
  if (model !== modelId) return Infinity;
  let delta = hour - displayHour;
  if (forecastPlaying && delta < -6) delta += forecastEnd();
  return Math.abs(delta);
}

// Grids that must stay: what the layers draw at displayHour (the nearest cached frames on
// either side, for the motion layer, the underlay and pressure) and the model's own
// before/after frames for displayHour in every layer.
function displayedFrames() {
  const keep = new Set();
  let lo = null;
  let hi = null;
  for (const hour of forecastHours()) {
    if (hour <= displayHour + 1e-6) lo = hour;
    if (hour >= displayHour - 1e-6) {
      hi = hour;
      break;
    }
  }
  const shown = [fieldFrames.get(`${modelId}:${motionId}`)];
  if (underlayId) shown.push(fieldFrames.get(`${modelId}:${underlayId}`));
  if (needsPressure()) shown.push(pressureFrames.get(modelId));
  for (const store of cacheStores()) {
    if (store.model !== modelId) continue;
    for (const hour of [lo, hi]) {
      const grid = hour == null ? null : Map.prototype.get.call(store, hour);
      if (grid) keep.add(grid);
    }
  }
  for (const store of shown) {
    const span = store && bracketFrom(store, displayHour);
    if (!span) continue;
    keep.add(Map.prototype.get.call(store, span.before));
    keep.add(Map.prototype.get.call(store, span.after));
  }
  return keep;
}

function trimFrames() {
  if (cacheBytes <= FRAME_BUDGET) return;
  const keep = displayedFrames();
  const shownIds = new Set([motionId, underlayId]);
  const candidates = [];
  for (const store of cacheStores()) {
    const here = store.model === modelId;
    const shown = store.id === "pressure" ? needsPressure() : shownIds.has(store.id);
    // Other models first (least recently used first), then layers that are not on
    // screen, then the shown layers, each farthest from displayHour first.
    const tier = !here ? 2 : shown ? 0 : 1;
    for (const [hour, grid] of store) {
      if (keep.has(grid)) continue;
      candidates.push({ store, hour, tier, far: here ? neededIn(store.model, hour) : 0, used: frameMeta.get(grid)?.used || 0 });
    }
  }
  candidates.sort((a, b) => b.tier - a.tier || b.far - a.far || a.used - b.used);
  for (const item of candidates) {
    if (cacheBytes <= FRAME_BUDGET) break;
    item.store.delete(item.hour);
  }
}

globalThis.__frameCache = {
  stats: () => ({ bytes: cacheBytes, budget: FRAME_BUDGET, frames: cacheStores().reduce((n, store) => n + store.size, 0) }),
};

function fieldBucket(model, id) {
  const key = `${model}:${id}`;
  if (!fieldFrames.has(key)) fieldFrames.set(key, new FrameStore(model, id));
  return fieldFrames.get(key);
}

function pressureBucket() {
  return pressureBucketFor(modelId);
}

// What the layer, labels and status were last given. A frame is identified by
// object, not hour, so a frame that was evicted and reloaded counts as new.
const applied = { sceneKey: null, zero: null, frames: [] };
const SOFT_MS = 100;
let lastSoft = 0;

function gatherField() {
  const motion = motionSpec();
  const scene = sceneFor();
  if (!motion || !scene) return null;
  const under = underlaySpec();
  const motionStore = fieldBucket(modelId, motion.id);
  const motionSpan = bracketFrom(motionStore, displayHour);
  const motionReady = frameCovers(motionSpan, displayHour) ? motionSpan : null;
  let scalarStore = null;
  let scalarReady = null;
  if (under?.kind === "scalar") {
    scalarStore = fieldBucket(modelId, under.id);
    const span = bracketFrom(scalarStore, displayHour);
    scalarReady = frameCovers(span, displayHour) ? span : null;
  }
  const ownMotion = scene.contour?.source === "hgt" || scene.contour?.source === "wave";
  const contourStore = ownMotion ? motionStore : fieldBucket(modelId, (under || motion).id);
  const contourCandidate = ownMotion ? motionSpan : bracketFrom(contourStore, displayHour);
  const contourSpan = frameCovers(contourCandidate, displayHour) ? contourCandidate : null;
  return {
    scene,
    motion,
    under,
    mix: motionReady ? motionReady.mix : 0,
    primary: motionReady ? motionStore.get(motionReady.before) : null,
    secondary: motionReady ? motionStore.get(motionReady.after) : null,
    scalarMix: scalarReady ? scalarReady.mix : 0,
    scalarPrimary: scalarReady ? scalarStore.get(scalarReady.before) : null,
    scalarSecondary: scalarReady ? scalarStore.get(scalarReady.after) : null,
    analysis: syncAnalysis(scene, contourStore, contourSpan),
  };
}

function fieldChanged(g) {
  const zero = Math.round(displayHour) === 0;
  const f = applied.frames;
  const same = applied.sceneKey === g.scene.key
    && applied.zero === zero
    && f[0] === g.primary
    && f[1] === g.secondary
    && f[2] === g.scalarPrimary
    && f[3] === g.scalarSecondary
    && f[4] === g.analysis.primary
    && f[5] === g.analysis.secondary;
  if (same) return false;
  applied.zero = zero;
  f[0] = g.primary;
  f[1] = g.secondary;
  f[2] = g.scalarPrimary;
  f[3] = g.scalarSecondary;
  f[4] = g.analysis.primary;
  f[5] = g.analysis.secondary;
  return true;
}

function applyField(g, playing, now) {
  const changed = fieldChanged(g);
  if (changed) {
    if (applied.sceneKey !== g.scene.key) {
      applied.sceneKey = g.scene.key;
      layer.setView(g.scene);
    }
    layer.setFrames(g.primary, g.secondary, g.mix);
    layer.setScalar(g.scalarPrimary, g.scalarSecondary, g.scalarMix);
    layer.setPressure(g.analysis.primary, g.analysis.secondary, g.analysis.mix);
  } else {
    // Same frames, so only the interpolation weights move.
    if (g.primary) layer.setFrames(g.primary, g.secondary, g.mix);
    if (g.scalarPrimary) layer.setScalar(g.scalarPrimary, g.scalarSecondary, g.scalarMix);
    if (g.analysis.primary) layer.setPressure(g.analysis.primary, g.analysis.secondary, g.analysis.mix);
  }
  syncLabels(g.scene);
  if (playing && !changed) {
    if (now - lastSoft < SOFT_MS) return;
  } else {
    paintLegend(g.under || g.motion);
    paintStatus();
  }
  lastSoft = now;
  refreshPin();
  if (hoverPoint) showHover(hoverPoint.lng, hoverPoint.lat);
}

// Full refresh for anything that is not the animation clock: scrubbing, layer or
// model changes, arriving frames.
function refreshField() {
  const g = gatherField();
  if (g) applyField(g, false, performance.now());
}

// Per-frame path while the forecast plays. Frames and scene are re-checked every
// frame (cheap), but the pin and hover readouts are throttled between bracket changes.
function stepField(now) {
  const g = gatherField();
  if (g) applyField(g, true, now);
}

function syncAnalysis(view, store, span) {
  const none = { primary: null, secondary: null, mix: 0 };
  const source = view.contour?.source;
  if (source === "pressure") {
    const bucket = pressureBucket();
    const pressures = bracketFrom(bucket, displayHour);
    if (frameCovers(pressures, displayHour)) {
      return { primary: bucket.get(pressures.before), secondary: bucket.get(pressures.after), mix: pressures.mix };
    }
    return none;
  }
  if (source === "hgt" && span) {
    const before = store.get(span.before);
    const after = store.get(span.after);
    if (before?.analysis) {
      return { primary: before.analysis, secondary: after?.analysis || before.analysis, mix: span.mix };
    }
  }
  return none;
}

function heightNote() {
  const motion = motionSpec();
  if (!motion || underlayId) return "";
  if (contourFor(motion.id)?.source !== "hgt") return "";
  const store = fieldBucket(modelId, motion.id);
  const span = bracketFrom(store, displayHour);
  if (!covers(span, displayHour)) return "";
  const grid = store.get(span.before);
  if (!grid || grid.hgt) return "";
  return `No geopotential height in this ${modelMeta()?.label || "model"} ${motion.level} file.`;
}

function emptyAccumVisible() {
  if (focusId() !== "apcp") return false;
  if (Math.round(displayHour) !== 0) return false;
  const grid = fieldBucket(modelId, "apcp").get(0);
  return !!grid?.emptyAccum;
}

function paintStatus() {
  const text = statusText();
  if (statusEl.textContent !== text) statusEl.textContent = text;
}

function statusText() {
  const jobs = [...loading.values()];
  const urgent = jobs.filter((job) => job.priority > 0);
  if (urgent.length) {
    const labels = [...new Set(urgent.map((job) => job.label))];
    return `Loading ${labels.slice(0, 2).join(" · ")}`;
  }
  if (emptyAccumVisible()) return "Accumulation has not started";
  if (jobs.length) return "Loading the pinned forecast";
  if (statusHold) return statusHold;
  return heightNote();
}

const NO_LABELS = { type: "FeatureCollection", features: [] };
const labelsApplied = { source: null, grid: undefined, key: "" };
const labelCache = new WeakMap();

function refreshLabels() {
  syncLabels(sceneFor());
}

// Labels depend only on the frame they are read from (the nearer of the bracket
// at mix 0.5), the scene and the zoom class, so setData runs when one of those
// changes. Results are kept per frame so looping playback does not recompute them.
function syncLabels(scene) {
  const source = map.getSource("isobars");
  if (!scene || !source) return;
  // A scene without contours (the isobars switched off, or a layer that has none) shows no labels.
  const contour = scene.contour;
  let grid = null;
  if (contour) {
    const owner = contour.source === "hgt" || contour.source === "wave" || contour.source === "pressure" && !underlayId
      ? motionSpec()
      : (underlaySpec() || motionSpec());
    if (!owner) return;
    const store = contour.source === "pressure" ? pressureBucket() : fieldBucket(modelId, owner.id);
    const span = bracketFrom(store, displayHour);
    grid = labelGrid(contour, span, store);
  }
  syncCenters(grid, contour);
  const key = `${scene.key}|${map.getZoom() < 2.2}`;
  if (labelsApplied.source === source && labelsApplied.grid === grid && labelsApplied.key === key) return;
  labelsApplied.source = source;
  labelsApplied.grid = grid;
  labelsApplied.key = key;
  if (!grid) {
    source.setData(NO_LABELS);
    return;
  }
  let perKey = labelCache.get(grid);
  if (!perKey) {
    perKey = new Map();
    labelCache.set(grid, perKey);
  }
  let data = perKey.get(key);
  if (!data) {
    if (perKey.size >= 4) perKey.clear();
    data = contourLabels(grid, contour);
    perKey.set(key, data);
  }
  source.setData(data);
}

// H and L markers follow the pressure contours: they are shown for the same grid, and
// only when that grid is sea-level pressure. The search is done once per grid and kept.
const centersApplied = { source: null, grid: undefined };
const centersCache = new WeakMap();

function syncCenters(grid, contour) {
  const source = map.getSource("pressure-centers");
  if (!source) return;
  const shown = contour?.label === "hpa" && grid ? grid : null;
  if (centersApplied.source === source && centersApplied.grid === shown) return;
  centersApplied.source = source;
  centersApplied.grid = shown;
  if (!shown) {
    source.setData(NO_LABELS);
    return;
  }
  let data = centersCache.get(shown);
  if (!data) {
    data = pressureCenters(shown, contour);
    centersCache.set(shown, data);
  }
  source.setData(data);
}

const CENTER_RADIUS_KM = 1000;
const CENTER_RING_KM = 700;
const CENTER_MIN_PROMINENCE_HPA = 3;
const CENTER_MAX_LAT = 80;
const CENTER_MAX_EACH = 20;
const CENTER_TROPICS_LAT = 25;
const CENTER_TROPICS_MIN_HPA = 6;
const EARTH_KM = 6371;
const RAD = Math.PI / 180;

// Pressure centers: a high (low) is a cell that is the highest (lowest) within
// CENTER_RADIUS_KM and stands out from the mean of a ring CENTER_RING_KM around it by at
// least CENTER_MIN_PROMINENCE_HPA (CENTER_TROPICS_MIN_HPA within CENTER_TROPICS_LAT of the
// equator, where reduced-to-sea-level pressure over terrain and thermal lows are noisy),
// so flat areas get no marker. The search runs on a grid of about one degree (box means
// of the model grid), which keeps it to a few tens of milliseconds, once per frame; the
// marker value and position are then refined on the full grid.
// Poleward of CENTER_MAX_LAT nothing is marked. Longitude wraps. At most
// CENTER_MAX_EACH highs and as many lows are kept, strongest first.
function pressureCenters(grid, contour) {
  const features = [];
  const field = contour.source === "pressure" ? grid.hpa : grid.values;
  if (!field || grid.ni < 90 || grid.nj < 45) return { type: "FeatureCollection", features };
  const { ni, nj } = grid;
  const f = Math.max(1, Math.round(ni / 360));
  const nx = Math.floor(ni / f);
  const ny = Math.round((nj - 1) / f) + 1;
  const dLon = 360 / nx;
  const coarse = new Float32Array(nx * ny).fill(NaN);
  const half = Math.floor(f / 2);
  for (let cy = 0; cy < ny; cy++) {
    const yc = Math.round((cy * (nj - 1)) / (ny - 1));
    const y0 = Math.max(0, yc - half);
    const y1 = Math.min(nj - 1, yc + half);
    for (let cx = 0; cx < nx; cx++) {
      const xc = cx * f;
      let sum = 0;
      let count = 0;
      for (let y = y0; y <= y1; y++) {
        for (let k = -half; k <= half; k++) {
          const v = field[y * ni + ((xc + k + ni) % ni)];
          if (v === v) {
            sum += v;
            count++;
          }
        }
      }
      if (count) coarse[cy * nx + cx] = sum / count;
    }
  }
  const latOf = (cy) => 90 - (cy * 180) / (ny - 1);
  const sinLat = new Float64Array(ny);
  const cosLat = new Float64Array(ny);
  for (let cy = 0; cy < ny; cy++) {
    sinLat[cy] = Math.sin(latOf(cy) * RAD);
    cosLat[cy] = Math.cos(latOf(cy) * RAD);
  }
  const cosRadius = Math.cos(CENTER_RADIUS_KM / EARTH_KM);
  const rowReach = Math.ceil((CENTER_RADIUS_KM / EARTH_KM) / RAD / (180 / (ny - 1)));
  const firstRow = Math.ceil((90 - CENTER_MAX_LAT) / (180 / (ny - 1)));
  const lastRow = ny - 1 - firstRow;
  // Does the cell hold the extreme value (sign +1 for a high, -1 for a low) within the radius?
  const isExtreme = (cx, cy, sign) => {
    const v = coarse[cy * nx + cx] * sign;
    for (let r = Math.max(0, cy - rowReach); r <= Math.min(ny - 1, cy + rowReach); r++) {
      const denom = cosLat[cy] * cosLat[r];
      const need = denom < 1e-9 ? -2 : (cosRadius - sinLat[cy] * sinLat[r]) / denom;
      if (need > 1) continue;
      const reach = need <= -1 ? Math.floor(nx / 2) : Math.min(Math.floor(nx / 2), Math.ceil(Math.acos(need) / RAD / dLon));
      for (let k = -reach; k <= reach; k++) {
        const o = coarse[r * nx + ((cx + k + nx) % nx)] * sign;
        if (o > v) return false;
      }
    }
    return true;
  };
  const ringMean = (lat, lon) => {
    const delta = CENTER_RING_KM / EARTH_KM;
    const sinPhi = Math.sin(lat * RAD);
    const cosPhi = Math.cos(lat * RAD);
    let sum = 0;
    let count = 0;
    for (let step = 0; step < 16; step++) {
      const theta = (step / 16) * 2 * Math.PI;
      const sinLat2 = sinPhi * Math.cos(delta) + cosPhi * Math.sin(delta) * Math.cos(theta);
      const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
      const lon2 = lon * RAD + Math.atan2(Math.sin(theta) * Math.sin(delta) * cosPhi, Math.cos(delta) - sinPhi * sinLat2);
      const cy = Math.round((90 - lat2 / RAD) / 180 * (ny - 1));
      const cx = ((Math.round((lon2 / RAD) / dLon) % nx) + nx) % nx;
      const v = coarse[Math.max(0, Math.min(ny - 1, cy)) * nx + cx];
      if (v === v) {
        sum += v;
        count++;
      }
    }
    return count >= 12 ? sum / count : NaN;
  };
  const found = [];
  for (let cy = firstRow; cy <= lastRow; cy++) {
    const lat = latOf(cy);
    for (let cx = 0; cx < nx; cx++) {
      const v = coarse[cy * nx + cx];
      if (v !== v) continue;
      // Cheap pre-test against the eight neighbours, then the full radius.
      let low = true;
      let high = true;
      for (let dy = -1; dy <= 1 && (low || high); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dy && !dx) continue;
          const o = coarse[(cy + dy) * nx + ((cx + dx + nx) % nx)];
          if (o !== o) continue;
          if (o < v) low = false;
          if (o > v) high = false;
        }
      }
      for (const sign of [-1, 1]) {
        if (!(sign < 0 ? low : high) || !isExtreme(cx, cy, sign)) continue;
        const lon = cx * dLon;
        const ring = ringMean(lat, lon);
        if (ring !== ring) continue;
        // Refine on the model grid: the extreme cell within one coarse cell of the center.
        const xc = cx * f;
        const yc = Math.round((cy * (nj - 1)) / (ny - 1));
        let best = NaN;
        let bx = xc;
        let by = yc;
        for (let y = Math.max(0, yc - f); y <= Math.min(nj - 1, yc + f); y++) {
          for (let k = -f; k <= f; k++) {
            const x = (xc + k + ni) % ni;
            const o = field[y * ni + x];
            if (o === o && (best !== best || o * sign > best * sign)) {
              best = o;
              bx = x;
              by = y;
            }
          }
        }
        if (best !== best) continue;
        const prominence = (best - ring) * sign;
        const latFine = 90 - (by / (nj - 1)) * 180;
        const needed = Math.abs(latFine) < CENTER_TROPICS_LAT ? CENTER_TROPICS_MIN_HPA : CENTER_MIN_PROMINENCE_HPA;
        if (prominence < needed || Math.abs(latFine) > CENTER_MAX_LAT) continue;
        const lonFine = (bx / ni) * 360;
        found.push({ sign, prominence, hpa: best, lat: latFine, lng: lonFine > 180 ? lonFine - 360 : lonFine });
      }
    }
  }
  // Strongest first; a weaker center of the same kind within the radius of a kept one
  // (a plateau or a double minimum) is dropped.
  found.sort((a, b) => b.prominence - a.prominence);
  const kept = [];
  const counts = { 1: 0, "-1": 0 };
  for (const c of found) {
    if (counts[c.sign] >= CENTER_MAX_EACH) continue;
    const near = kept.some((k) => {
      if (k.sign !== c.sign) return false;
      const cosine = Math.sin(k.lat * RAD) * Math.sin(c.lat * RAD)
        + Math.cos(k.lat * RAD) * Math.cos(c.lat * RAD) * Math.cos((k.lng - c.lng) * RAD);
      return cosine > cosRadius;
    });
    if (near) continue;
    kept.push(c);
    counts[c.sign]++;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: { kind: c.sign > 0 ? "H" : "L", hpa: String(Math.round(c.hpa)), sort: -c.prominence },
    });
  }
  return { type: "FeatureCollection", features };
}

// Priority 1 is a frame the view needs, 0 is the pinned forecast, -1 is speculative
// prefetch (never shown in the status line). `soft` requests come from ensureAround and
// are dropped from the queue, if they have not started, once a newer ensureAround no
// longer asks for them.
async function loadField(model, id, hour, priority = 1, soft = false) {
  const key = `${model}:${id}:${hour}`;
  const bucket = fieldBucket(model, id);
  if (bucket.has(hour)) return bucket.get(hour);
  // ensureAround asks for the same frames on every animation frame while playing, so
  // skip building the label for a request that is already queued or in flight.
  const known = tasks.has(key);
  const spec = known ? null : catalog?.layers?.find((item) => item.id === id);
  const face = known ? ["", ""] : LAYER_FACE[id] || [spec?.name || id, spec?.level || ""];
  const label = known ? "" : `${face[0]} ${face[1]} F${String(hour).padStart(2, "0")}`.trim();
  return requestFrame(key, label, model, hour, priority, soft, () => fetchField(model, id, hour));
}

const MAX_ACTIVE = 4;
const tasks = new Map();
let activeTasks = 0;
let activeLow = 0;
let prefetchStamp = 0;

function requestFrame(key, label, model, hour, priority, soft, start) {
  const known = tasks.get(key);
  if (known) {
    known.stamp = prefetchStamp;
    known.soft = known.soft && soft;
    if (priority > known.priority) {
      known.priority = priority;
      const job = loading.get(key);
      if (job) job.priority = priority;
      else if (priority >= 0) loading.set(key, { label: known.label, priority });
      paintStatus();
    }
    return pending.get(key);
  }
  const task = { key, label, model, hour, priority, soft, stamp: prefetchStamp, started: false, start };
  const job = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });
  tasks.set(key, task);
  pending.set(key, job);
  const done = () => {
    tasks.delete(key);
    pending.delete(key);
    loading.delete(key);
    paintStatus();
  };
  job.then(done, done);
  if (priority >= 0) {
    loading.set(key, { label, priority });
    paintStatus();
  }
  pump();
  return job;
}

// Start queued requests while fewer than MAX_ACTIVE are in flight. The most important
// goes first, and among equals the one needed soonest at displayHour, which is decided
// when a slot frees up so it follows the playhead. Background work (pinned forecast,
// prefetch) never takes the last slot, so a frame needed now does not wait behind it.
function pump() {
  while (activeTasks < MAX_ACTIVE) {
    let best = null;
    let bestFar = 0;
    for (const task of tasks.values()) {
      if (task.started) continue;
      if (task.priority <= 0 && activeLow >= MAX_ACTIVE - 1) continue;
      const far = neededIn(task.model, task.hour);
      if (!best || task.priority > best.priority || (task.priority === best.priority && far < bestFar)) {
        best = task;
        bestFar = far;
      }
    }
    if (!best) return;
    const task = best;
    const low = task.priority <= 0;
    task.started = true;
    activeTasks += 1;
    if (low) activeLow += 1;
    task.start().then(task.resolve, task.reject).finally(() => {
      activeTasks -= 1;
      if (low) activeLow -= 1;
      pump();
    });
  }
}

function dropStaleRequests() {
  for (const task of tasks.values()) {
    if (task.started || !task.soft || task.stamp >= prefetchStamp) continue;
    task.started = true;
    task.resolve(null);
  }
}

async function fetchField(model, id, hour) {
  const grid = await runFrame({ kind: "field", url: fieldUrl(model, id, hour), layer: id, hour });
  fieldBucket(model, id).set(hour, grid);
  if (model === modelId && (id === motionId || id === underlayId)) {
    statusHold = "";
    refreshField();
  } else if (pin && model === modelId) {
    refreshPin();
  }
  return grid;
}

// Fetch, decode and texture-encode a frame in web/worker.js. A module worker
// keeps that work off the main thread and hands the typed arrays back by
// transfer. Where module workers are missing the same code runs on the main thread.
const frameWorkers = [];
const workerJobs = new Map();
let workerSeq = 0;
let workersBroken = typeof Worker === "undefined";
let mainLoader = null;

function spawnWorkers() {
  // One worker: each extra one cost 100 MB or more of renderer memory in measurements, and
  // decoding a frame takes far less time than downloading it.
  const count = 1;
  try {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL("./worker.js?v=5", import.meta.url), { type: "module" });
      worker.busy = 0;
      worker.onmessage = (event) => {
        const job = workerJobs.get(event.data.id);
        if (!job) return;
        workerJobs.delete(event.data.id);
        job.worker.busy -= 1;
        if (event.data.error != null) job.reject(new Error(event.data.error));
        else job.resolve(event.data.grid);
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        abandonWorkers();
      };
      frameWorkers.push(worker);
    }
  } catch {
    abandonWorkers();
  }
}

// The worker could not start (no module worker support, blocked script): finish what was
// sent to it on the main thread and use the main thread from now on.
function abandonWorkers() {
  workersBroken = true;
  for (const worker of frameWorkers) worker.terminate();
  frameWorkers.length = 0;
  const jobs = [...workerJobs.values()];
  workerJobs.clear();
  for (const job of jobs) runOnMain(job.request).then(job.resolve, job.reject);
}

function runOnMain(request) {
  mainLoader ||= import("./worker.js?v=5");
  return mainLoader.then((loader) => loader.loadFrame(request));
}

function runFrame(request) {
  if (!workersBroken && !frameWorkers.length) spawnWorkers();
  if (workersBroken) return runOnMain(request);
  const worker = frameWorkers.reduce((best, item) => (item.busy < best.busy ? item : best));
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    worker.busy += 1;
    workerJobs.set(id, { worker, request, resolve, reject });
    worker.postMessage({ ...request, id });
  });
}

function sampleField(spec, lng, lat) {
  const store = fieldBucket(modelId, spec.id);
  const span = bracketFrom(store, displayHour);
  if (!span) return null;
  const before = store.get(span.before);
  const after = store.get(span.after);
  if (spec.kind === "scalar") {
    const a = bilinearValue(before, lng, lat, (grid, index) => grid.values[index]);
    const b = bilinearValue(after, lng, lat, (grid, index) => grid.values[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { value: NaN };
    return { value: a + (b - a) * span.mix };
  }
  const ua = bilinearValue(before, lng, lat, (grid, index) => grid.u[index]);
  const va = bilinearValue(before, lng, lat, (grid, index) => grid.v[index]);
  const ub = bilinearValue(after, lng, lat, (grid, index) => grid.u[index]);
  const vb = bilinearValue(after, lng, lat, (grid, index) => grid.v[index]);
  const sample = {
    u: ua + (ub - ua) * span.mix,
    v: va + (vb - va) * span.mix,
  };
  if (before.height && after.height) {
    const ha = bilinearValue(before, lng, lat, (grid, index) => grid.height[index]);
    const hb = bilinearValue(after, lng, lat, (grid, index) => grid.height[index]);
    sample.height = Number.isFinite(ha) && Number.isFinite(hb) ? ha + (hb - ha) * span.mix : NaN;
  }
  return sample;
}

function bilinearValue(grid, lng, lat, read) {
  const lon = ((lng % 360) + 360) % 360;
  const x = (lon / 360) * grid.ni;
  const y = ((90 - lat) / 180) * (grid.nj - 1);
  const x0 = Math.floor(x) % grid.ni;
  const x1 = (x0 + 1) % grid.ni;
  const y0 = Math.min(grid.nj - 1, Math.max(0, Math.floor(y)));
  const y1 = Math.min(grid.nj - 1, y0 + 1);
  const tx = x - Math.floor(x);
  const ty = y - y0;
  const at = (col, row) => read(grid, row * grid.ni + col);
  const v00 = at(x0, y0);
  const v10 = at(x1, y0);
  const v01 = at(x0, y1);
  const v11 = at(x1, y1);
  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) return NaN;
  const mix = (p, q, t) => p + (q - p) * t;
  return mix(mix(v00, v10, tx), mix(v01, v11, tx), ty);
}

function hideReadout() {
  if (!readout.hidden) readout.hidden = true;
}

function showReadout(speed, detail) {
  if (readoutSpeed.textContent !== speed) readoutSpeed.textContent = speed;
  if (readoutDir.textContent !== detail) readoutDir.textContent = detail;
  if (readout.hidden) readout.hidden = false;
}

function showSample(spec, sample) {
  if (!spec || !sample) {
    hideReadout();
    return;
  }
  const hover = presentFor(spec).hover;
  if (hover === "wind") {
    if (!Number.isFinite(sample.u) || !Number.isFinite(sample.v)) {
      hideReadout();
      return;
    }
    const speed = Math.hypot(sample.u, sample.v);
    const from = (270 - (Math.atan2(sample.v, sample.u) * 180) / Math.PI + 360) % 360;
    showReadout(`${(speed * 1.943844).toFixed(1)} kt`, `from ${from.toFixed(0).padStart(3, "0")}° ${cardinal(from)}`);
  } else if (hover === "wave") {
    if (!Number.isFinite(sample.height)) {
      hideReadout();
      return;
    }
    const toward = (Math.atan2(sample.u, sample.v) * 180) / Math.PI;
    const from = (toward + 180 + 360) % 360;
    showReadout(`${sample.height.toFixed(1)} m`, `from ${from.toFixed(0).padStart(3, "0")}° ${cardinal(from)}`);
  } else if (!Number.isFinite(sample.value)) {
    hideReadout();
    return;
  } else {
    showReadout(formatValue(hover, sample.value), spec.level);
  }
}

function formatValue(hover, value) {
  if (hover === "temp") return `${(value * C_TO_F + FREEZING_F).toFixed(1)} °F`;
  if (hover === "mm") return `${(value / MM_PER_IN).toFixed(2)} in`;
  if (hover === "cape") return `${Math.round(value).toLocaleString("en-US")} J/kg`;
  if (hover === "rh") return `${Math.round(value)} %`;
  if (hover === "hpa") return `${value.toFixed(1)} hPa`;
  if (hover === "meters") return `${value.toFixed(1)} m`;
  if (hover === "seconds") return `${value.toFixed(1)} s`;
  if (hover === "vis") return `${(value / KM_PER_MI).toFixed(1)} mi`;
  return value.toFixed(1);
}

function pressureBucketFor(model) {
  if (!pressureFrames.has(model)) pressureFrames.set(model, new FrameStore(model, "pressure"));
  return pressureFrames.get(model);
}

async function loadPressure(model, hour, priority = 1, soft = false) {
  const key = `mslp:${model}:${hour}`;
  if (pressureBucketFor(model).has(hour)) return pressureBucketFor(model).get(hour);
  const label = `Pressure F${String(hour).padStart(2, "0")}`;
  return requestFrame(key, label, model, hour, priority, soft, () => fetchPressure(model, hour));
}

async function fetchPressure(model, hour) {
  const grid = await runFrame({ kind: "pressure", url: pressureUrl(model, hour) });
  pressureBucketFor(model).set(hour, grid);
  if (model === modelId && (contourFor(focusId())?.source === "pressure" || pin)) {
    if (contourFor(focusId())?.source === "pressure") refreshField();
    else refreshPin();
  }
  return grid;
}

function labelGrid(contour, span, store) {
  if (!contour) return null;
  if (contour.source === "pressure") {
    const pressures = bracketFrom(pressureBucket(), displayHour);
    if (!frameCovers(pressures, displayHour)) return null;
    const bucket = pressureBucket();
    return pressures.mix < 0.5 ? bucket.get(pressures.before) : bucket.get(pressures.after);
  }
  if (!span) return null;
  return span.mix < 0.5 ? store.get(span.before) : store.get(span.after);
}

function readContour(grid, contour, x, y) {
  const i = y * grid.ni + x;
  let value = NaN;
  if (contour.source === "pressure") value = grid.hpa?.[i];
  else if (contour.source === "hgt") value = grid.hgt?.[i];
  else if (contour.source === "wave") value = grid.height?.[i];
  else value = grid.values?.[i];
  if (!Number.isFinite(value)) return NaN;
  return value * (contour.plotScale ?? 1) + (contour.plotOffset || 0);
}

function formatContourLabel(contour, level) {
  if (contour.label === "temp") {
    const rounded = Math.round(level);
    return `${rounded < 0 ? `−${Math.abs(rounded)}` : rounded}°`;
  }
  if (contour.label === "m") return `${Math.round(level)} m`;
  if (contour.label === "hpa" || contour.label === "hgt") return String(Math.round(level));
  if (contour.label === "s") return `${Math.round(level)} s`;
  if (contour.label === "rh") return `${Math.round(level)}%`;
  if (contour.label === "mi") return `${Math.round(level)} mi`;
  if (contour.label === "in") return `${level.toFixed(2)} in`;
  return String(level);
}

function labelTargets(contour, v0, v1) {
  if (contour.labelLevels) return contour.labelLevels;
  const step = contour.labelStep;
  if (!step) return [];
  const lo = Math.min(v0, v1);
  const hi = Math.max(v0, v1);
  const min = contour.labelMin ?? -Infinity;
  const max = contour.labelMax ?? Infinity;
  const first = Math.ceil((Math.max(lo, min) - 1e-3) / step) * step;
  const out = [];
  for (let level = first; level <= hi + 1e-3 && level <= max + 1e-3; level += step) {
    const rounded = Math.round(level);
    if (rounded < min || rounded > max) continue;
    out.push(rounded);
  }
  if (Number.isFinite(contour.emphasize)) {
    const mark = contour.emphasize;
    if (mark >= min && mark <= max && mark >= lo - 1e-3 && mark <= hi + 1e-3 && !out.includes(mark)) out.push(mark);
  }
  return out;
}

function labelSpacing(contour) {
  const far = map.getZoom() < 2.2;
  if (contour.label === "hpa" || contour.label === "hgt") {
    return far ? { degrees: 10, lat: 22, lon: 30 } : { degrees: 7, lat: 12, lon: 16 };
  }
  if (contour.label === "temp" || contour.label === "s" || contour.label === "rh") {
    return far ? { degrees: 24, lat: 48, lon: 70 } : { degrees: 9, lat: 16, lon: 22 };
  }
  return far ? { degrees: 16, lat: 34, lon: 48 } : { degrees: 8, lat: 14, lon: 18 };
}

function lonGap(a, b) {
  let gap = Math.abs(a - b) % 360;
  if (gap > 180) gap = 360 - gap;
  return gap;
}

function contourLabels(grid, contour) {
  const features = [];
  if (!grid || !contour) return { type: "FeatureCollection", features };
  const spacing = labelSpacing(contour);
  const stride = Math.max(2, Math.round(spacing.degrees / (360 / grid.ni)));
  const placed = [];
  const consider = (x0, y0, x1, y1) => {
    const v0 = readContour(grid, contour, x0, y0);
    const v1 = readContour(grid, contour, x1, y1);
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) return;
    for (const level of labelTargets(contour, v0, v1)) {
      const denom = v1 - v0;
      if ((v0 - level) * (v1 - level) > 0) continue;
      if (Math.abs(denom) < 1e-4) continue;
      const t = (level - v0) / denom;
      if (t < 0 || t > 1) continue;
      const lon0 = (x0 / grid.ni) * 360;
      const lon1 = (x1 / grid.ni) * 360;
      let span = lon1 - lon0;
      if (span > 180) span -= 360;
      if (span < -180) span += 360;
      let lon = lon0 + span * t;
      if (lon >= 360) lon -= 360;
      const lat0 = 90 - (y0 / (grid.nj - 1)) * 180;
      const lat1 = 90 - (y1 / (grid.nj - 1)) * 180;
      const lat = lat0 + (lat1 - lat0) * t;
      const lng = lon > 180 ? lon - 360 : lon;
      if (placed.some((item) => Math.abs(item.lat - lat) < spacing.lat && lonGap(item.lng, lng) < spacing.lon)) continue;
      placed.push({ lat, lng });
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { label: formatContourLabel(contour, level) },
      });
    }
  };
  for (let y = 0; y < grid.nj; y += stride) {
    for (let x = 0; x < grid.ni; x += stride) {
      consider(x, y, (x + stride) % grid.ni, y);
      if (y + stride < grid.nj) consider(x, y, x, y + stride);
    }
  }
  return { type: "FeatureCollection", features };
}

// The heaviest upright stack the basemap already uses, so its glyphs are known to
// exist on the glyph server; used for the pressure labels and the H/L markers.
function heavyFont() {
  const stacks = [];
  for (const styleLayer of map.getStyle().layers) {
    const font = styleLayer.layout && styleLayer.layout["text-font"];
    if (Array.isArray(font) && font.length) stacks.push(font);
  }
  const upright = stacks.filter((font) => !/italic/i.test(font[0]));
  return upright.find((font) => /bold|medium|semibold/i.test(font.join(" "))) || upright[0] || stacks[0]
    || ["Open Sans Regular", "Arial Unicode MS Regular"];
}

function onLoadError(error) {
  statusHold = error.message;
  paintStatus();
}

function needsPressure() {
  return contourFor(focusId())?.source === "pressure";
}

function pinVerticalMode() {
  const motion = motionSpec();
  if (motion && contourFor(motion.id)?.source === "hgt") return "hgt";
  return "mslp";
}

function pinWindId() {
  const motion = motionSpec();
  if (motion?.kind === "wind") return motion.id;
  return layerReady("wind10") ? "wind10" : motionId;
}

function flowFrom(u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v) || Math.hypot(u, v) < 1e-3) return null;
  return (270 - (Math.atan2(v, u) * 180) / Math.PI + 360) % 360;
}

function formatWind(u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  const speed = Math.hypot(u, v) * 1.943844;
  const from = flowFrom(u, v);
  const body = `${speed.toFixed(0)} kt`;
  return from == null ? body : `${body} ${Math.round(from)}° ${cardinal(from)}`;
}

function pinLayer(id) {
  if (!pinData) return undefined;
  if (pinData.missing.has(id)) return null;
  return pinData.layers[id];
}

function pinCell(id, hour, key) {
  const layer = pinLayer(id);
  if (layer === undefined) return undefined;
  if (layer === null) return null;
  const index = layer.index.get(hour);
  if (index === undefined || layer.pending.has(hour)) return undefined;
  const column = layer.cols[key];
  if (!column) return null;
  const value = column[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pinBlendCell(id, key) {
  const layer = pinLayer(id);
  if (layer === undefined) return undefined;
  if (layer === null) return null;
  const hours = layer.hours;
  if (!hours.length) return null;
  const last = hours.length - 1;
  let hi = 0;
  while (hi < last && hours[hi] < displayHour - 1e-6) hi += 1;
  const lo = hi > 0 && hours[hi] > displayHour + 1e-6 ? hi - 1 : hi;
  const a = pinCell(id, hours[lo], key);
  if (lo === hi) return a;
  const b = pinCell(id, hours[hi], key);
  if (a === undefined || b === undefined) return undefined;
  if (a === null || b === null) return null;
  return a + (b - a) * ((displayHour - hours[lo]) / (hours[hi] - hours[lo]));
}

function blendedVector(id) {
  const u = pinBlendCell(id, "u");
  const v = pinBlendCell(id, "v");
  if (u === undefined || v === undefined) return undefined;
  if (u === null || v === null) return null;
  return { u, v };
}

function scalarText(id, value) {
  if (value === undefined) return "…";
  if (value === null || !Number.isFinite(value)) return "–";
  if (id === "apcp" && Math.round(displayHour) === 0 && value <= 0.05) {
    return "not started";
  }
  const spec = specById(id);
  return formatValue(presentFor(spec || { id }).hover, value);
}

function placeText(lng, lat) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
  return `${Math.abs(lat).toFixed(2)}°${ns}  ${Math.abs(wrapped).toFixed(2)}°${ew}`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_SANS = "var(--font-ui)";
const CHART_MONO = "var(--font-mono)";
// Meteogram colors come from CSS variables (--mg-*) so the chart follows the theme.
const INK = {
  ink: "var(--mg-ink)",
  label: "var(--mg-label)",
  tick: "var(--mg-tick)",
  day: "var(--mg-day)",
  now: "var(--mg-now)",
  wind: "var(--mg-wind)",
  wave: "var(--mg-wave)",
  period: "var(--mg-period)",
  arrow: "var(--mg-arrow)",
  vert: "var(--mg-vert)",
  extra: "var(--mg-extra)",
  gridMajor: "var(--mg-grid-major)",
  gridMinor: "var(--mg-grid-minor)",
  grid: "var(--mg-grid)",
  axis: "var(--mg-axis)",
  tickMajor: "var(--mg-tick-major)",
  tickMinor: "var(--mg-tick-minor)",
};

function svgNode(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    // var() is resolved reliably in style, not in every engine's presentation attributes
    if (typeof value === "string" && value.startsWith("var(")) node.style.setProperty(key, value);
    else node.setAttribute(key, String(value));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function svgText(parent, x, y, content, attrs) {
  const node = svgNode("text", {
    x: Number(x).toFixed(1),
    y: Number(y).toFixed(1),
    ...attrs,
  }, parent);
  node.textContent = content;
  return node;
}

function extraUnderlay() {
  const under = underlaySpec();
  if (!under) return null;
  if (under.id === "wvht" || under.id === "wvdir" || under.id === "wvper") return null;
  if (under.id === "mslp" && pinVerticalMode() === "mslp") return null;
  return under;
}

function chartUnits(id, value) {
  if (id === "t2m" || id === "t850" || id === "t500") return value * C_TO_F + FREEZING_F;
  if (id === "apcp") return value / MM_PER_IN;
  if (id === "vis") return value / KM_PER_MI;
  return value;
}

function seriesExtent(values, zero, floor) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return { min: 0, max: floor };
  const max = Math.max(...nums);
  if (zero) return { min: 0, max: Math.max(floor, max * 1.12) };
  const min = Math.min(...nums);
  const span = Math.max(max - min, floor);
  return { min: min - span * 0.16, max: max + span * 0.16 };
}

function underExtent(id, values) {
  if (id === "rh2m") return { min: 0, max: 100 };
  const zero = id === "apcp" || id === "cape" || id === "vis";
  const floor = id === "apcp" ? 0.25 : id === "vis" ? 6 : id.startsWith("t") ? 8 : 1;
  return seriesExtent(values, zero, floor);
}

function formatTick(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.abs(value) >= 100 || Math.abs(value - Math.round(value)) < 0.05
    ? Math.round(value)
    : Number(value.toFixed(1));
  const text = String(rounded);
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

function axisTicks(min, max) {
  if (!(max > min)) return [min];
  const mid = min + (max - min) / 2;
  return [min, mid, max];
}

function glyphHours(hours, xOf, minGap = 28) {
  const picked = new Set();
  let last = -1e9;
  for (const hour of hours) {
    const x = xOf(hour);
    if (!picked.size || x - last >= minGap) {
      picked.add(hour);
      last = x;
    }
  }
  return picked;
}

const METEO_SPAN = 168;
const METEO_STEP = 6;
const METEO_WIDTH = 690;

function chartWindow() {
  const available = forecastHours();
  const first = available[0] ?? 0;
  const last = available[available.length - 1] ?? first;
  const span = Math.min(METEO_SPAN, Math.max(0, last - first));
  let start = Math.floor(displayHour);
  if (start < first) start = first;
  let end = start + span;
  if (end > last) {
    end = last;
    start = Math.max(first, end - span);
  }
  const hours = available.filter((hour) => hour >= start - 1e-6 && hour <= end + 1e-6 && hour % METEO_STEP === 0);
  return { start, end, hours };
}

function chartWhen(hour) {
  const cycle = modelMeta()?.cycle;
  if (!cycle) return null;
  return new Date(new Date(cycle).getTime() + hour * 3600 * 1000);
}

function chartDayLabel(hour) {
  const when = chartWhen(hour);
  if (!when) return `${Math.round(hour)}h`;
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(when);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric" }).format(when);
  return `${weekday} ${day}`;
}

function chartNowLabel(hour) {
  const when = chartWhen(hour);
  if (!when) return `F${String(Math.round(hour)).padStart(3, "0")}`;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(when);
  return `${clock}Z`;
}

function chartDayMarks(start, end) {
  const marks = [];
  for (let hour = start; hour <= end + 1e-6; hour += 24) marks.push(hour);
  if (!marks.length) return [start];
  const tail = marks[marks.length - 1];
  if (end - tail > 12) marks.push(end);
  else if (end - tail > 1e-6) marks[marks.length - 1] = end;
  return marks;
}

function rangeText(points, key, unit, digits) {
  const nums = [];
  for (const point of points) {
    if (typeof point[key] === "number") nums.push(point[key]);
  }
  if (!nums.length) return "";
  const fmt = (value) => (digits ? value.toFixed(digits) : String(Math.round(value)));
  return `${fmt(Math.min(...nums))}–${fmt(Math.max(...nums))} ${unit}`;
}

function windSamples(windId) {
  return forecastHours().map((hour) => {
    const u = pinCell(windId, hour, "u");
    const v = pinCell(windId, hour, "v");
    if (u === undefined || v === undefined) return { hour, value: undefined, from: undefined };
    if (u === null || v === null) return { hour, value: null, from: null };
    return { hour, value: Math.hypot(u, v) * 1.943844, from: flowFrom(u, v) };
  });
}

function waveSamples() {
  const allowed = new Set(waveSampleHours());
  const haveDir = layerReady("wvdir");
  const havePer = layerReady("wvper");
  const haveHt = layerReady("wvht");
  return forecastHours().map((hour) => {
    if (!allowed.has(hour)) return { hour, height: null, from: null, period: null };
    let height;
    let from;
    if (haveDir) {
      height = pinCell("wvdir", hour, "height");
      if (height === undefined) {
        from = undefined;
      } else {
        const u = pinCell("wvdir", hour, "u");
        const v = pinCell("wvdir", hour, "v");
        from = typeof height === "number" && u !== null && v !== null ? flowFrom(u, v) : null;
      }
    } else if (haveHt) {
      height = pinCell("wvht", hour, "values");
      from = null;
    } else {
      height = null;
      from = null;
    }
    const period = havePer ? pinCell("wvper", hour, "values") : null;
    return { hour, height, from, period };
  });
}

function verticalSamples(mode) {
  return forecastHours().map((hour) => ({
    hour,
    value: mode === "hgt" ? pinCell(motionId, hour, "hgt") : pinCell("mslp", hour, "values"),
  }));
}

function underSamples(spec) {
  return forecastHours().map((hour) => {
    const raw = pinCell(spec.id, hour, "values");
    if (raw === undefined) return { hour, value: undefined };
    if (raw === null) return { hour, value: null };
    if (spec.id === "apcp" && hour === 0 && raw <= 0.05) return { hour, value: null };
    return { hour, value: chartUnits(spec.id, raw) };
  });
}

function drawSeries(parent, points, xOf, yOf, stroke, dash) {
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const d = run.map((pair, index) => `${index ? "L" : "M"}${pair[0].toFixed(1)} ${pair[1].toFixed(1)}`).join("");
      const attrs = {
        d,
        fill: "none",
        stroke,
        "stroke-width": 2.3,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      };
      if (dash) attrs["stroke-dasharray"] = dash;
      svgNode("path", attrs, parent);
    } else if (run.length === 1) {
      svgNode("circle", {
        cx: run[0][0].toFixed(1),
        cy: run[0][1].toFixed(1),
        r: 3,
        fill: stroke,
      }, parent);
    }
    run = [];
  };
  for (const point of points) {
    if (typeof point.value !== "number") {
      flush();
      continue;
    }
    run.push([xOf(point.hour), yOf(point.value)]);
  }
  flush();
}

function drawWaits(parent, points, xOf, y) {
  for (const point of points) {
    if (point.value !== undefined) continue;
    const x = xOf(point.hour);
    svgNode("line", {
      x1: x.toFixed(1),
      x2: x.toFixed(1),
      y1: (y - 7).toFixed(1),
      y2: (y + 7).toFixed(1),
      stroke: INK.label,
      "stroke-width": 1.6,
      "stroke-linecap": "round",
    }, parent);
  }
}

function drawBarb(parent, x, y, fromDeg, knots, south) {
  const speed = Number.isFinite(knots) ? knots : 0;
  if (speed < 2.5 || !Number.isFinite(fromDeg)) {
    svgNode("circle", {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: 2.6,
      fill: "none",
      stroke: INK.ink,
      "stroke-width": 1.4,
    }, parent);
    return;
  }
  const from = (fromDeg * Math.PI) / 180;
  const fx = Math.sin(from);
  const fy = -Math.cos(from);
  const tx = -fx;
  const ty = -fy;
  const side = south ? -1 : 1;
  const lx = Math.cos(from) * side;
  const ly = Math.sin(from) * side;
  const staff = 12;
  const tailX = x + fx * staff * 0.62;
  const tailY = y + fy * staff * 0.62;
  const tipX = x + tx * staff * 0.38;
  const tipY = y + ty * staff * 0.38;
  const group = svgNode("g", {
    fill: INK.ink,
    stroke: INK.ink,
    "stroke-width": 1.35,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }, parent);
  svgNode("line", {
    x1: tailX.toFixed(1),
    y1: tailY.toFixed(1),
    x2: tipX.toFixed(1),
    y2: tipY.toFixed(1),
  }, group);
  let remain = Math.round(speed / 5) * 5;
  const pennants = Math.floor(remain / 50);
  remain -= pennants * 50;
  const full = Math.floor(remain / 10);
  const half = remain % 10 >= 5;
  let dist = 0;
  const at = (offset) => [tailX + tx * offset, tailY + ty * offset];
  for (let i = 0; i < pennants; i += 1) {
    const [x0, y0] = at(dist);
    const [x1, y1] = at(dist + 4);
    svgNode("polygon", {
      points: `${x0.toFixed(1)},${y0.toFixed(1)} ${(x0 + lx * 6).toFixed(1)},${(y0 + ly * 6).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`,
    }, group);
    dist += 5;
  }
  const feather = (len, offset) => {
    const [x0, y0] = at(offset);
    svgNode("line", {
      x1: x0.toFixed(1),
      y1: y0.toFixed(1),
      x2: (x0 + lx * len).toFixed(1),
      y2: (y0 + ly * len).toFixed(1),
    }, group);
  };
  for (let i = 0; i < full; i += 1) {
    feather(6, dist);
    dist += 3;
  }
  if (half) feather(3.5, full || pennants ? dist : 3);
}

function drawArrow(parent, x, y, fromDeg, stroke) {
  if (!Number.isFinite(fromDeg)) return;
  const from = (fromDeg * Math.PI) / 180;
  const tx = -Math.sin(from);
  const ty = Math.cos(from);
  const len = 14;
  const tipX = x + tx * len * 0.5;
  const tipY = y + ty * len * 0.5;
  const tailX = x - tx * len * 0.5;
  const tailY = y - ty * len * 0.5;
  const px = -ty;
  const py = tx;
  const backX = tipX - tx * 5;
  const backY = tipY - ty * 5;
  const group = svgNode("g", {
    fill: "none",
    stroke,
    "stroke-width": 1.8,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }, parent);
  svgNode("line", {
    x1: tailX.toFixed(1),
    y1: tailY.toFixed(1),
    x2: tipX.toFixed(1),
    y2: tipY.toFixed(1),
  }, group);
  svgNode("polyline", {
    points: `${(backX + px * 4).toFixed(1)},${(backY + py * 4).toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)} ${(backX - px * 4).toFixed(1)},${(backY - py * 4).toFixed(1)}`,
  }, group);
}

function waveReadout() {
  if (!wavesInModel()) return "Waves  not in this model";
  const heightId = layerReady("wvdir") ? "wvdir" : "wvht";
  const height = pinBlendCell(heightId, heightId === "wvdir" ? "height" : "values");
  if (height === undefined) return "Waves  …";
  if (height === null) return "Waves  –";
  let text = `Waves  ${height.toFixed(1)} m`;
  if (heightId === "wvdir") {
    const flow = blendedVector("wvdir");
    const from = flow ? flowFrom(flow.u, flow.v) : null;
    if (from != null) text += `  ${Math.round(from)}° ${cardinal(from)}`;
  }
  if (layerReady("wvper")) {
    const period = pinBlendCell("wvper", "values");
    if (period === undefined) text += "  …";
    else if (typeof period === "number") text += `  ${Math.round(period)} s`;
  }
  return text;
}

function pinSeriesKey() {
  const windId = pinWindId();
  const under = extraUnderlay();
  const vertical = pinVerticalMode();
  const span = chartWindow();
  const version = pinData ? pinData.version : 0;
  return [modelId, windId, under?.id || "", vertical, pin.lng.toFixed(3), pin.lat.toFixed(3), span.start, span.end, version].join("|");
}

function renderMeteogram() {
  const span = chartWindow();
  const { start, end, hours } = span;
  const hourSet = new Set(hours);
  const keep = (points) => points.filter((point) => hourSet.has(point.hour));
  const wind = keep(windSamples(pinWindId()));
  const waveOn = wavesInModel();
  const waves = waveOn ? keep(waveSamples()) : null;
  const mode = pinVerticalMode();
  const vert = keep(verticalSamples(mode));
  const under = extraUnderlay();
  const extra = under ? keep(underSamples(under)) : null;
  const width = METEO_WIDTH;
  const x0 = 62;
  const x1 = width - (waveOn ? 52 : 18);
  const xOf = (hour) => x0 + ((hour - start) / ((end - start) || 1)) * (x1 - x0);
  const glyphs = glyphHours(hours, xOf, 16);
  const dayMarks = chartDayMarks(start, end);
  const majorAt = (hour) => dayMarks.some((mark) => Math.abs(mark - hour) < 0.5);
  const svg = svgNode("svg", { viewBox: `0 0 ${width} 20`, role: "img" });
  const plots = [];
  let y = 18;
  svgText(svg, x0, 16, "", {
    class: "pin-now-label",
    fill: INK.now,
    "font-family": CHART_MONO,
    "font-size": 15,
    "font-weight": 500,
    "pointer-events": "none",
  });

  const addLabel = (title, units) => {
    svgText(svg, x0, y + 14, title, {
      fill: INK.label,
      "font-family": CHART_SANS,
      "font-size": 14,
      "font-weight": 600,
      "letter-spacing": "0.08em",
    });
    let cursor = x1;
    for (let i = units.length - 1; i >= 0; i -= 1) {
      svgText(svg, cursor, y + 14, units[i].text, {
        fill: units[i].color,
        "text-anchor": "end",
        "font-family": CHART_MONO,
        "font-size": 14,
        "font-weight": 500,
      });
      cursor -= units[i].text.length * 9 + 16;
    }
    y += 22;
  };

  const openPlot = (scale, height) => {
    const top = y;
    const bottom = top + height;
    const yOf = (value) => {
      const spanHeight = scale.max - scale.min || 1;
      return bottom - 8 - ((value - scale.min) / spanHeight) * (height - 18);
    };
    for (const hour of hours) {
      const x = xOf(hour);
      const major = majorAt(hour);
      svgNode("line", {
        x1: x.toFixed(1),
        x2: x.toFixed(1),
        y1: top,
        y2: bottom,
        stroke: major ? INK.gridMajor : INK.gridMinor,
        "stroke-width": 1,
      }, svg);
    }
    for (const tick of axisTicks(scale.min, scale.max)) {
      const yy = yOf(tick);
      svgNode("line", {
        x1: x0,
        x2: x1,
        y1: yy.toFixed(1),
        y2: yy.toFixed(1),
        stroke: INK.grid,
        "stroke-width": 1,
      }, svg);
      svgText(svg, x0 - 8, yy, formatTick(tick), {
        fill: INK.tick,
        "text-anchor": "end",
        "dominant-baseline": "middle",
        "font-family": CHART_MONO,
        "font-size": 13,
      });
    }
    svgNode("line", {
      x1: x0,
      x2: x1,
      y1: bottom,
      y2: bottom,
      stroke: INK.axis,
      "stroke-width": 1.25,
    }, svg);
    plots.push([top, bottom]);
    y = bottom + 10;
    return { top, bottom, yOf };
  };

  const windScale = seriesExtent(wind.map((point) => point.value), true, 20);
  addLabel("WIND", [{ text: "kt", color: INK.wind }]);
  const barbY = y + 13;
  y += 28;
  for (const point of wind) {
    if (!glyphs.has(point.hour)) continue;
    const x = xOf(point.hour);
    if (point.value === undefined) drawWaits(svg, [point], xOf, barbY);
    else if (typeof point.value === "number") drawBarb(svg, x, barbY, point.from, point.value, pin.lat < 0);
  }
  const windPlot = openPlot(windScale, 90);
  drawWaits(svg, wind, xOf, (windPlot.top + windPlot.bottom) / 2);
  drawSeries(svg, wind, xOf, windPlot.yOf, INK.wind);

  y += 4;
  if (!waveOn) {
    svgText(svg, x0, y + 16, "Waves are not in this model.", {
      fill: INK.label,
      "font-family": CHART_SANS,
      "font-size": 16,
    });
    y += 32;
  } else {
    const heightPoints = waves.map((point) => ({ hour: point.hour, value: point.height }));
    const periodPoints = waves.map((point) => ({ hour: point.hour, value: point.period }));
    const heightScale = seriesExtent(heightPoints.map((point) => point.value), true, 2);
    const periodScale = seriesExtent(periodPoints.map((point) => point.value), true, 12);
    addLabel("WAVES", [
      { text: "m", color: INK.wave },
      { text: "s", color: INK.period },
    ]);
    const arrowY = y + 12;
    y += 26;
    for (const point of waves) {
      if (!glyphs.has(point.hour)) continue;
      const x = xOf(point.hour);
      if (point.height === undefined) drawWaits(svg, [{ hour: point.hour, value: undefined }], xOf, arrowY);
      else if (typeof point.height === "number" && point.from != null) drawArrow(svg, x, arrowY, point.from, INK.arrow);
    }
    const wavePlot = openPlot(heightScale, 90);
    const periodY = (value) => {
      const periodSpan = periodScale.max - periodScale.min || 1;
      return wavePlot.bottom - 8 - ((value - periodScale.min) / periodSpan) * (wavePlot.bottom - wavePlot.top - 18);
    };
    for (const tick of axisTicks(periodScale.min, periodScale.max)) {
      svgText(svg, x1 + 8, periodY(tick), formatTick(tick), {
        fill: INK.period,
        "dominant-baseline": "middle",
        "font-family": CHART_MONO,
        "font-size": 13,
      });
    }
    drawWaits(svg, heightPoints, xOf, (wavePlot.top + wavePlot.bottom) / 2);
    drawSeries(svg, heightPoints, xOf, wavePlot.yOf, INK.wave);
    drawSeries(svg, periodPoints, xOf, periodY, INK.period, "6 4");
  }

  const vertReady = vert.some((point) => typeof point.value === "number" || point.value === undefined);
  if (!vertReady) {
    svgText(svg, x0, y + 16, mode === "hgt" ? "Height is not in this model." : "Pressure is not in this model.", {
      fill: INK.label,
      "font-family": CHART_SANS,
      "font-size": 16,
    });
    y += 30;
  } else {
    const vertScale = mode === "hgt"
      ? seriesExtent(vert.map((point) => point.value), false, 40)
      : seriesExtent(vert.map((point) => point.value), false, 8);
    addLabel(mode === "hgt" ? "HEIGHT" : "PRESSURE", [{
      text: mode === "hgt" ? "m" : "hPa",
      color: INK.vert,
    }]);
    const vertPlot = openPlot(vertScale, 58);
    drawWaits(svg, vert, xOf, (vertPlot.top + vertPlot.bottom) / 2);
    drawSeries(svg, vert, xOf, vertPlot.yOf, INK.vert);
  }

  if (extra) {
    const face = LAYER_FACE[under.id] || [under.name, under.level];
    const scale = underExtent(under.id, extra.map((point) => point.value));
    addLabel(face[0].toUpperCase(), [{ text: DISPLAY_UNIT[under.id] || "", color: INK.extra }]);
    const extraPlot = openPlot(scale, 84);
    drawWaits(svg, extra, xOf, (extraPlot.top + extraPlot.bottom) / 2);
    drawSeries(svg, extra, xOf, extraPlot.yOf, INK.extra);
  }

  const axisY = plots.length ? plots[plots.length - 1][1] : y;
  for (const hour of hours) {
    const x = xOf(hour);
    const major = majorAt(hour);
    svgNode("line", {
      x1: x.toFixed(1),
      x2: x.toFixed(1),
      y1: axisY,
      y2: (axisY + (major ? 7 : 4)).toFixed(1),
      stroke: major ? INK.tickMajor : INK.tickMinor,
      "stroke-width": 1.25,
    }, svg);
  }
  y = axisY + 10;
  for (const hour of dayMarks) {
    svgText(svg, xOf(hour), y + 16, chartDayLabel(hour), {
      fill: INK.day,
      "text-anchor": "middle",
      "font-family": CHART_MONO,
      "font-size": 15,
      "font-weight": 500,
    });
  }
  y += 28;

  const markTop = plots.length ? plots[0][0] : 20;
  const markBot = plots.length ? plots[plots.length - 1][1] : y;
  svgNode("line", {
    class: "pin-now",
    y1: markTop,
    y2: markBot,
    stroke: INK.now,
    "stroke-width": 2.4,
    "pointer-events": "none",
  }, svg);
  svg.setAttribute("viewBox", `0 0 ${width} ${Math.ceil(y + 4)}`);

  const windSpan = rangeText(wind, "value", "kt", 0);
  let label = `Meteogram ${chartDayLabel(start)} to ${chartDayLabel(end)}, ${Math.round(end - start)} hours.`;
  label += windSpan ? ` Wind ${windSpan}.` : " Wind still loading.";
  if (!waveOn) label += " Waves are not in this model.";
  else {
    const waveSpan = rangeText(waves, "height", "m", 1);
    const periodSpan = rangeText(waves, "period", "s", 0);
    label += waveSpan ? ` Wave height ${waveSpan}.` : " Wave height still loading.";
    if (periodSpan) label += ` Period ${periodSpan}.`;
  }
  svg.setAttribute("aria-label", label);
  pinChart.dataset.start = String(start);
  pinChart.dataset.end = String(end);
  pinChart.dataset.x0 = String(x0);
  pinChart.dataset.x1 = String(x1);
  pinChart.replaceChildren(svg);
}

function placeTimeMark() {
  const mark = pinChart.querySelector(".pin-now");
  if (!mark) return;
  const start = Number(pinChart.dataset.start);
  const end = Number(pinChart.dataset.end);
  const x0 = Number(pinChart.dataset.x0);
  const x1 = Number(pinChart.dataset.x1);
  const span = end - start || 1;
  const hour = Math.min(end, Math.max(start, displayHour));
  const x = x0 + ((hour - start) / span) * (x1 - x0);
  mark.setAttribute("x1", x.toFixed(1));
  mark.setAttribute("x2", x.toFixed(1));
  const label = pinChart.querySelector(".pin-now-label");
  if (!label) return;
  const edge = 72;
  const anchor = x < x0 + edge ? "start" : x > x1 - edge ? "end" : "middle";
  label.setAttribute("x", x.toFixed(1));
  label.setAttribute("text-anchor", anchor);
  label.textContent = chartNowLabel(hour);
}

function paintMeteogram() {
  if (!pin) return;
  const key = pinSeriesKey();
  if (key !== pinChartKey) {
    pinChartKey = key;
    renderMeteogram();
  }
  placeTimeMark();
}

function resetPinLoads() {
  pinJob += 1;
  clearTimeout(pinTimer);
  pinTimer = 0;
  pinAbort?.abort();
  pinAbort = null;
  pinWanted = "";
}

function refreshPin() {
  if (!pin) return;
  const windId = pinWindId();
  const under = underlaySpec();
  const motion = motionSpec();
  const vertical = pinVerticalMode();
  pinPlace.textContent = placeText(pin.lng, pin.lat);
  pinFocus.textContent = under
    ? `${under.name} · ${under.level}`
    : `${motion?.name || "Wind"} · ${motion?.level || ""}`;
  const wind = blendedVector(windId);
  pinWind.textContent = wind === undefined ? "Wind  …" : wind ? `Wind  ${formatWind(wind.u, wind.v)}` : "Wind  –";
  pinWaves.textContent = waveReadout();
  pinWaves.classList.toggle("is-missing", !wavesInModel());
  const extra = extraUnderlay();
  if (extra) {
    pinUnder.hidden = false;
    pinUnder.textContent = `${extra.name}  ${scalarText(extra.id, pinBlendCell(extra.id, "values"))}`;
  } else {
    pinUnder.hidden = true;
    pinUnder.textContent = "";
  }
  if (vertical === "hgt") {
    const meters = pinBlendCell(motionId, "hgt");
    pinVert.textContent = meters === undefined ? "Height  …" : meters === null ? "Height  –" : `Height  ${Math.round(meters).toLocaleString("en-US")} m`;
  } else {
    const hpa = pinBlendCell("mslp", "values");
    pinVert.textContent = hpa === undefined ? "Pressure  …" : hpa === null ? "Pressure  –" : `Pressure  ${hpa.toFixed(0)} hPa`;
  }
  paintMeteogram();
  placePin();
}

function placePin() {
  if (!pin) return;
  const point = map.project([pin.lng, pin.lat]);
  const canvas = map.getCanvas();
  const back = map.unproject([point.x, point.y]);
  const off = point.x < -48 || point.y < -48 || point.x > canvas.clientWidth + 48 || point.y > canvas.clientHeight + 48;
  const hidden = off || (layer.globeness > 0.2 && (lonGap(back.lng, pin.lng) > 15 || Math.abs(back.lat - pin.lat) > 15));
  pinMarker?.getElement()?.classList.toggle("is-occluded", hidden);
  // On phones the card is a sheet fixed to a screen edge by CSS: it stays up while
  // the map moves underneath, and there is nothing to position.
  if (sheetQuery.matches) {
    pinCard.classList.remove("is-occluded");
    pinCard.style.left = "";
    pinCard.style.top = "";
    return;
  }
  pinCard.classList.toggle("is-occluded", hidden);
  // Desktop: a floating card, placed in the map's own coordinates (the map fills the
  // stage above the time bar, so the bar never overlaps it).
  const stage = canvas.getBoundingClientRect();
  const rel = (element) => {
    const rect = element?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { left: rect.left - stage.left, right: rect.right - stage.left, top: rect.top - stage.top, bottom: rect.bottom - stage.top };
  };
  const margin = 8;
  const width = pinCard.offsetWidth || 680;
  const height = pinCard.offsetHeight || 560;
  const topLimit = (rel(document.querySelector(".top .brand"))?.bottom ?? 40) + margin;
  const legend = rel(legendEl);
  const panel = document.querySelector("#layer-panel");
  const menu = panel && !panel.hidden ? rel(panel) : null;
  let left = stage.width - margin - width;
  if (legend) {
    const leftOfLegend = legend.left - 12 - width;
    if (leftOfLegend >= margin) left = leftOfLegend;
  }
  let top = topLimit;
  const overlaps = (rect, l, t) => rect
    && l < rect.right + 8 && l + width > rect.left - 8
    && t < rect.bottom + 8 && t + height > rect.top - 8;
  if (overlaps(menu, left, top)) {
    const rightOf = menu.right + 12;
    if (rightOf + width <= stage.width - margin) left = Math.max(left, rightOf);
  }
  left = Math.min(Math.max(margin, stage.width - width - margin), Math.max(margin, left));
  if (top + height > stage.height - margin) top = Math.max(margin, stage.height - height - margin);
  pinCard.style.left = `${Math.round(left)}px`;
  pinCard.style.top = `${Math.round(top)}px`;
}

// A sheet covers part of the map. If the new pin would sit under it, nudge the map
// so the point stays visible above (or beside) the sheet.
function revealPin() {
  if (!pin || !sheetQuery.matches) return;
  const canvas = map.getCanvas();
  const stage = canvas.getBoundingClientRect();
  const point = map.project([pin.lng, pin.lat]);
  // the sheet grows as the chart loads, so reserve the most room CSS lets it take
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const pad = 36;
  let dx = 0;
  let dy = 0;
  if (portrait) {
    const limit = stage.height * 0.44 - pad;
    if (point.y > limit) dy = point.y - limit;
  } else {
    const limit = stage.width - Math.min(stage.width * 0.46, 440) - pad;
    if (point.x > limit) dx = point.x - limit;
  }
  if (dx || dy) map.panBy([dx, dy], { duration: 150 });
}

function pinDistance(point) {
  if (!pin) return Infinity;
  const projected = map.project([pin.lng, pin.lat]);
  return Math.hypot(projected.x - point.x, projected.y - point.y);
}

function pinAt(lng, lat) {
  pin = { lng, lat };
  pinChartKey = "";
  pinData = null;
  if (!pinMarker) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "pin-dot";
    dot.setAttribute("aria-label", "Remove pin");
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearPin();
    });
    pinMarker = new maplibregl.Marker({ element: dot, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
  } else {
    pinMarker.setLngLat([lng, lat]);
  }
  pinCard.hidden = false;
  ensurePinHours();
  refreshPin();
  revealPin();
}

function clearPin() {
  pin = null;
  pinChartKey = "";
  pinData = null;
  resetPinLoads();
  pinChart.replaceChildren();
  pinCard.hidden = true;
  pinMarker?.remove();
  pinMarker = null;
  paintStatus();
}

function pinLayerIds() {
  const ids = [pinWindId()];
  if (pinVerticalMode() === "hgt") ids.push(motionId);
  else ids.push("mslp");
  if (wavesInModel()) {
    ids.push(layerReady("wvdir") ? "wvdir" : "wvht");
    if (layerReady("wvper")) ids.push("wvper");
  }
  const under = extraUnderlay();
  if (under) ids.push(under.id);
  return [...new Set(ids.filter((id) => layerReady(id)))];
}

function pinLocation() {
  return `${modelId}|${modelMeta()?.cycle || ""}|${pin.lng.toFixed(5)}|${pin.lat.toFixed(5)}`;
}

function mergePin(body) {
  const layers = pinData.layers;
  const before = pinData.signature;
  for (const [id, series] of Object.entries(body.series || {})) {
    const hours = series.hours || [];
    const { hours: _hours, ...cols } = series;
    layers[id] = {
      hours,
      index: new Map(hours.map((hour, at) => [hour, at])),
      cols,
      pending: new Set(body.pending?.[id] || []),
    };
    pinData.missing.delete(id);
  }
  for (const id of body.missing || []) pinData.missing.add(id);
  pinData.signature = JSON.stringify([body.series ? Object.keys(body.series) : [], body.pending, body.missing]);
  if (pinData.signature !== before) pinData.version += 1;
}

async function loadPin(token, ids) {
  const loc = pinData.loc;
  const url = `/api/point?model=${encodeURIComponent(modelId)}&lat=${pin.lat.toFixed(5)}&lon=${pin.lng.toFixed(5)}&layers=${ids.map(encodeURIComponent).join(",")}`;
  const live = () => pin && token === pinJob && pinData?.loc === loc;
  let delay = PIN_POLL_MS;
  try {
    pinAbort = new AbortController();
    const response = await fetch(url, { signal: pinAbort.signal });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(failure.error || "point series failed");
    }
    const body = await response.json();
    if (!live()) return;
    mergePin(body);
    refreshPin();
    const waiting = Object.keys(body.pending || {});
    if (!waiting.length) {
      pinWanted = "";
      return;
    }
    ids = waiting;
  } catch (error) {
    if (!live() || error?.name === "AbortError") return;
    onLoadError(error);
    delay = PIN_RETRY_MS;
  }
  pinTimer = setTimeout(() => {
    if (live()) loadPin(token, ids);
  }, delay);
}

function ensurePinHours() {
  if (!pin) return;
  const meta = modelMeta();
  if (!meta?.available) return;
  const loc = pinLocation();
  if (!pinData || pinData.loc !== loc) {
    resetPinLoads();
    pinData = { loc, layers: {}, missing: new Set(), signature: "", version: 0 };
    pinChartKey = "";
  }
  const need = pinLayerIds().filter((id) => {
    const layer = pinData.layers[id];
    return !pinData.missing.has(id) && !(layer && layer.pending.size === 0);
  });
  const wanted = need.join(",");
  if (wanted === pinWanted) return;
  resetPinLoads();
  if (!need.length) {
    paintMeteogram();
    return;
  }
  pinWanted = wanted;
  loadPin(pinJob, need);
}

function formatCoord(lng, lat) {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  const clamped = Math.max(-90, Math.min(90, lat));
  return `${Math.abs(clamped).toFixed(2)}°${clamped < 0 ? "S" : "N"} ${Math.abs(wrapped).toFixed(2)}°${wrapped < 0 ? "W" : "E"}`;
}

function showHover(lng, lat) {
  setText(readoutCoord, formatCoord(lng, lat));
  const under = underlaySpec();
  const motion = motionSpec();
  if (!motion) {
    hideReadout();
    return;
  }
  if (!under) {
    showSample(motion, sampleField(motion, lng, lat));
    return;
  }
  const sample = sampleField(under, lng, lat);
  const windSpec = motion.kind === "wind" ? motion : specById("wind10");
  const wind = windSpec && layerReady(windSpec.id) ? sampleField(windSpec, lng, lat) : null;
  const empty = under.id === "apcp" && Math.round(displayHour) === 0 && fieldBucket(modelId, "apcp").get(0)?.emptyAccum;
  if ((!sample || !Number.isFinite(sample.value)) && !(wind && Number.isFinite(wind.u)) && !empty) {
    hideReadout();
    return;
  }
  let speed = "–";
  if (empty && (!sample || !Number.isFinite(sample.value) || sample.value <= 0.05)) speed = "not started";
  else if (sample && Number.isFinite(sample.value)) speed = formatValue(presentFor(under).hover, sample.value);
  showReadout(speed, wind && Number.isFinite(wind.u) ? formatWind(wind.u, wind.v) : under.level);
}

const failedAt = new Map();

// Keep the frames around `hour` coming. Frames within 12 forecast hours are requested at
// normal priority. While playing, the way ahead (36 forecast hours, wrapping to the
// start) is requested too, at background priority. The window never holds more frames
// than the memory budget has room for, otherwise they would evict each other and be
// fetched again and again.
function ensureAround(hour) {
  const meta = modelMeta();
  const motion = motionSpec();
  if (!meta?.available || !motion) return;
  const ids = [motion.id];
  if (underlayId && underlayId !== motion.id) ids.push(underlayId);
  const pressure = needsPressure();
  let perHour = pressure ? frameBytesByLayer.get("pressure") || 9 * MB : 0;
  for (const id of ids) perHour += frameBytesByLayer.get(id) || 21 * MB;
  const fit = Math.max(3, Math.floor((FRAME_BUDGET * 0.7) / perHour));
  const reach = forecastPlaying ? 36 : 12;
  const wanted = meta.hours
    .map((value) => ({ value, far: neededIn(modelId, value) }))
    .filter((item) => item.far <= reach)
    .sort((a, b) => a.far - b.far)
    .slice(0, fit);
  prefetchStamp += 1;
  for (const { value, far } of wanted) {
    const priority = far <= 12 ? 1 : -1;
    for (const id of ids) prefetch(`${modelId}:${id}:${value}`, () => loadField(modelId, id, value, priority, true));
    if (pressure) prefetch(`mslp:${modelId}:${value}`, () => loadPressure(modelId, value, priority, true));
  }
  dropStaleRequests();
}

// A request that failed is not retried for a few seconds, so a missing hour does not
// turn into a request on every animation frame.
function prefetch(key, request) {
  const failed = failedAt.get(key);
  if (failed && performance.now() - failed < 8000) return;
  request().catch((error) => {
    failedAt.set(key, performance.now());
    onLoadError(error);
  });
}

let ensuredHour = null;
let ensuredAt = 0;

function tick(now) {
  const dt = Math.min(0.05, (now - lastUi) / 1000);
  lastUi = now;
  if (forecastPlaying) {
    displayHour += dt * playSpeed;
    if (displayHour > forecastEnd()) displayHour = 0;
    updateClock();
    stepField(now);
    // The hours worth loading only change when the hour crosses a whole number;
    // the timer re-requests frames that were evicted in the meantime.
    const whole = Math.floor(displayHour);
    if (whole !== ensuredHour || now - ensuredAt > 1000) {
      ensuredHour = whole;
      ensuredAt = now;
      ensureAround(displayHour);
    }
  }
  requestAnimationFrame(tick);
}

async function boot() {
  try {
    const response = await fetch(catalogUrl());
    if (!response.ok) throw new Error(`catalog ${response.status}`);
    catalog = await response.json();
  } catch (error) {
    statusEl.textContent = "The forecast catalog is unavailable.";
    setText(initEl, error.message);
    return;
  }
  if (!catalog.layers) catalog.layers = [];
  for (const model of catalog.models) {
    const button = document.querySelector(`#model-${model.id}`);
    button.disabled = !model.available;
    if (!model.available) button.title = "No recent cycle was published";
  }
  if (!modelMeta()?.available) {
    const fallback = catalog.models.find((model) => model.available);
    if (!fallback) {
      statusEl.textContent = "Neither GFS nor AIGFS has a published cycle.";
      return;
    }
    modelId = fallback.id;
  }
  if (!layerReady(motionId)) {
    motionId = catalog.layers.find((item) => item.models.includes(modelId))?.id || "wind10";
  }
  selectModel(modelId);
  startClockTimers();
  requestAnimationFrame(tick);
}

boot();
