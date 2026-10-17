import { LUT_WIDTH, SCALES, SCALE_IDS, buildLut } from "./palettes.js?v=40";

const COLS = 360;
const ROWS = 200;
const COUNT = COLS * ROWS;
const TRAIL = 40;
// Longest particle life in update steps. Each particle gets its own lifetime
// between 55% and 100% of this, so deaths and respawns spread out over time
// instead of the whole field fading in and out together.
const MAX_AGE = 140;
const LIFESPAN_GLSL = `
float lifeSpan(ivec2 ij) {
  vec3 p3 = fract(vec3(vec2(ij).xyx) * 0.1031 + 0.37);
  p3 += dot(p3, p3.yzx + 33.33);
  return ${MAX_AGE}.0 * (0.55 + 0.45 * fract((p3.x + p3.y) * p3.z));
}`;
// Particle state is COLS x rows x TRAIL RGBA32F texels (16 bytes each): 46 MB at
// the base ROWS. Rows grow on demand when density asks for more particles than
// are allocated, up to a device ceiling (see capacityCeiling).
const ROW_STEP = 50;
const STATE_BYTES_PER_ROW = COLS * TRAIL * 16;
// One update pass moves a particle at most this many hours; flow above the old
// slider range (1.8) is delivered as several passes in a frame instead.
const MAX_STEP_HOURS = 0.22;
const BASE_FLOW_RANGE = 1.8;
const MAX_SUBSTEPS = 6;
const RANGE = 80;

// Every color scale is one row of a single RGBA8 lookup texture (palettes.js),
// linear in data value over the scale's domain. u_lutRow is the row's center
// and u_domain the data range it spans, both set per draw from the active scale.
const LUT_GLSL = `
uniform sampler2D u_lut;
uniform float u_lutRow;
uniform vec2 u_domain;
vec4 lutColor(float value) {
  float x = clamp((value - u_domain.x) / (u_domain.y - u_domain.x), 0.0, 1.0);
  return texture(u_lut, vec2((x * ${LUT_WIDTH - 1}.0 + 0.5) / ${LUT_WIDTH}.0, u_lutRow));
}`;
// Lightness of a color (Rec. 709 weights on the encoded values). Contour lines
// and wave marks use it to choose light or dark ink against what is under them.
const LUMA_GLSL = `
float lumaOf(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}`;

const UPDATE_VS = `#version 300 es
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const UPDATE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform sampler2DArray u_states;
uniform vec2 u_texSize;
uniform float u_mix;
uniform vec4 u_bounds;
uniform float u_hours;
uniform float u_seed;
uniform float u_ageStep;
uniform int u_src;
uniform float u_aux;
out vec4 fragColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float mercY(float lat) {
  float clamped = clamp(lat, -85.0, 85.0);
  float rad = radians(clamped);
  return 0.5 - log(tan(0.7853981633974483 + rad * 0.5)) / 6.283185307179586;
}

vec4 sampleRaw(float lon360, float lat) {
  float u = lon360 / 360.0 * ((u_texSize.x - 1.0) / u_texSize.x) + 0.5 / u_texSize.x;
  float v = (lat + 90.0) / 180.0 * ((u_texSize.y - 1.0) / u_texSize.y) + 0.5 / u_texSize.y;
  vec4 a = texture(u_wind0, vec2(u, v));
  vec4 b = texture(u_wind1, vec2(u, v));
  return mix(a, b, u_mix);
}

vec2 decodeWind(vec4 raw) {
  return raw.rg * (2.0 * ${RANGE}.0) - ${RANGE}.0;
}

${LIFESPAN_GLSL}

bool inside(float lon360, float lat) {
  if (lat < u_bounds.y || lat > u_bounds.w) return false;
  float west = u_bounds.x;
  float east = u_bounds.z;
  if (east - west >= 359.0) return true;
  float lon = lon360 > 180.0 ? lon360 - 360.0 : lon360;
  float x = lon;
  if (x < west) x += 360.0;
  return x >= west && x <= east;
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 prev = texelFetch(u_states, ivec3(ij, u_src), 0);
  float lon = prev.r * 360.0;
  float lat = prev.g * 180.0 - 90.0;
  float age = prev.b;
  bool spawn = age < 0.5 || age >= lifeSpan(ij) || !inside(lon, lat);
  vec2 wind;
  if (spawn) {
    float rx = hash(vec2(gl_FragCoord.x + u_seed, gl_FragCoord.y));
    float ry = hash(vec2(gl_FragCoord.y + u_seed, gl_FragCoord.x + 19.0));
    float span = max(u_bounds.z - u_bounds.x, 0.4);
    float lonSigned = u_bounds.x + rx * span;
    float y = mix(mercY(u_bounds.w), mercY(u_bounds.y), ry);
    lat = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * y))));
    lon = mod(lonSigned + 360.0, 360.0);
    age = 1.0;
  } else {
    wind = decodeWind(sampleRaw(lon, lat));
    float cosLat = max(cos(radians(lat)), 0.22);
    float seconds = u_hours * 3600.0;
    lon = mod(lon + wind.x * seconds / (111320.0 * cosLat) + 360.0, 360.0);
    lat = clamp(lat + wind.y * seconds / 110540.0, -85.0, 85.0);
    age += u_ageStep;
  }
  vec4 raw = sampleRaw(lon, lat);
  wind = decodeWind(raw);
  float plotted = length(wind);
  if (u_aux > 0.5) {
    if (raw.a < 0.2) {
      fragColor = vec4(lon / 360.0, (lat + 90.0) / 180.0, 0.0, -1.0);
      return;
    }
    plotted = raw.b * 20.0;
  }
  fragColor = vec4(lon / 360.0, (lat + 90.0) / 180.0, age, plotted);
}`;

const DRAW_VS = `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_states;
uniform vec2 u_viewport;
uniform float u_width;
uniform float u_offset;
uniform int u_head;
uniform int u_segments;
uniform int u_cols;
uniform int u_stride;
uniform float u_phase;
out float v_alpha;
out float v_speed;
${LIFESPAN_GLSL}

vec2 mercator(float lon360, float lat) {
  float lon = lon360 > 180.0 ? lon360 - 360.0 : lon360;
  float x = (lon + 180.0) / 360.0;
  float clamped = clamp(lat, -85.05112878, 85.05112878);
  float rad = radians(clamped);
  float y = 0.5 - log(tan(0.7853981633974483 + rad * 0.5)) / 6.283185307179586;
  return vec2(x, y);
}

bool facing(vec4 c) {
#ifdef GLOBE
  // MapLibre globe writes z = (1 - horizonPlaneDistance) * w: hidden side has z > w.
  return c.w > 0.0001 && c.z <= c.w;
#else
  return c.w > 0.0001;
#endif
}

vec2 screenOf(vec2 merc, out float ok) {
  vec4 c = projectTile(merc + vec2(u_offset, 0.0));
  ok = facing(c) ? 1.0 : 0.0;
  return (c.xy / max(c.w, 0.0001) * 0.5 + 0.5) * u_viewport;
}

void main() {
  int corner = gl_VertexID - (gl_VertexID / 6) * 6;
  int pair = gl_VertexID / 6;
  int particle = pair / u_segments;
  int segment = pair - particle * u_segments;
  ivec2 ij = ivec2(particle - (particle / u_cols) * u_cols, particle / u_cols);
  vec4 newer = texelFetch(u_states, ivec3(ij, (u_head - segment + ${TRAIL} * 4) % ${TRAIL}), 0);
  vec4 olderState = texelFetch(u_states, ivec3(ij, (u_head - segment - 1 + ${TRAIL} * 4) % ${TRAIL}), 0);
  bool broken = newer.b + 0.1 < olderState.b || olderState.b < 0.5 || newer.b < 0.5;
  vec4 pn = newer;
  vec4 po = olderState;
  if (u_stride > 1) {
    // Strided history: layer head is the live state and the frozen layers
    // behind it are u_stride updates apart, the newest of them u_phase
    // short of an even spacing. Slide each trail point back along the stored
    // chain so the points are u_stride updates apart and the first one is the
    // live particle.
    vec4 third = texelFetch(u_states, ivec3(ij, (u_head - segment - 2 + ${TRAIL} * 4) % ${TRAIL}), 0);
    broken = broken || olderState.b + 0.1 < third.b || third.b < 0.5;
    float fn = segment == 0 ? 0.0 : u_phase;
    float dn = olderState.r - newer.r;
    pn = vec4(fract(newer.r + (dn - round(dn)) * fn), mix(newer.g, olderState.g, fn), newer.ba);
    float dof = third.r - olderState.r;
    po = vec4(fract(olderState.r + (dof - round(dof)) * u_phase), mix(olderState.g, third.g, u_phase), olderState.ba);
  }
  vec2 ma = mercator(po.r * 360.0, po.g * 180.0 - 90.0);
  vec2 mb = mercator(pn.r * 360.0, pn.g * 180.0 - 90.0);
  bool wraps = abs(ma.x - mb.x) > 0.5 || abs(pn.g - po.g) > 0.04;
  float along = float(segment) / max(float(u_segments), 1.0);
  float fade = pow(1.0 - along, 1.2);
  float span = lifeSpan(ij);
  float life = smoothstep(1.0, 14.0, newer.b) * (1.0 - smoothstep(span - 18.0, span, newer.b));
  v_alpha = broken || wraps ? 0.0 : fade * life * 0.5;
  v_speed = newer.a;
  float oka = 0.0;
  float okb = 0.0;
  vec2 sa = screenOf(ma, oka);
  vec2 sb = screenOf(mb, okb);
  if (oka < 0.5 || okb < 0.5) v_alpha = 0.0;
  if (length(sb - sa) > 56.0) v_alpha = 0.0;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len < 0.001 ? vec2(1.0, 0.0) : dir / len;
  float cap = max(u_width, 1.0) * 0.3;
  sa -= dir * cap;
  sb += dir * cap;
  vec2 normal = vec2(-dir.y, dir.x) * max(u_width, 1.0);
  bool useB = corner == 1 || corner == 4 || corner == 5;
  bool positive = corner == 2 || corner == 3 || corner == 5;
  vec2 s = (useB ? sb : sa) + (positive ? normal : -normal);
  vec2 clip = (s / u_viewport) * 2.0 - 1.0;
  gl_Position = vec4(v_alpha > 0.0 ? clip : vec2(2.0), 0.0, 1.0);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
in float v_alpha;
in float v_speed;
uniform float u_tone;
uniform float u_alphaGain;
out vec4 fragColor;
${LUT_GLSL}

void main() {
  if (v_alpha < 0.01) discard;
  vec3 color = lutColor(v_speed).rgb * u_tone;
  fragColor = vec4(color, min(v_alpha * u_alphaGain, 0.9));
}`;

const FIELD_VS = `
uniform float u_offset;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in float a_side;
out vec2 v_merc;
out float v_wrap;
void main() {
  vec2 merc = a_pos + vec2(u_offset, 0.0);
  v_merc = merc;
  v_wrap = a_side < 0.5 ? a_pos.x + 0.5 : a_pos.x - 0.5;
  gl_Position = projectTile(merc);
}`;

const FIELD_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform vec2 u_texSize;
uniform float u_mix;
uniform float u_opacity;
uniform float u_veilTone;
in vec2 v_merc;
in float v_wrap;
out vec4 fragColor;

${LUT_GLSL}

vec2 gridUv(vec2 merc) {
  float wrapped = v_wrap;
  float lat = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * merc.y))));
  float u = wrapped * ((u_texSize.x - 1.0) / u_texSize.x) + 0.5 / u_texSize.x;
  float v = (lat + 90.0) / 180.0 * ((u_texSize.y - 1.0) / u_texSize.y) + 0.5 / u_texSize.y;
  return vec2(u, v);
}

void main() {
  vec2 uv = gridUv(v_merc);
  vec2 w0 = texture(u_wind0, uv).rg * (2.0 * ${RANGE}.0) - ${RANGE}.0;
  vec2 w1 = texture(u_wind1, uv).rg * (2.0 * ${RANGE}.0) - ${RANGE}.0;
  float speed = length(mix(w0, w1, u_mix));
  float knots = speed * 1.943844;
  float veil = smoothstep(46.0, 120.0, knots) * u_opacity * 0.32;
  fragColor = vec4(lutColor(speed).rgb * u_veilTone, veil);
}`;

const CONTOUR_FS = `#version 300 es
precision highp float;
uniform sampler2D u_field0;
uniform sampler2D u_field1;
uniform vec2 u_texSize;
uniform float u_mix;
uniform float u_zoom;
uniform int u_valueMode;
uniform int u_maskMode;
uniform float u_minorStep;
uniform float u_majorStep;
uniform int u_zero;
uniform int u_rh;
uniform float u_levels[4];
uniform int u_nLevels;
uniform float u_thin;
uniform float u_plotScale;
uniform float u_plotOffset;
uniform float u_hasFill;
uniform float u_baseLuma;
uniform float u_lineGain;
uniform float u_emphasis;
in vec2 v_merc;
in float v_wrap;
out vec4 fragColor;
${LUT_GLSL}
${LUMA_GLSL}

float fieldOf(vec4 raw) {
  return u_valueMode == 1 ? raw.b * 20.0 : raw.r;
}

float intervalLine(float value, float step, float inner, float outer) {
  float w = fwidth(value);
  if (w < 1e-5) return 0.0;
  float nearest = round(value / step) * step;
  float dist = abs(value - nearest);
  return 1.0 - smoothstep(w * inner, w * outer, dist);
}

float discreteLine(float value, float level, float thin) {
  float w = fwidth(value);
  if (w < 1e-5) return 0.0;
  if (thin > 0.5) w = min(w, 0.85 * u_plotScale);
  float dist = abs(value - level);
  float inner = thin > 0.5 ? 0.08 : 0.22;
  float outer = thin > 0.5 ? 0.46 : 1.15;
  return 1.0 - smoothstep(w * inner, w * outer, dist);
}

// Light 5-tap smoothing for the isobar field. The 0.25 deg grid is stored in
// 0.1 hPa steps and has about 0.2 hPa of terrain noise over land, which a thick
// line over a flat high turns into speckle and coast-shaped scribbles. Taps a
// couple of texels out (about 0.5 deg) remove that without moving a 4 hPa line
// by a visible amount.
float blurredField(sampler2D tex, vec2 uv) {
  vec2 px = 1.75 / u_texSize;
  return 0.28 * texture(tex, uv).r + 0.18 * (
    texture(tex, uv + vec2(px.x, 0.0)).r + texture(tex, uv - vec2(px.x, 0.0)).r +
    texture(tex, uv + vec2(0.0, px.y)).r + texture(tex, uv - vec2(0.0, px.y)).r);
}

// Pressure isobars: a line of fixed pixel half-width (isotropic gradient, so a
// diagonal line is as thick as a horizontal one) with a one-pixel antialias ramp.
float isoRibbon(float value, float grad, float step, float halfPx) {
  float nearest = round(value / step) * step;
  float dist = abs(value - nearest);
  return 1.0 - smoothstep(grad * max(halfPx - 0.5, 0.0), grad * (halfPx + 0.5), dist);
}

void main() {
  float wrapped = v_wrap;
  float lat = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * v_merc.y))));
  float u = wrapped * ((u_texSize.x - 1.0) / u_texSize.x) + 0.5 / u_texSize.x;
  float v = (lat + 90.0) / 180.0 * ((u_texSize.y - 1.0) / u_texSize.y) + 0.5 / u_texSize.y;
  vec2 uv = vec2(u, v);
  vec4 a = texture(u_field0, uv);
  vec4 b = texture(u_field1, uv);
  float mask = 1.0;
  if (u_maskMode == 1) mask = mix(a.g, b.g, u_mix);
  else if (u_maskMode == 2) mask = mix(a.a, b.a, u_mix);
  if (mask < 0.35) discard;
  float value = mix(fieldOf(a), fieldOf(b), u_mix);
  float plot = value * u_plotScale + u_plotOffset;

  // u_emphasis is 1.0 for every contour set except sea-level pressure.
  bool bold = u_emphasis > 1.0;
  if (bold && u_valueMode == 0) {
    plot = mix(blurredField(u_field0, uv), blurredField(u_field1, uv), u_mix) * u_plotScale + u_plotOffset;
  }
  float minorLine = 0.0;
  float majorLine = 0.0;
  float minorHalo = 0.0;
  float majorHalo = 0.0;
  if (bold) {
    float grad = max(length(vec2(dFdx(plot), dFdy(plot))), 1e-5);
    float cover = fwidth(plot) / u_minorStep;
    // Thicker lines merge sooner than hairlines, so the 4 hPa fade is
    // pushed later in pixel spacing and starts later in zoom.
    float densityFade = 1.0 - smoothstep(0.34, 0.80, cover);
    float minorScale = smoothstep(1.1, 2.2, u_zoom);
    float halfMinor = 0.5 * u_emphasis;
    float halfMajor = 1.0 * u_emphasis;
    minorLine = isoRibbon(plot, grad, u_minorStep, halfMinor) * densityFade * minorScale;
    majorLine = isoRibbon(plot, grad, u_majorStep, halfMajor);
    minorHalo = isoRibbon(plot, grad, u_minorStep, halfMinor + 1.0) * densityFade * minorScale;
    majorHalo = isoRibbon(plot, grad, u_majorStep, halfMajor + 1.0);
  } else {
    if (u_minorStep > 0.0) {
      float cover = fwidth(plot) / u_minorStep;
      float densityFade = 1.0 - smoothstep(0.28, 0.62, cover);
      float minorScale = smoothstep(1.7, 3.0, u_zoom);
      minorLine = intervalLine(plot, u_minorStep, 0.2, 1.05) * densityFade * minorScale;
    }
    majorLine = u_majorStep > 0.0 ? intervalLine(plot, u_majorStep, 0.25, 1.35) : 0.0;
  }
  float levelLine = 0.0;
  if (u_nLevels > 0) levelLine = max(levelLine, discreteLine(plot, u_levels[0], u_thin));
  if (u_nLevels > 1) levelLine = max(levelLine, discreteLine(plot, u_levels[1], u_thin));
  if (u_nLevels > 2) levelLine = max(levelLine, discreteLine(plot, u_levels[2], u_thin));
  if (u_nLevels > 3) levelLine = max(levelLine, discreteLine(plot, u_levels[3], u_thin));
  float zeroLine = 0.0;
  if (u_zero == 1) {
    float w = fwidth(value);
    if (w >= 1e-5) zeroLine = 1.0 - smoothstep(w * 0.34, w * 1.75, abs(value));
  }
  float rhLine = 0.0;
  if (u_rh == 1) {
    float w = max(fwidth(value), 1e-5);
    float at50 = 1.0 - smoothstep(w * 0.25, w * 1.35, abs(value - 50.0));
    float at90 = 1.0 - smoothstep(w * 0.25, w * 1.35, abs(value - 90.0));
    rhLine = max(at50, at90);
  }

  float alpha = minorLine * 0.40;
  alpha = max(alpha, majorLine * 0.68);
  alpha = max(alpha, levelLine * (u_thin > 0.5 ? 0.36 : 0.66));
  alpha = max(alpha, rhLine * 0.72);
  alpha = max(alpha, zeroLine * 0.9);
  float haloAlpha = 0.0;
  if (bold) {
    alpha = max(minorLine * 0.86, majorLine);
    haloAlpha = max(minorHalo, majorHalo) * 0.34;
  }
  alpha = min(alpha * u_lineGain, 1.0);
  if (max(alpha, haloAlpha) < 0.03) discard;

  // Ink: light lines over dark backdrops, dark lines over light ones. The
  // backdrop is the basemap (u_baseLuma, set by the theme) mixed with the
  // color fill under the line when this field is also the one being filled.
  // At a fill edge (discrete levels) the fill is sampled on both sides.
  float backdrop = u_baseLuma;
  if (u_hasFill > 0.5) {
    float e = fwidth(value);
    vec4 lo = lutColor(value - e);
    vec4 hi = lutColor(value + e);
    float fillLuma = 0.5 * (lumaOf(lo.rgb) * lo.a + lumaOf(hi.rgb) * hi.a);
    float fillAlpha = 0.5 * (lo.a + hi.a);
    backdrop = mix(u_baseLuma, fillLuma / max(fillAlpha, 0.001), fillAlpha);
  }
  bool onLight = backdrop > 0.56;
  vec3 minorInk = onLight ? vec3(0.17, 0.21, 0.26) : vec3(0.72, 0.78, 0.82);
  vec3 majorInk = onLight ? vec3(0.08, 0.11, 0.15) : vec3(0.86, 0.91, 0.94);
  vec3 zeroInk = onLight ? vec3(0.02, 0.04, 0.10) : vec3(0.97, 0.98, 1.0);
  vec3 color = minorInk;
  if (majorLine > 0.5 || rhLine > 0.5) color = majorInk;
  if (zeroLine > 0.55) color = zeroInk;
  if (bold) {
    vec3 isoMinor = onLight ? vec3(0.09, 0.13, 0.19) : vec3(0.82, 0.88, 0.92);
    vec3 isoMajor = onLight ? vec3(0.02, 0.04, 0.09) : vec3(0.97, 0.985, 1.0);
    vec3 haloInk = onLight ? vec3(1.0) : vec3(0.02, 0.04, 0.08);
    vec3 core = majorLine > 0.5 ? isoMajor : isoMinor;
    // Core ink inside the line, opposing-luma halo on its flanks: the line
    // stays legible over a color fill or a busy coastline on either basemap.
    float total = max(alpha, haloAlpha);
    color = mix(haloInk, core, clamp(alpha / max(total, 0.001), 0.0, 1.0));
    alpha = total;
  }
  fragColor = vec4(color, alpha);
}`;

const MARK_VS = `
precision highp float;
uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform vec2 u_texSize;
uniform float u_mix;
uniform vec2 u_viewport;
uniform float u_offset;
uniform vec4 u_bounds;
uniform ivec2 u_grid;
uniform float u_px;
uniform float u_baseLuma;
out float v_alpha;
out float v_backdrop;
${LUT_GLSL}
${LUMA_GLSL}

vec2 mercator(float lonSigned, float lat) {
  float x = (lonSigned + 180.0) / 360.0;
  float clamped = clamp(lat, -85.05112878, 85.05112878);
  float rad = radians(clamped);
  float y = 0.5 - log(tan(0.7853981633974483 + rad * 0.5)) / 6.283185307179586;
  return vec2(x, y);
}

bool facing(vec4 c) {
#ifdef GLOBE
  // MapLibre globe writes z = (1 - horizonPlaneDistance) * w: hidden side has z > w.
  return c.w > 0.0001 && c.z <= c.w;
#else
  return c.w > 0.0001;
#endif
}

vec2 screenOf(vec2 merc, out float ok) {
  vec4 c = projectTile(merc + vec2(u_offset, 0.0));
  ok = facing(c) ? 1.0 : 0.0;
  return (c.xy / max(c.w, 0.0001) * 0.5 + 0.5) * u_viewport;
}

vec2 gridUv(vec2 merc) {
  float wrapped = fract(merc.x - 0.5);
  float lat = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * merc.y))));
  float u = wrapped * ((u_texSize.x - 1.0) / u_texSize.x) + 0.5 / u_texSize.x;
  float v = (lat + 90.0) / 180.0 * ((u_texSize.y - 1.0) / u_texSize.y) + 0.5 / u_texSize.y;
  return vec2(u, v);
}

float wrapLon(float lon) {
  if (lon > 180.0) return lon - 360.0;
  if (lon < -180.0) return lon + 360.0;
  return lon;
}

void main() {
  int vid = gl_VertexID;
  int corner = vid - (vid / 6) * 6;
  int quad = vid / 6;
  int stroke = quad - (quad / 2) * 2;
  int mark = quad / 2;
  int col = mark - (mark / u_grid.x) * u_grid.x;
  int row = mark / u_grid.x;
  float stagger = (row - (row / 2) * 2) == 0 ? 0.32 : 0.78;
  float fx = (float(col) + stagger) / float(u_grid.x);
  float fy = (float(row) + 0.5) / float(u_grid.y);
  float lon = mix(u_bounds.x, u_bounds.z, fx);
  float lat = mix(u_bounds.y, u_bounds.w, fy);
  vec2 merc = mercator(wrapLon(lon), lat);
  vec2 uv = gridUv(merc);
  vec4 raw = mix(texture(u_wind0, uv), texture(u_wind1, uv), u_mix);
  vec2 wind = raw.rg * (2.0 * ${RANGE}.0) - ${RANGE}.0;
  float mag = length(wind);
  v_alpha = (raw.a < 0.35 || mag < 0.4) ? 0.0 : 0.9;
  vec4 fill = lutColor(raw.b * 20.0);
  v_backdrop = mix(u_baseLuma, lumaOf(fill.rgb), fill.a);
  vec2 dirUnit = mag < 0.4 ? vec2(1.0, 0.0) : wind / mag;
  float cosLat = max(cos(radians(lat)), 0.25);
  vec2 merc2 = mercator(wrapLon(lon + dirUnit.x * 0.8 / cosLat), clamp(lat + dirUnit.y * 0.8, -85.0, 85.0));
  if (abs(merc.x - merc2.x) > 0.5) v_alpha = 0.0;
  float oka = 0.0;
  float okb = 0.0;
  vec2 sa = screenOf(merc, oka);
  vec2 sb = screenOf(merc2, okb);
  if (oka < 0.5 || okb < 0.5) v_alpha = 0.0;
  vec2 forward = sb - sa;
  float flen = length(forward);
  if (flen < 0.2) v_alpha = 0.0;
  forward = flen < 0.001 ? vec2(1.0, 0.0) : forward / flen;
  vec2 side = vec2(-forward.y, forward.x);
  vec2 tip = sa;
  vec2 tail = tip - forward * 13.0 + side * (stroke == 0 ? 5.4 : -5.4);
  vec2 dir = tail - tip;
  float len = length(dir);
  dir = len < 0.001 ? vec2(1.0, 0.0) : dir / len;
  vec2 normal = vec2(-dir.y, dir.x) * u_px;
  bool useB = corner == 1 || corner == 4 || corner == 5;
  bool positive = corner == 2 || corner == 3 || corner == 5;
  vec2 s = (useB ? tail : tip) + (positive ? normal : -normal);
  vec2 clip = (s / u_viewport) * 2.0 - 1.0;
  gl_Position = vec4(v_alpha > 0.0 ? clip : vec2(2.0), 0.0, 1.0);
}`;

const MARK_FS = `#version 300 es
precision highp float;
in float v_alpha;
in float v_backdrop;
out vec4 fragColor;
void main() {
  if (v_alpha < 0.01) discard;
  vec3 ink = v_backdrop > 0.56 ? vec3(0.10, 0.13, 0.17) : vec3(0.86, 0.90, 0.92);
  fragColor = vec4(ink, v_alpha);
}`;

const WAVE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform vec2 u_texSize;
uniform float u_mix;
uniform float u_gain;
in vec2 v_merc;
in float v_wrap;
out vec4 fragColor;

${LUT_GLSL}

vec2 gridUv(vec2 merc) {
  float wrapped = v_wrap;
  float lat = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * merc.y))));
  float u = wrapped * ((u_texSize.x - 1.0) / u_texSize.x) + 0.5 / u_texSize.x;
  float v = (lat + 90.0) / 180.0 * ((u_texSize.y - 1.0) / u_texSize.y) + 0.5 / u_texSize.y;
  return vec2(u, v);
}

void main() {
  vec2 uv = gridUv(v_merc);
  vec4 a = texture(u_wind0, uv);
  vec4 b = texture(u_wind1, uv);
  float mask = mix(a.a, b.a, u_mix);
  if (mask < 0.2) discard;
  float meters = mix(a.b, b.b, u_mix) * 20.0;
  vec4 fill = lutColor(meters);
  fragColor = vec4(fill.rgb, min(fill.a * u_gain, 1.0) * mask);
}`;

const SCALAR_FS = `#version 300 es
precision highp float;
uniform sampler2D u_scalar0;
uniform sampler2D u_scalar1;
uniform vec2 u_texSize;
uniform float u_mix;
uniform float u_gain;
in vec2 v_merc;
in float v_wrap;
out vec4 fragColor;

${LUT_GLSL}

vec2 gridUv(vec2 merc) {
  float wrapped = v_wrap;
  float lat = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * merc.y))));
  float u = wrapped * ((u_texSize.x - 1.0) / u_texSize.x) + 0.5 / u_texSize.x;
  float v = (lat + 90.0) / 180.0 * ((u_texSize.y - 1.0) / u_texSize.y) + 0.5 / u_texSize.y;
  return vec2(u, v);
}

void main() {
  vec2 uv = gridUv(v_merc);
  vec4 a = texture(u_scalar0, uv);
  vec4 b = texture(u_scalar1, uv);
  float mask = mix(a.g, b.g, u_mix);
  if (mask < 0.35) discard;
  vec4 fill = lutColor(mix(a.r, b.r, u_mix));
  if (fill.a < 0.01) discard;
  fragColor = vec4(fill.rgb, min(fill.a * u_gain, 1.0) * mask);
}`;

function mercatorY(lat) {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

function buildGlobeMesh() {
  const latSteps = 48;
  const lonHalf = 64;
  const positions = [];
  const sides = [];
  const indices = [];
  for (const [x0, x1, side] of [[0, 0.5, 0], [0.5, 1, 1]]) {
    const base = positions.length / 2;
    for (let y = 0; y <= latSteps; y++) {
      const lat = 85 - (170 * y) / latSteps;
      const my = mercatorY(lat);
      for (let x = 0; x <= lonHalf; x++) {
        positions.push(x0 + ((x1 - x0) * x) / lonHalf, my);
        sides.push(side);
      }
    }
    const stride = lonHalf + 1;
    for (let y = 0; y < latSteps; y++) {
      for (let x = 0; x < lonHalf; x++) {
        const i = base + y * stride + x;
        indices.push(i, i + stride, i + 1, i + 1, i + stride, i + stride + 1);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    sides: new Float32Array(sides),
    indices: new Uint16Array(indices),
  };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "shader failed to compile");
  }
  return shader;
}

function program(gl, vertex, fragment) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || "program failed to link");
  }
  return prog;
}

function texture2d(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function encodeWind(grid) {
  const width = grid.ni + 1;
  const height = grid.nj;
  const ni = grid.ni;
  const rgba = new Uint8Array(width * height * 4);
  const heights = grid.height;
  const us = grid.u;
  const vs = grid.v;
  for (let y = 0; y < height; y++) {
    const row = y * ni;
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      const i = row + (x === ni ? 0 : x);
      rgba[o] = encodeComponent(us[i]);
      rgba[o + 1] = encodeComponent(vs[i]);
      if (heights) {
        const h = heights[i];
        if (Number.isFinite(h)) {
          rgba[o + 2] = Math.max(0, Math.min(255, Math.round((h / 20) * 255)));
          rgba[o + 3] = 255;
        }
      } else {
        rgba[o + 3] = 255;
      }
    }
  }
  return { rgba, width, height };
}

// Two floats per texel: R is the value, G is 1 when the value is finite and 0
// when it is missing. The shaders only ever read .r and .g, so this uploads as
// RG32F with half the bytes of the old RGBA32F layout.
export function encodeScalar(grid) {
  const width = grid.ni + 1;
  const height = grid.nj;
  const ni = grid.ni;
  const values = grid.values;
  const data = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    const row = y * ni;
    let o = y * width * 2;
    for (let x = 0; x < width; x++, o += 2) {
      const value = values[row + (x === ni ? 0 : x)];
      if (Number.isFinite(value)) {
        data[o] = value;
        data[o + 1] = 1;
      }
    }
  }
  return { data, width, height };
}

export function encodePressure(grid) {
  const width = grid.ni + 1;
  const ni = grid.ni;
  const hpa = grid.hpa;
  const data = new Float32Array(width * grid.nj);
  for (let y = 0; y < grid.nj; y++) {
    const row = y * ni;
    const o = y * width;
    for (let x = 0; x < ni; x++) data[o + x] = hpa[row + x];
    data[o + ni] = hpa[row];
  }
  return { data, width, height: grid.nj };
}

function encodeComponent(ms) {
  const x = (ms + RANGE) / (RANGE * 2);
  if (x <= 0) return 0;
  if (x >= 1) return 255;
  return Math.round(x * 255);
}

// Theme-dependent drawing constants. The dark values reproduce the original
// look on CARTO Dark Matter; the light values keep the same layers legible on
// CARTO Positron.
//   baseLuma  lightness of the basemap under the layers (contour and mark ink)
//   tone      multiplier on particle color (darkens light-ramp colors on white)
//   alphaGain multiplier on particle trail opacity
//   veilTone  multiplier on the strong-wind veil color
//   fillGain  multiplier on scalar and wave fill opacity
//   lineGain  multiplier on contour line opacity
const THEMES = {
  dark: { baseLuma: 0.38, tone: 1, alphaGain: 1, veilTone: 0.42, fillGain: 1, lineGain: 1 },
  light: { baseLuma: 0.92, tone: 0.58, alphaGain: 2.2, veilTone: 0.9, fillGain: 1.1, lineGain: 1.15 },
};

export class WindLayer {
  constructor() {
    this.id = "wind-particles";
    this.type = "custom";
    this.renderingMode = "2d";
    this.animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.flow = 1;
    this.density = 0.1;
    this.segments = 18;
    this.opacity = 0.2;
    this.pressureMix = 0;
    this.pressureSize = [1, 1];
    this.mix = 0;
    this.mode = "wind";
    this.motion = "wind";
    this.colorMode = "none";
    this.motionKey = "wind10";
    this.globeness = 0;
    this.variant = "";
    this.aux = 0;
    this.contour = null;
    this.viewKey = "wind10";
    this.scalarMix = 0;
    this.scalarScale = "temp";
    this.theme = THEMES.dark;
    // Row center in the lookup texture and data domain for every scale.
    this.scaleInfo = {};
    for (const id of SCALE_IDS) {
      const scale = SCALES[id];
      this.scaleInfo[id] = {
        row: (scale.row + 0.5) / SCALE_IDS.length,
        lo: scale.domain[0],
        hi: scale.domain[1],
      };
    }
    this.scalarSize = [1, 1];
    this.ready = false;
    this.head = 0;
    this.seed = 1;
    this.last = 0;
    this.rows = ROWS;
    this.maxRows = ROWS;
    this.stride = 1;
    this.since = 0;
    this.texSize = [1, 1];
    // program -> Map(uniform name -> location). Locations never change for a
    // linked program, so look each one up once instead of every frame.
    this.locs = new Map();
    this.levelsBuf = new Float32Array(4);
    // viewBounds() result for the frame being rendered (reset in render()).
    this.boundsCache = null;
  }

  loc(gl, prog, name) {
    let table = this.locs.get(prog);
    if (!table) {
      table = new Map();
      this.locs.set(prog, table);
    }
    let location = table.get(name);
    if (location === undefined) {
      location = gl.getUniformLocation(prog, name);
      table.set(name, location);
    }
    return location;
  }

  // Most rows the state texture may grow to. Phones and tablets (coarse pointer
  // or a small screen) get 2x the base particle count, desktops 4x, and either
  // is held to a memory budget for the state array.
  capacityCeiling() {
    let phone = false;
    try {
      phone =
        window.matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;
    } catch (error) {
      phone = false;
    }
    const factor = phone ? 2 : 4;
    const budget = (phone ? 96 : 192) * 1024 * 1024;
    return Math.max(ROWS, Math.min(ROWS * factor, Math.floor(budget / STATE_BYTES_PER_ROW)));
  }

  allocStates(gl, rows) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA32F, COLS, rows, TRAIL, 0, gl.RGBA, gl.FLOAT, null);
    return tex;
  }

  allocScratch(gl, rows) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, COLS, rows, 0, gl.RGBA, gl.FLOAT, null);
    return tex;
  }

  // Particles to draw: the density slider scaled by zoom, clamped to what the
  // device ceiling allows.
  particleCount(zoom) {
    const zoomScale = Math.min(1.15, Math.pow(2, (zoom - 2.6) * 0.42));
    const wanted = Math.max(1, Math.floor(COUNT * this.density * zoomScale));
    return Math.min(wanted, COLS * this.maxRows);
  }

  // Resize the state texture array (and the scratch target) to follow the
  // requested particle count. It grows when the count needs more rows than are
  // allocated, in ROW_STEP increments up to the device ceiling, and drops back
  // toward the base size once the count falls under half of what is held, so a
  // slider drag reallocates a few times at most and a returned slider gives the
  // memory back. Existing particles and trails are copied across; new rows
  // start at age 0 and spawn on the next update. If an allocation fails the
  // ceiling drops to the rows already held.
  ensureCapacity(gl, count) {
    const needed = Math.ceil(count / COLS);
    let rows = this.rows;
    if (needed > this.rows) {
      if (this.rows >= this.maxRows) return;
      rows = Math.min(this.maxRows, Math.ceil(needed / ROW_STEP) * ROW_STEP);
    } else if (this.rows > ROWS && needed * 2 < this.rows) {
      rows = Math.max(ROWS, Math.ceil(needed / ROW_STEP) * ROW_STEP);
    } else {
      return;
    }
    if (rows === this.rows) return;
    for (let drain = 0; drain < 8 && gl.getError() !== gl.NO_ERROR; drain++);
    const states = this.allocStates(gl, rows);
    let scratch = null;
    if (gl.getError() === gl.NO_ERROR) {
      scratch = this.allocScratch(gl, rows);
      if (gl.getError() !== gl.NO_ERROR) {
        gl.deleteTexture(scratch);
        scratch = null;
      }
    }
    if (!scratch) {
      gl.deleteTexture(states);
      this.maxRows = this.rows;
      return;
    }
    const keep = Math.min(rows, this.rows);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, states);
    for (let layer = 0; layer < TRAIL; layer++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.states, 0, layer);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 0, 0, COLS, keep);
    }
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scratch, 0);
    this.restoreTarget(gl);
    gl.deleteTexture(this.states);
    gl.deleteTexture(this.scratch);
    this.states = states;
    this.scratch = scratch;
    this.rows = rows;
  }

  // Allocation summary for diagnostics: rows, particle capacity and MB held by
  // the state array.
  stats() {
    return {
      rows: this.rows,
      maxRows: this.maxRows,
      capacity: COLS * this.rows,
      stateMB: (STATE_BYTES_PER_ROW * this.rows) / (1024 * 1024),
      stride: this.stride,
    };
  }

  onAdd(map, gl) {
    this.map = map;
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("This browser cannot render the particle buffer.");
    }
    this.updateProgram = program(gl, UPDATE_VS, UPDATE_FS);
    this.mslp0 = texture2d(gl);
    this.mslp1 = texture2d(gl);
    this.scalar0 = texture2d(gl);
    this.scalar1 = texture2d(gl);
    const floatLinear = gl.getExtension("OES_texture_float_linear");
    this.pressureFilter = floatLinear ? gl.LINEAR : gl.NEAREST;
    this.wind0 = texture2d(gl);
    this.wind1 = texture2d(gl);
    this.lut = this.createLut(gl);
    this.rows = ROWS;
    this.maxRows = this.capacityCeiling();
    this.states = this.allocStates(gl, this.rows);
    this.scratch = this.allocScratch(gl, this.rows);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scratch, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Particle update buffer is incomplete.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const mesh = buildGlobeMesh();
    this.meshCount = mesh.indices.length;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    this.fieldIndex = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fieldIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.sideBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sideBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.sides, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fieldIndex);
    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(null);
    this.clearStates(gl);
    this.last = performance.now();
    this.ready = true;
    this.syncTextures();
    this.syncPressure();
    map.triggerRepaint();
  }

  // One RGBA8 texture holding every color scale, one scale per row.
  createLut(gl) {
    const lut = buildLut();
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lut.width, lut.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.activeTexture(gl.TEXTURE0);
    return tex;
  }

  // Point the lookup texture and its row/domain uniforms at one scale.
  bindLut(gl, prog, id) {
    const info = this.scaleInfo[id] || this.scaleInfo.wind;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.uniform1i(this.loc(gl, prog, "u_lut"), 7);
    gl.uniform1f(this.loc(gl, prog, "u_lutRow"), info.row);
    gl.uniform2f(this.loc(gl, prog, "u_domain"), info.lo, info.hi);
  }

  // "dark" or "light": the basemap the layers are drawn on. Changes contour
  // and mark ink, particle brightness and fill opacity so everything stays
  // readable on both. Colors in the lookup texture do not change.
  setTheme(name) {
    const next = THEMES[name] || THEMES.dark;
    if (next === this.theme) return;
    this.theme = next;
    this.map?.triggerRepaint();
  }

  // Release every GL object made in onAdd and ensurePrograms. MapLibre calls
  // this when the layer is removed (a basemap switch re-adds it).
  onRemove(map, gl) {
    const programs = [
      this.updateProgram,
      this.drawProgram,
      this.fieldProgram,
      this.contourProgram,
      this.markProgram,
      this.waveProgram,
      this.scalarProgram,
    ];
    for (const prog of programs) if (prog) gl.deleteProgram(prog);
    for (const tex of [this.mslp0, this.mslp1, this.scalar0, this.scalar1, this.wind0, this.wind1, this.states, this.scratch, this.lut]) {
      if (tex) gl.deleteTexture(tex);
    }
    for (const buf of [this.quad, this.fieldIndex, this.sideBuf]) if (buf) gl.deleteBuffer(buf);
    for (const vao of [this.quadVao, this.particleVao]) if (vao) gl.deleteVertexArray(vao);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    this.updateProgram = this.drawProgram = this.fieldProgram = this.contourProgram = null;
    this.markProgram = this.waveProgram = this.scalarProgram = null;
    this.mslp0 = this.mslp1 = this.scalar0 = this.scalar1 = this.wind0 = this.wind1 = null;
    this.states = this.scratch = this.lut = this.fbo = null;
    this.quad = this.fieldIndex = this.sideBuf = this.quadVao = this.particleVao = null;
    this.uploaded0 = this.uploaded1 = this.uploadedP0 = this.uploadedP1 = null;
    this.uploadedS0 = this.uploadedS1 = null;
    this.locs = new Map();
    this.variant = "";
    this.ready = false;
    this.gl = null;
    this.map = null;
  }

  clearStates(gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, COLS, this.rows);
    gl.clearColor(0, 0, 0, 0);
    for (let layer = 0; layer < TRAIL; layer++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.states, 0, layer);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Particle buffer is incomplete.");
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.restoreTarget(gl);
  }

  // Put MapLibre's render target back: the canvas framebuffer and the full
  // drawing-buffer viewport. This is what MapLibre itself assumes around custom
  // layers (see the notes above endPass()), so nothing needs to be queried.
  restoreTarget(gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  upload(which, encoded) {
    const gl = this.gl;
    if (!gl || !encoded) return;
    const tex = which === 0 ? this.wind0 : this.wind1;
    this.texSize = [encoded.width, encoded.height];
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      encoded.width,
      encoded.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      encoded.rgba
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.map.triggerRepaint();
  }

  setFrames(primary, secondary, mix) {
    this.mix = mix;
    this.primary = primary || null;
    this.secondary = secondary || primary || null;
    this.syncTextures();
  }

  setView(spec) {
    const motionKey = spec.motionKey || spec.key;
    const changed = this.motionKey !== motionKey;
    this.motionKey = motionKey;
    this.viewKey = spec.key;
    this.motion = spec.motion || (spec.mode === "wave" ? "wave" : "wind");
    this.colorMode = spec.color || (spec.mode === "scalar" ? "scalar" : spec.mode === "wave" ? "wave" : "none");
    this.mode = this.motion;
    this.contour = spec.contour || null;
    this.scalarScale = SCALES[spec.scale] ? spec.scale : "temp";
    this.aux = spec.aux ? 1 : 0;
    if (changed && this.ready) this.clearStates(this.gl);
    this.map?.triggerRepaint();
  }

  // When the time bracket advances, the new "before" frame is the old "after"
  // frame, which is already on the GPU in slot 1. Swap the two texture slots
  // (and what they are known to hold) instead of uploading that frame again, so
  // only the genuinely new frame costs an upload. texA/texB and loadedA/loadedB
  // are the property names of one slot pair.
  alignSlots(texA, texB, loadedA, loadedB, want0, want1) {
    const l0 = this[loadedA];
    const l1 = this[loadedB];
    if ((l0 !== want0 && l1 === want0 && l1 !== want1) || (l1 !== want1 && l0 === want1 && l0 !== want0)) {
      const tex = this[texA];
      this[texA] = this[texB];
      this[texB] = tex;
      this[loadedA] = l1;
      this[loadedB] = l0;
    }
  }

  syncTextures() {
    if (!this.gl || !this.primary?.encoded) return;
    const next = this.secondary || this.primary;
    this.alignSlots("wind0", "wind1", "uploaded0", "uploaded1", this.primary, next);
    if (this.uploaded0 !== this.primary) {
      this.uploaded0 = this.primary;
      this.upload(0, this.primary.encoded);
    }
    if (this.uploaded1 !== next) {
      this.uploaded1 = next;
      this.upload(1, next.encoded);
    }
    this.map?.triggerRepaint();
  }

  uploadPressure(which, encoded) {
    const gl = this.gl;
    if (!gl || !encoded) return;
    const tex = which === 0 ? this.mslp0 : this.mslp1;
    this.pressureSize = [encoded.width, encoded.height];
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.pressureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.pressureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      encoded.width,
      encoded.height,
      0,
      gl.RED,
      gl.FLOAT,
      encoded.data
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  setPressure(primary, secondary, mix) {
    if (!primary?.encoded) {
      this.pressurePrimary = null;
      this.pressureSecondary = null;
      this.pressureMix = 0;
      this.map?.triggerRepaint();
      return;
    }
    this.pressureMix = mix;
    this.pressurePrimary = primary;
    this.pressureSecondary = secondary || primary;
    this.syncPressure();
  }

  syncPressure() {
    if (!this.gl || !this.pressurePrimary?.encoded) return;
    const next = this.pressureSecondary || this.pressurePrimary;
    this.alignSlots("mslp0", "mslp1", "uploadedP0", "uploadedP1", this.pressurePrimary, next);
    if (this.uploadedP0 !== this.pressurePrimary) {
      this.uploadedP0 = this.pressurePrimary;
      this.uploadPressure(0, this.pressurePrimary.encoded);
    }
    if (this.uploadedP1 !== next) {
      this.uploadedP1 = next;
      this.uploadPressure(1, next.encoded);
    }
    this.map?.triggerRepaint();
  }

  uploadScalar(which, encoded) {
    const gl = this.gl;
    if (!gl || !encoded) return;
    const tex = which === 0 ? this.scalar0 : this.scalar1;
    this.scalarSize = [encoded.width, encoded.height];
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.pressureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.pressureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG32F,
      encoded.width,
      encoded.height,
      0,
      gl.RG,
      gl.FLOAT,
      encoded.data
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  setScalar(primary, secondary, mix) {
    this.scalarMix = mix;
    if (!primary?.encoded) {
      this.scalarPrimary = null;
      this.scalarSecondary = null;
      this.map?.triggerRepaint();
      return;
    }
    this.scalarPrimary = primary;
    this.scalarSecondary = secondary || primary;
    this.syncScalar();
  }

  syncScalar() {
    if (!this.gl || !this.scalarPrimary?.encoded) return;
    const next = this.scalarSecondary || this.scalarPrimary;
    this.alignSlots("scalar0", "scalar1", "uploadedS0", "uploadedS1", this.scalarPrimary, next);
    if (this.uploadedS0 !== this.scalarPrimary) {
      this.uploadedS0 = this.scalarPrimary;
      this.uploadScalar(0, this.scalarPrimary.encoded);
    }
    if (this.uploadedS1 !== next) {
      this.uploadedS1 = next;
      this.uploadScalar(1, next.encoded);
    }
    this.map?.triggerRepaint();
  }

  viewBounds() {
    if (this.boundsCache) return this.boundsCache;
    const bounds = this.map.getBounds();
    let west = bounds.getWest();
    let east = bounds.getEast();
    let south = bounds.getSouth();
    let north = bounds.getNorth();
    const lonSpan = Math.min(360, east - west);
    const latSpan = Math.max(1, north - south);
    const lonPad = Math.min(20, lonSpan * 0.16);
    const latPad = Math.min(10, latSpan * 0.16);
    west -= lonPad;
    east = west + lonSpan + lonPad * 2;
    south = Math.max(-84, south - latPad);
    north = Math.min(84, north + latPad);
    if (east - west >= 359) {
      west = -180;
      east = 180;
    }
    if (north - south < 1.5) {
      const mid = (north + south) / 2;
      south = mid - 1;
      north = mid + 1;
    }
    this.boundsCache = [west, south, east, north];
    return this.boundsCache;
  }

  // Trail length asked for -> how many history layers the draw reads and how
  // often they are written. Up to TRAIL - 1 segments every update writes a
  // layer (the original behavior). Beyond that a layer is written every
  // stride-th update, so the same layers span stride times as many updates;
  // the strided draw reads TRAIL - 2 segments of stride updates each.
  trailPlan(requested) {
    if (requested <= TRAIL - 1) return { segments: requested, stride: 1 };
    const stride = Math.ceil(requested / (TRAIL - 2));
    return { segments: Math.min(TRAIL - 2, Math.ceil(requested / stride)), stride };
  }

  trailRequest(zoom) {
    const trailBoost = zoom < 3 ? Math.round((3 - zoom) * 1.4) : 0;
    return Math.max(1, Math.round(this.segments + trailBoost));
  }

  step(gl, dt, zoom) {
    if (!this.primary) return;
    // Hours of forecast time to advance this frame, at most MAX_STEP_HOURS per
    // update pass (the old per-frame cap). The cap itself scales with flow
    // above the old slider range, and the frame is split into as many equal
    // passes as it takes, so a fast flow moves particles further per frame
    // without any single pass jumping further than it always could.
    const flowScale = Math.max(1, this.flow / BASE_FLOW_RANGE);
    const hours = Math.min(MAX_STEP_HOURS * flowScale, dt * 6.0 * this.flow * Math.pow(2, 3.15 - zoom));
    const passes = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(hours / MAX_STEP_HOURS - 1e-6)));
    const perPass = hours / passes;
    const stride = this.stride;
    gl.bindVertexArray(this.particleVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scratch, 0);
    gl.viewport(0, 0, COLS, this.rows);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.updateProgram);
    this.bindWind(gl, this.updateProgram);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.states);
    gl.uniform1i(this.loc(gl, this.updateProgram, "u_states"), 2);
    gl.uniform4fv(this.loc(gl, this.updateProgram, "u_bounds"), this.viewBounds());
    gl.uniform1f(this.loc(gl, this.updateProgram, "u_hours"), perPass);
    // Age counts frames, not passes, so a particle lives the same number of
    // frames (and fades in and out on the same schedule) at any flow.
    gl.uniform1f(this.loc(gl, this.updateProgram, "u_ageStep"), 1 / passes);
    gl.uniform1f(this.loc(gl, this.updateProgram, "u_aux"), this.aux);
    for (let pass = 0; pass < passes; pass++) {
      // Layer head always holds the live state. Every update reads it; it is
      // either frozen into history by moving head on (stride 1: every update),
      // or overwritten in place until the stride-th update comes round.
      const advance = this.since + 1 >= stride;
      const dst = advance ? (this.head + 1) % TRAIL : this.head;
      gl.uniform1f(this.loc(gl, this.updateProgram, "u_seed"), this.seed);
      gl.uniform1i(this.loc(gl, this.updateProgram, "u_src"), this.head);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, dst, 0, 0, COLS, this.rows);
      this.head = dst;
      this.since = advance ? 0 : this.since + 1;
      this.seed += 1.618;
    }
    this.restoreTarget(gl);
  }

  syncGlobe() {
    const zoom = this.map.getZoom();
    if (this.variant === "globe") {
      if (zoom <= 11) this.globeness = 1;
      else if (zoom >= 12) this.globeness = 0;
      else this.globeness = 12 - zoom;
    } else {
      this.globeness = 0;
    }
  }

  worldCopies() {
    const zoom = this.map.getZoom();
    if (this.globeness > 0.001) return { zoom, copies: [0] };
    const worlds = this.map.getCanvas().clientWidth / (512 * Math.pow(2, zoom));
    const span = worlds > 0.55 ? Math.min(3, Math.ceil((worlds + 0.2) / 2)) : 0;
    const copies = [];
    for (let copy = -span; copy <= span; copy++) copies.push(copy);
    return { zoom, copies };
  }

  ensurePrograms(gl, shaderData) {
    const variant = shaderData?.variantName || "mercator";
    if (this.variant === variant && this.drawProgram) return;
    const prelude = shaderData?.vertexShaderPrelude
      || "uniform mat4 u_projection_matrix;\nvec4 projectTile(vec2 p){return u_projection_matrix*vec4(p,0.0,1.0);}";
    const define = shaderData?.define || "";
    const vs = (body) => `#version 300 es\n${define}\n${prelude}\n${body}`;
    if (this.drawProgram) {
      // Rebuilt programs get new locations: drop the cached ones with the old programs.
      for (const old of [
        this.drawProgram,
        this.fieldProgram,
        this.contourProgram,
        this.markProgram,
        this.waveProgram,
        this.scalarProgram,
      ]) {
        this.locs.delete(old);
        gl.deleteProgram(old);
      }
    }
    this.variant = variant;
    this.drawProgram = program(gl, vs(DRAW_VS), DRAW_FS);
    this.fieldProgram = program(gl, vs(FIELD_VS), FIELD_FS);
    this.contourProgram = program(gl, vs(FIELD_VS), CONTOUR_FS);
    this.markProgram = program(gl, vs(MARK_VS), MARK_FS);
    this.waveProgram = program(gl, vs(FIELD_VS), WAVE_FS);
    this.scalarProgram = program(gl, vs(FIELD_VS), SCALAR_FS);
  }

  bindProjection(gl, prog) {
    const data = this.projection || {};
    const main = data.mainMatrix;
    if (!main) return;
    gl.uniformMatrix4fv(this.loc(gl, prog, "u_projection_matrix"), false, main);
    gl.uniformMatrix4fv(this.loc(gl, prog, "u_projection_fallback_matrix"), false, data.fallbackMatrix || main);
    const tile = data.tileMercatorCoords || [0, 0, 1, 1];
    gl.uniform4f(this.loc(gl, prog, "u_projection_tile_mercator_coords"), tile[0], tile[1], tile[2], tile[3]);
    const plane = data.clippingPlane || [0, 0, 0, 0];
    gl.uniform4f(this.loc(gl, prog, "u_projection_clipping_plane"), plane[0], plane[1], plane[2], plane[3]);
    gl.uniform1f(this.loc(gl, prog, "u_projection_transition"), this.globeness);
  }

  drawMesh(gl, prog, copies) {
    gl.bindVertexArray(this.quadVao);
    for (const copy of copies) {
      gl.uniform1f(this.loc(gl, prog, "u_offset"), copy);
      gl.drawElements(gl.TRIANGLES, this.meshCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  drawScalar(gl, copies) {
    if (!this.scalarPrimary?.encoded || !this.scalarProgram) return;
    gl.useProgram(this.scalarProgram);
    this.bindProjection(gl, this.scalarProgram);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.scalar0);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.scalar1);
    gl.uniform1i(this.loc(gl, this.scalarProgram, "u_scalar0"), 5);
    gl.uniform1i(this.loc(gl, this.scalarProgram, "u_scalar1"), 6);
    gl.uniform2f(
      this.loc(gl, this.scalarProgram, "u_texSize"),
      this.scalarSize[0],
      this.scalarSize[1]
    );
    gl.uniform1f(this.loc(gl, this.scalarProgram, "u_mix"), this.scalarMix);
    gl.uniform1f(this.loc(gl, this.scalarProgram, "u_gain"), this.theme.fillGain);
    this.bindLut(gl, this.scalarProgram, this.scalarScale);
    this.drawMesh(gl, this.scalarProgram, copies);
  }

  drawContours(gl, copies, zoom) {
    const spec = this.contour;
    if (!spec) return;
    let tex0;
    let tex1;
    let size;
    let mix;
    let valueMode = 0;
    let maskMode = 0;
    if (spec.source === "pressure" || spec.source === "hgt") {
      if (!this.pressurePrimary?.encoded) return;
      tex0 = this.mslp0;
      tex1 = this.mslp1;
      size = this.pressureSize;
      mix = this.pressureMix;
    } else if (spec.source === "wave") {
      if (!this.primary?.encoded) return;
      tex0 = this.wind0;
      tex1 = this.wind1;
      size = this.texSize;
      mix = this.mix;
      valueMode = 1;
      maskMode = 2;
    } else if (spec.source === "scalar") {
      if (!this.scalarPrimary?.encoded) return;
      tex0 = this.scalar0;
      tex1 = this.scalar1;
      size = this.scalarSize;
      mix = this.scalarMix;
      maskMode = 1;
    } else {
      return;
    }
    const prog = this.contourProgram;
    gl.useProgram(prog);
    this.bindProjection(gl, prog);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.uniform1i(this.loc(gl, prog, "u_field0"), 3);
    gl.uniform1i(this.loc(gl, prog, "u_field1"), 4);
    gl.uniform2f(this.loc(gl, prog, "u_texSize"), size[0], size[1]);
    gl.uniform1f(this.loc(gl, prog, "u_mix"), mix);
    gl.uniform1f(this.loc(gl, prog, "u_zoom"), zoom);
    gl.uniform1i(this.loc(gl, prog, "u_valueMode"), valueMode);
    gl.uniform1i(this.loc(gl, prog, "u_maskMode"), maskMode);
    gl.uniform1f(this.loc(gl, prog, "u_minorStep"), spec.minor || 0);
    gl.uniform1f(this.loc(gl, prog, "u_majorStep"), spec.major || 0);
    gl.uniform1f(this.loc(gl, prog, "u_plotScale"), spec.plotScale ?? 1);
    gl.uniform1f(this.loc(gl, prog, "u_plotOffset"), spec.plotOffset || 0);
    gl.uniform1i(this.loc(gl, prog, "u_zero"), spec.zero ? 1 : 0);
    gl.uniform1i(this.loc(gl, prog, "u_rh"), spec.rh ? 1 : 0);
    gl.uniform1f(this.loc(gl, prog, "u_thin"), spec.thin ? 1 : 0);
    // The line is drawn over a color fill when this is also the field being filled.
    const filled =
      (spec.source === "scalar" && this.colorMode === "scalar") ||
      (spec.source === "wave" && this.colorMode === "wave");
    gl.uniform1f(this.loc(gl, prog, "u_hasFill"), filled ? 1 : 0);
    gl.uniform1f(this.loc(gl, prog, "u_baseLuma"), this.theme.baseLuma);
    gl.uniform1f(this.loc(gl, prog, "u_lineGain"), this.theme.lineGain);
    // Pressure isobars carry the emphasis: a line half-width scale that grows a
    // little on dense displays (1.0 keeps every other contour set as it was).
    const dpr = window.devicePixelRatio || 1;
    const emphasis = spec.label === "hpa" ? 1.9 * Math.min(2, 1 + (dpr - 1) * 0.7) : 1;
    gl.uniform1f(this.loc(gl, prog, "u_emphasis"), emphasis);
    this.bindLut(gl, prog, spec.source === "wave" ? "waves" : this.scalarScale);
    const levels = spec.levels || [];
    const levelsBuf = this.levelsBuf;
    levelsBuf[0] = levels[0] || 0;
    levelsBuf[1] = levels[1] || 0;
    levelsBuf[2] = levels[2] || 0;
    levelsBuf[3] = levels[3] || 0;
    gl.uniform1fv(this.loc(gl, prog, "u_levels[0]"), levelsBuf);
    gl.uniform1i(this.loc(gl, prog, "u_nLevels"), Math.min(4, levels.length));
    this.drawMesh(gl, prog, copies);
  }

  drawMarks(gl, copies) {
    if (!this.primary?.encoded) return;
    const zoom = this.map.getZoom();
    const bounds = this.viewBounds();
    const lonSpan = Math.max(1, bounds[2] - bounds[0]);
    const latSpan = Math.max(1, bounds[3] - bounds[1]);
    const spacing = Math.min(18, Math.max(3.2, 20 / Math.pow(2, Math.max(0, zoom - 1.6))));
    const cols = Math.max(3, Math.min(36, Math.round(lonSpan / spacing)));
    const rows = Math.max(2, Math.min(20, Math.round(latSpan / spacing)));
    const prog = this.markProgram;
    gl.bindVertexArray(this.particleVao);
    gl.useProgram(prog);
    this.bindProjection(gl, prog);
    this.bindWind(gl, prog);
    gl.uniform2f(this.loc(gl, prog, "u_viewport"), gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform4fv(this.loc(gl, prog, "u_bounds"), bounds);
    gl.uniform2i(this.loc(gl, prog, "u_grid"), cols, rows);
    gl.uniform1f(this.loc(gl, prog, "u_px"), Math.max(0.9, window.devicePixelRatio * 0.6));
    gl.uniform1f(this.loc(gl, prog, "u_baseLuma"), this.theme.baseLuma);
    this.bindLut(gl, prog, "waves");
    const count = cols * rows * 12;
    for (const copy of copies) {
      gl.uniform1f(this.loc(gl, prog, "u_offset"), copy);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }
  }

  drawWaveColor(gl, copies) {
    if (!this.primary?.encoded || !this.waveProgram) return;
    gl.useProgram(this.waveProgram);
    this.bindProjection(gl, this.waveProgram);
    this.bindWind(gl, this.waveProgram);
    gl.uniform1f(this.loc(gl, this.waveProgram, "u_gain"), this.theme.fillGain);
    this.bindLut(gl, this.waveProgram, "waves");
    this.drawMesh(gl, this.waveProgram, copies);
  }

  drawVeil(gl, copies) {
    if (!this.primary?.encoded || !this.fieldProgram) return;
    gl.useProgram(this.fieldProgram);
    this.bindProjection(gl, this.fieldProgram);
    gl.uniform1f(this.loc(gl, this.fieldProgram, "u_opacity"), this.opacity);
    gl.uniform1f(this.loc(gl, this.fieldProgram, "u_veilTone"), this.theme.veilTone);
    this.bindLut(gl, this.fieldProgram, "wind");
    this.bindWind(gl, this.fieldProgram);
    this.drawMesh(gl, this.fieldProgram, copies);
  }

  drawParticles(gl, copies, zoom) {
    if (!this.primary?.encoded || !this.drawProgram) return;
    const particles = this.particleCount(zoom);
    const { segments, stride } = this.trailPlan(this.trailRequest(zoom));
    // Where the newest frozen layer sits between its even-spacing slots (0 when
    // every update is stored).
    const phase = stride > 1 ? (stride - 1 - Math.min(this.since, stride - 1)) / stride : 0;
    gl.bindVertexArray(this.particleVao);
    gl.useProgram(this.drawProgram);
    this.bindProjection(gl, this.drawProgram);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.states);
    gl.uniform1i(this.loc(gl, this.drawProgram, "u_states"), 2);
    gl.uniform1i(this.loc(gl, this.drawProgram, "u_head"), this.head);
    gl.uniform1i(this.loc(gl, this.drawProgram, "u_segments"), segments);
    gl.uniform1i(this.loc(gl, this.drawProgram, "u_stride"), stride);
    gl.uniform1f(this.loc(gl, this.drawProgram, "u_phase"), phase);
    gl.uniform1i(this.loc(gl, this.drawProgram, "u_cols"), COLS);
    gl.uniform1f(this.loc(gl, this.drawProgram, "u_tone"), this.theme.tone);
    gl.uniform1f(this.loc(gl, this.drawProgram, "u_alphaGain"), this.theme.alphaGain);
    this.bindLut(gl, this.drawProgram, "wind");
    gl.uniform2f(this.loc(gl, this.drawProgram, "u_viewport"), gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.loc(gl, this.drawProgram, "u_width"), Math.max(1.0, window.devicePixelRatio * 0.5));
    for (const copy of copies) {
      gl.uniform1f(this.loc(gl, this.drawProgram, "u_offset"), copy);
      gl.drawArrays(gl.TRIANGLES, 0, particles * segments * 6);
    }
  }

  draw(gl) {
    if (!this.drawProgram) return;
    this.syncGlobe();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    const { zoom, copies } = this.worldCopies();

    if (this.colorMode === "scalar") this.drawScalar(gl, copies);
    else if (this.colorMode === "wave") this.drawWaveColor(gl, copies);
    else if (this.motion === "wind") this.drawVeil(gl, copies);
    this.drawContours(gl, copies, zoom);
    if (this.motion === "wave") this.drawMarks(gl, copies);
    else this.drawParticles(gl, copies, zoom);
  }

  bindWind(gl, prog) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.wind0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.wind1);
    gl.uniform1i(this.loc(gl, prog, "u_wind0"), 0);
    gl.uniform1i(this.loc(gl, prog, "u_wind1"), 1);
    gl.uniform2f(this.loc(gl, prog, "u_texSize"), this.texSize[0], this.texSize[1]);
    gl.uniform1f(this.loc(gl, prog, "u_mix"), this.mix);
  }

  // GL state handoff. This layer used to snapshot and restore GL state with
  // getParameter/isEnabled (about 50 synchronous GPU round trips per frame).
  // Checked against web/vendor/maplibre-gl.js v5.6.2, translucent pass of the
  // custom layer path in the painter:
  //   before render: setCustomLayerDefaults() -> unbindVAO, cullFace default,
  //     activeTexture = TEXTURE0, pixelStoreUnpack* defaults; then setColorMode,
  //     setStencilMode(disabled) and a depth mode. The framebuffer is the canvas
  //     (null) and the viewport is [0, 0, drawingBufferWidth, drawingBufferHeight]
  //     (Painter.resize sets width/height from the canvas size).
  //   after render: context.setDirty() marks every value MapLibre tracks as stale
  //     (colorMask, depthMask/test/func, blend/blendFunc/blendEquation, stencil,
  //     cullFace, program, activeTexture, viewport, framebuffer, texture, buffer
  //     and VAO bindings, pixelStore), so its next set() always re-issues the GL
  //     call; then setBaseState() (cullFace off, viewport, FUNC_ADD) and
  //     bindFramebuffer.set(null).
  // MapLibre only enables SCISSOR_TEST transiently in its debug overlay, so it is
  // off on entry. What is left to hand back by hand is whatever we move away
  // from the entry state that the dirty flags cannot cover: framebuffer and
  // viewport (restoreTarget, after the particle update pass), the VAO, and the
  // active texture unit (endPass). Texture bindings on units 0-6 are left as
  // they are because MapLibre rebinds on every use after setDirty.
  endPass(gl) {
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  render(gl, args) {
    if (!this.ready) return;
    this.projection = args.defaultProjectionData;
    this.boundsCache = null;
    this.ensurePrograms(gl, args.shaderData);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const windFlow = this.motion === "wind" && this.animate && this.primary;
    if (this.motion === "wind") {
      // Particle capacity and the trail stride follow the sliders; both are
      // settled before the update pass so it writes the right history.
      const zoom = this.map.getZoom();
      this.ensureCapacity(gl, this.particleCount(zoom));
      this.stride = this.trailPlan(this.trailRequest(zoom)).stride;
      if (windFlow && dt > 0) this.step(gl, dt, zoom);
    }
    this.draw(gl);
    this.endPass(gl);
    if (windFlow) this.map.triggerRepaint();
  }
}
