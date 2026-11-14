// Single source of truth for every color scale.
//
// wind.js turns these definitions into one RGBA8 lookup texture (one row per
// scale) that all the shaders sample, and app.js paints the legend from the
// same definitions through colorAt(), so the map and the legend cannot drift.
//
// Everything in here is plain data and math. It must not touch the DOM, because
// wind.js is also imported by the frame worker.
//
// Units. Stops, domains and band edges are in DATA units, the units the
// textures hold: wind m/s, temperature degC, precipitation mm per 6 h, CAPE
// J/kg, relative humidity %, visibility km, MSLP hPa, wave height m, wave
// period s. Each scale also carries toDisplay/fromDisplay for the units people
// read (kt, degF, in, mi, ...). Tick positions are authored in display units.
//
// Stops are sRGB hex. Between stops colors are interpolated in OKLab, which
// keeps ramps perceptually smooth. Two stops at the same value make a hard
// step (the lower stop's color is used below the value, the upper one at and
// above it); `steps` scales are the same thing written as bands.

export const LUT_WIDTH = 2048;

export const KT_PER_MS = 1.943844;
export const MM_PER_IN = 25.4;
export const KM_PER_MI = 1.609344;

const kt = (value) => value / KT_PER_MS;
const inch = (value) => value * MM_PER_IN;
const mi = (value) => value * KM_PER_MI;
const degF = (value) => ((value - 32) * 5) / 9;

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

function parseHex(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb) {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

const toLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function mixHex(a, b, t) {
  const x = rgbToOklab(parseHex(a));
  const y = rgbToOklab(parseHex(b));
  return toHex(oklabToRgb([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]));
}

// Viridis, sampled at 0, .1 ... 1 (matplotlib). Perceptually uniform and safe
// for all common color vision deficiencies.
const VIRIDIS = [
  "#440154", "#482475", "#414487", "#355f8d", "#2a788e", "#21918c",
  "#22a884", "#44bf70", "#7ad151", "#bddf26", "#fde725",
];

// Pick colors off a named ramp at fractions t in [0, 1].
function along(ramp, fractions) {
  return fractions.map((t) => {
    const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
    const i = Math.min(ramp.length - 2, Math.floor(x));
    return mixHex(ramp[i], ramp[i + 1], x - i);
  });
}

// ---------------------------------------------------------------------------
// Scales. `row` is the line in the lookup texture. `alpha` is the opacity of
// the map fill; legends show the color without it.
// ---------------------------------------------------------------------------

const WAVE_M = [0, 1, 2, 3, 4, 6, 8, 10, 12, 14];

export const SCALES = {
  // Wind speed. Used for particle color and the strong-wind veil.
  //
  // Convention (marine warning categories, as forecasters asked): green up to
  // about 20 kt, then hard steps at the warning thresholds the legend marks:
  // yellow for gale (34 kt), orange for storm force (48 kt), red for hurricane
  // force (64 kt), deepening red through major (96 kt), then magenta and on to
  // white at 150 kt. Each band ramps gently inside so speed still reads within
  // a category; the steps make the category boundaries exact.
  wind: {
    row: 0,
    title: "Wind speed",
    unit: "kt",
    kind: "ramp",
    domain: [0, kt(150)],
    toDisplay: (ms) => ms * KT_PER_MS,
    fromDisplay: kt,
    alpha: 1,
    height: 288,
    stops: [
      [kt(0), "#2e7d32"],
      [kt(10), "#43a047"],
      [kt(20), "#76c043"],
      [kt(34), "#c3df4c"],
      [kt(34), "#ffe600"],
      [kt(48), "#ffc400"],
      [kt(48), "#ff9100"],
      [kt(64), "#ff6a00"],
      [kt(64), "#e53935"],
      [kt(96), "#b71c1c"],
      [kt(113), "#c2188f"],
      [kt(137), "#e86fdc"],
      [kt(150), "#ffffff"],
    ],
    ticks: [
      { at: 150, label: "150" },
      { at: 137, label: "137 cat 5" },
      { at: 113, label: "113 cat 4" },
      { at: 96, label: "96 major" },
      { at: 64, label: "64 hurricane" },
      { at: 48, label: "48 storm" },
      { at: 34, label: "34 gale" },
      { at: 20, label: "20" },
      { at: 0, label: "0" },
    ],
  },

  // 2 m / upper-air temperature. Diverging about freezing.
  //
  // Convention: cold is blue and warm is yellow through red (the usual
  // meteorological temperature map), centered on 0 degC = 32 degF. The ramp
  // steps from pale blue to pale yellow-green right at freezing so the break is
  // unmistakable, and the map keeps its bright 32 degF contour. Lightness
  // peaks at the break and falls toward both extremes, so only the blue-versus-
  // yellow axis carries the sign, which every color vision type keeps.
  temp: {
    row: 1,
    title: "Temperature",
    unit: "°F",
    kind: "ramp",
    domain: [-60, 46],
    toDisplay: (c) => (c * 9) / 5 + 32,
    fromDisplay: degF,
    alpha: 0.8,
    height: 240,
    stops: [
      [-60, "#26124f"],
      [-44, "#313695"],
      [-30, "#3f6bb4"],
      [-18, "#5a98cf"],
      [-8, "#8fc5e4"],
      [0, "#bfe3f2"],
      [0, "#dcefa3"],
      [10, "#ecd065"],
      [20, "#f59e3b"],
      [30, "#e86518"],
      [37, "#c52d1f"],
      [46, "#7c111d"],
    ],
    ticks: [
      { at: 110, label: "110" },
      { at: 90, label: "90" },
      { at: 70, label: "70" },
      { at: 50, label: "50" },
      { at: 32, label: "32", key: true },
      { at: 10, label: "10" },
      { at: -10, label: "−10" },
      { at: -30, label: "−30" },
      { at: -50, label: "−50" },
      { at: -70, label: "−70" },
    ],
  },

  // 6 h precipitation. Banded like the NWS / WPC QPF charts.
  //
  // Convention: accumulation in inches, light green for a trace to green, then
  // blue, purple and magenta for the heaviest totals. Bands follow the usual
  // QPF breaks (0.01, 0.10, 0.25, 0.50, 0.75, 1.00 in and up). Below 0.01 in
  // nothing is drawn, so dry areas show the basemap. Lightness falls steadily
  // from the pale greens to indigo at 1 in, then climbs again through violet,
  // magenta and pink, so the heaviest totals stand out on dark and light
  // basemaps alike and every neighbouring pair differs in lightness.
  precip: {
    row: 2,
    title: "Precipitation",
    unit: "in",
    kind: "bands",
    domain: [0, inch(8)],
    toDisplay: (mm) => mm / MM_PER_IN,
    fromDisplay: inch,
    alpha: 0.82,
    height: 264,
    steps: [
      [0, null],
      [inch(0.01), "#c2f6b6"],
      [inch(0.05), "#87dc8a"],
      [inch(0.1), "#4cc466"],
      [inch(0.25), "#14a388"],
      [inch(0.5), "#1082ab"],
      [inch(0.75), "#1d60bc"],
      [inch(1), "#2b31ab"],
      [inch(1.5), "#834cd4"],
      [inch(2), "#d452c7"],
      [inch(3), "#f971b3"],
      [inch(4), "#fc9cbd"],
      [inch(6), "#fecee4"],
    ],
    ticks: [
      { at: 6, label: "6" },
      { at: 4, label: "4" },
      { at: 3, label: "3" },
      { at: 2, label: "2" },
      { at: 1.5, label: "1.5" },
      { at: 1, label: "1" },
      { at: 0.75, label: "0.75" },
      { at: 0.5, label: "0.50" },
      { at: 0.25, label: "0.25" },
      { at: 0.1, label: "0.10" },
      { at: 0.05, label: "0.05" },
      { at: 0.01, label: "0.01" },
    ],
  },

  // Surface-based CAPE. Banded like the SPC mesoanalysis instability charts.
  //
  // Convention: cool blue and teal for marginal instability, green then yellow
  // through 1000-2000 J/kg, orange and red at 2500-4000, magenta and purple for
  // extreme instability, with the SPC break points (100, 250, 500, 1000, 1500,
  // 2000, 2500, 3000, 4000, 5000 J/kg). Below 100 J/kg nothing is drawn.
  cape: {
    row: 3,
    title: "CAPE",
    unit: "J/kg",
    kind: "bands",
    domain: [0, 6000],
    toDisplay: (j) => j,
    fromDisplay: (j) => j,
    alpha: 0.82,
    height: 240,
    steps: [
      [0, null],
      [100, "#b5daf1"],
      [250, "#6bbaf0"],
      [500, "#19a195"],
      [1000, "#99d352"],
      [1500, "#f9ed52"],
      [2000, "#f9ad26"],
      [2500, "#ef7926"],
      [3000, "#d7352d"],
      [4000, "#a4126c"],
      [5000, "#581a88"],
    ],
    ticks: [
      { at: 5000, label: "5000" },
      { at: 4000, label: "4000" },
      { at: 3000, label: "3000" },
      { at: 2500, label: "2500" },
      { at: 2000, label: "2000" },
      { at: 1500, label: "1500" },
      { at: 1000, label: "1000" },
      { at: 500, label: "500" },
      { at: 250, label: "250" },
      { at: 100, label: "100" },
    ],
  },

  // 2 m relative humidity.
  //
  // Convention: dry is brown, moist is green and then blue (the common
  // brown-to-green-to-blue moisture ramp). Lightness peaks near 45 % and falls
  // toward both ends, so brown versus green/blue is the only axis, which
  // red-green deficiencies keep as a brown-versus-blue difference.
  rh: {
    row: 4,
    title: "Relative humidity",
    unit: "%",
    kind: "ramp",
    domain: [0, 100],
    toDisplay: (p) => p,
    fromDisplay: (p) => p,
    alpha: 0.75,
    height: 200,
    stops: [
      [0, "#7a470b"],
      [20, "#b3782a"],
      [35, "#dcc079"],
      [50, "#d5dfa6"],
      [65, "#86cbb0"],
      [82, "#3b9fc0"],
      [100, "#1a579f"],
    ],
    ticks: [
      { at: 100, label: "100" },
      { at: 80, label: "80" },
      { at: 60, label: "60" },
      { at: 40, label: "40" },
      { at: 20, label: "20" },
      { at: 0, label: "0" },
    ],
  },

  // Visibility. Aviation flight categories as discrete bands.
  //
  // Convention: LIFR below 1 mi (magenta), IFR 1 to under 3 mi (red), MVFR 3 to
  // 5 mi (blue), VFR above 5 mi (not drawn, so clear air stays clear). These are
  // the standard METAR flight category colors, adjusted in lightness so the
  // three drawn classes differ in lightness as well as hue: the light magenta
  // and the dark red stay apart under protan and deutan vision, where red and
  // magenta lose their red component.
  vis: {
    row: 5,
    title: "Visibility",
    unit: "mi",
    kind: "bands",
    domain: [0, 24],
    toDisplay: (km) => km / KM_PER_MI,
    fromDisplay: mi,
    alpha: 0.85,
    height: 200,
    steps: [
      [0, "#f27cf0"],
      [mi(1), "#d4141f"],
      [mi(3), "#3b78f4"],
      [mi(5), null],
    ],
    ticks: [
      { band: 3.5, label: "VFR >5" },
      { at: 5, label: "5" },
      { band: 2.5, label: "MVFR" },
      { at: 3, label: "3" },
      { band: 1.5, label: "IFR" },
      { at: 1, label: "1" },
      { band: 0.5, label: "LIFR <1" },
    ],
  },

  // Mean sea-level pressure. Diverging about 1013 hPa.
  //
  // Convention: purple for low, orange-brown for high, with a neutral warm gray
  // at standard pressure. The orange-purple pairing is a ColorBrewer
  // colorblind-safe diverging scheme, and it deliberately does not reuse the
  // temperature blues and reds, so a pressure map is never misread as a
  // temperature map.
  mslp: {
    row: 6,
    title: "Pressure",
    unit: "hPa",
    kind: "ramp",
    domain: [940, 1060],
    toDisplay: (h) => h,
    fromDisplay: (h) => h,
    alpha: 0.62,
    height: 220,
    stops: [
      [940, "#2d004b"],
      [960, "#542788"],
      [982, "#8073ac"],
      [998, "#a9a1cb"],
      [1013, "#d6cfc2"],
      [1028, "#f6ad5c"],
      [1044, "#e08214"],
      [1060, "#a24d07"],
    ],
    ticks: [
      { at: 1060, label: "1060" },
      { at: 1040, label: "1040" },
      { at: 1020, label: "1020" },
      { at: 1013, label: "1013", key: true },
      { at: 1000, label: "1000" },
      { at: 980, label: "980" },
      { at: 960, label: "960" },
      { at: 940, label: "940" },
    ],
  },

  // Significant wave height. No convention exists, so a perceptually uniform,
  // colorblind-safe sequential ramp: viridis, trimmed at the dark end so calm
  // seas stay visible on a dark basemap. Stops are spaced by the square root of
  // height, which gives the common 0 to 4 m range most of the colors.
  waves: {
    row: 7,
    title: "Wave height",
    level: "significant",
    unit: "m",
    kind: "ramp",
    domain: [0, 14],
    toDisplay: (m) => m,
    fromDisplay: (m) => m,
    alpha: 0.72,
    height: 220,
    stops: WAVE_M.map((m, i) => [m, along(VIRIDIS, [0.04 + 0.96 * Math.sqrt(m / 14)])[0]]),
    ticks: [
      { at: 14, label: "14" },
      { at: 10, label: "10" },
      { at: 8, label: "8" },
      { at: 6, label: "6" },
      { at: 4, label: "4" },
      { at: 3, label: "3" },
      { at: 2, label: "2" },
      { at: 1, label: "1" },
      { at: 0, label: "0" },
    ],
  },

  // Primary wave period. A second sequential ramp, violet-blue through teal to
  // pale mint (mako-like: lightness rises evenly from 42 to 94 in OKLab, hue
  // moves along the blue-green axis), so a period map is never mistaken for a
  // height map and still reads on a mid-gray land color, where cividis's gray
  // middle does not. Lightness carries the order, so it is safe for all common
  // color vision deficiencies.
  period: {
    row: 8,
    title: "Wave period",
    unit: "s",
    kind: "ramp",
    domain: [0, 20],
    toDisplay: (s) => s,
    fromDisplay: (s) => s,
    alpha: 0.72,
    height: 200,
    stops: [
      [0, "#4d427f"],
      [2.5, "#4458a1"],
      [5, "#2672b7"],
      [7.5, "#168bba"],
      [10, "#1ca3bd"],
      [12.5, "#20bbbf"],
      [15, "#47d0bd"],
      [17.5, "#8ce6c4"],
      [20, "#c5fada"],
    ],
    ticks: [
      { at: 20, label: "20" },
      { at: 16, label: "16" },
      { at: 12, label: "12" },
      { at: 8, label: "8" },
      { at: 4, label: "4" },
      { at: 0, label: "0" },
    ],
  },
};

export const SCALE_IDS = Object.keys(SCALES).sort((a, b) => SCALES[a].row - SCALES[b].row);

// Bands scales are stored as `steps`; expose the equivalent stop list too, so
// every scale has `stops` (value, color) in data units.
for (const scale of Object.values(SCALES)) {
  if (scale.steps) {
    scale.edges = scale.steps.map(([from]) => from);
    scale.stops = [];
    scale.steps.forEach(([from, color], i) => {
      const to = i + 1 < scale.steps.length ? scale.steps[i + 1][0] : scale.domain[1];
      scale.stops.push([from, color], [to, color]);
    });
  }
}

// Stops with their colors parsed to OKLab once. A null color is transparent;
// it takes the color of its nearest drawn neighbor so that filtering across a
// band edge never darkens or tints the edge.
const prepared = new WeakMap();

function prepare(scale) {
  let list = prepared.get(scale);
  if (list) return list;
  const raw = scale.stops;
  const firstDrawn = raw.find(([, color]) => color);
  let last = firstDrawn ? firstDrawn[1] : "#000000";
  const filled = raw.map(([value, color]) => {
    if (color) last = color;
    return { value, lab: rgbToOklab(parseHex(color || last)), clear: !color };
  });
  // Fill leading transparent stops from the first drawn color.
  for (let i = filled.length - 1, next = null; i >= 0; i--) {
    if (!filled[i].clear) next = filled[i].lab;
    else if (next) filled[i].lab = next;
  }
  list = filled;
  prepared.set(scale, list);
  return list;
}

// Color of a scale at a data value: [r, g, b, a] with r, g, b in 0..255 and a
// in 0..1 (the fill opacity, 0 where the scale draws nothing).
export function colorAt(scale, value) {
  const stops = prepare(scale);
  let j = -1;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].value <= value) j = i;
    else break;
  }
  let lab;
  let clear;
  if (j < 0) {
    lab = stops[0].lab;
    clear = stops[0].clear;
  } else if (j === stops.length - 1) {
    lab = stops[j].lab;
    clear = stops[j].clear;
  } else {
    const a = stops[j];
    const b = stops[j + 1];
    const t = (value - a.value) / (b.value - a.value);
    lab = [a.lab[0] + (b.lab[0] - a.lab[0]) * t, a.lab[1] + (b.lab[1] - a.lab[1]) * t, a.lab[2] + (b.lab[2] - a.lab[2]) * t];
    clear = t < 0.5 ? a.clear : b.clear;
  }
  const rgb = oklabToRgb(lab);
  return [rgb[0], rgb[1], rgb[2], clear ? 0 : scale.alpha];
}

// Lookup texture contents: LUT_WIDTH texels per scale, one scale per row,
// linear in data value over the scale's domain. Texel i holds the value
// lo + i / (LUT_WIDTH - 1) * (hi - lo).
export function buildLut() {
  const rows = SCALE_IDS.length;
  const data = new Uint8Array(LUT_WIDTH * rows * 4);
  for (const id of SCALE_IDS) {
    const scale = SCALES[id];
    const [lo, hi] = scale.domain;
    let o = scale.row * LUT_WIDTH * 4;
    for (let i = 0; i < LUT_WIDTH; i++, o += 4) {
      const [r, g, b, a] = colorAt(scale, lo + (i / (LUT_WIDTH - 1)) * (hi - lo));
      data[o] = Math.round(Math.min(255, Math.max(0, r)));
      data[o + 1] = Math.round(Math.min(255, Math.max(0, g)));
      data[o + 2] = Math.round(Math.min(255, Math.max(0, b)));
      data[o + 3] = Math.round(a * 255);
    }
  }
  return { data, width: LUT_WIDTH, height: rows };
}

// ---------------------------------------------------------------------------
// Legend geometry (shared by the bar painter and the tick placer)
// ---------------------------------------------------------------------------

// Position of a legend tick along the bar, 0 at the low end to 1 at the high
// end. Ramp scales are proportional in data value. Banded scales draw equal
// height bands, so a tick at a band edge sits at index / count.
export function tickPosition(scale, tick) {
  if (tick.band !== undefined) return tick.band / scale.steps.length;
  const value = scale.fromDisplay(tick.at);
  if (scale.steps) {
    const index = scale.edges.findIndex((edge) => Math.abs(edge - value) < 1e-6 * Math.max(1, Math.abs(value)));
    return index < 0 ? 0 : index / scale.steps.length;
  }
  const [lo, hi] = scale.domain;
  return (value - lo) / (hi - lo);
}

// Legend color at position p (0..1) along the bar, as [r, g, b, a].
export function legendColor(scale, p) {
  if (scale.steps) {
    const index = Math.min(scale.steps.length - 1, Math.max(0, Math.floor(p * scale.steps.length)));
    const color = scale.steps[index][1];
    return color ? [...parseHex(color), 1] : [0, 0, 0, 0];
  }
  const [lo, hi] = scale.domain;
  const [r, g, b] = colorAt(scale, lo + p * (hi - lo));
  return [r, g, b, 1];
}

// Paint the bar into a 2D context of size w x h (device pixels). The low end
// is at the bottom of a vertical bar and at the left of a horizontal one.
// Transparent bands are drawn as an empty box outlined in `outline`.
export function paintBar(ctx, scale, w, h, vertical, outline) {
  ctx.clearRect(0, 0, w, h);
  const length = vertical ? h : w;
  const image = ctx.createImageData(w, h);
  for (let k = 0; k < length; k++) {
    const p = (k + 0.5) / length;
    const [r, g, b, a] = legendColor(scale, vertical ? 1 - p : p);
    const across = vertical ? w : h;
    for (let c = 0; c < across; c++) {
      const x = vertical ? c : k;
      const y = vertical ? k : c;
      const o = (y * w + x) * 4;
      image.data[o] = r;
      image.data[o + 1] = g;
      image.data[o + 2] = b;
      image.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  if (scale.steps) {
    // Hairline separators between bands, and an outline on empty bands.
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    const count = scale.steps.length;
    scale.steps.forEach(([, color], i) => {
      if (color) return;
      const a0 = (i / count) * length;
      const a1 = ((i + 1) / count) * length;
      const lo = vertical ? h - a1 : a0;
      const span = a1 - a0;
      if (vertical) ctx.strokeRect(0.5, lo + 0.5, w - 1, span - 1);
      else ctx.strokeRect(lo + 0.5, 0.5, span - 1, h - 1);
    });
  }
}
