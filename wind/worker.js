// Frame loader. Runs as a module worker so that the fetch, the Int16 -> Float32
// decode and the texture encoding stay off the main thread. Results go back by
// transfer, so the main thread receives the typed arrays without copying them.
//
// The same functions are exported so app.js can call them directly when module
// workers are unavailable (loadFrame is then run on the main thread).
import { encodeWind, encodeScalar, encodePressure } from "./wind.js?v=41";

function magicOf(buffer) {
  return String.fromCharCode(...new Uint8Array(buffer, 0, 4));
}

function decodeWind(buffer) {
  const view = new DataView(buffer);
  const magic = magicOf(buffer);
  if (magic !== "WND1" && magic !== "WVD1" && magic !== "WHG1") throw new Error("unexpected wind payload");
  const ni = view.getUint16(4, true);
  const nj = view.getUint16(6, true);
  const count = ni * nj;
  const wave = magic === "WVD1";
  const geo = magic === "WHG1";
  const expected = 20 + count * (wave || geo ? 6 : 4);
  if (buffer.byteLength < expected) throw new Error("truncated wind field");
  const u16 = new Int16Array(buffer, 20, count);
  const v16 = new Int16Array(buffer, 20 + count * 2, count);
  const u = new Float32Array(count);
  const v = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    u[i] = u16[i] / 50;
    v[i] = v16[i] / 50;
  }
  const grid = { ni, nj, u, v };
  if (wave) {
    const h16 = new Int16Array(buffer, 20 + count * 4, count);
    const height = new Float32Array(count);
    for (let i = 0; i < count; i++) height[i] = h16[i] <= -32767 ? NaN : h16[i] / 100;
    grid.height = height;
  }
  if (geo) {
    const z16 = new Int16Array(buffer, 20 + count * 4, count);
    const hgt = new Float32Array(count);
    for (let i = 0; i < count; i++) hgt[i] = z16[i] <= -32767 ? NaN : z16[i];
    grid.hgt = hgt;
  }
  return grid;
}

function decodeScalar(buffer) {
  const view = new DataView(buffer);
  if (magicOf(buffer) !== "SCL1") throw new Error("unexpected scalar payload");
  const ni = view.getUint16(4, true);
  const nj = view.getUint16(6, true);
  const count = ni * nj;
  if (buffer.byteLength < 12 + count * 4) throw new Error("truncated scalar field");
  // The payload already holds little-endian float32 at a 4-byte aligned offset,
  // so view it in place instead of slicing a copy.
  return { ni, nj, values: new Float32Array(buffer, 12, count) };
}

function decodePressure(buffer) {
  const view = new DataView(buffer);
  if (magicOf(buffer) !== "MSL1") throw new Error("unexpected pressure payload");
  const ni = view.getUint16(4, true);
  const nj = view.getUint16(6, true);
  const count = ni * nj;
  if (buffer.byteLength < 12 + count * 2) throw new Error("truncated pressure field");
  const raw = new Int16Array(buffer, 12, count);
  const hpa = new Float32Array(count);
  for (let i = 0; i < count; i++) hpa[i] = raw[i] / 10;
  return { ni, nj, hpa };
}

function peakValue(values) {
  let peak = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value > peak) peak = value;
  }
  return peak;
}

// Static hosting serves the .gz files as plain bytes (no Content-Encoding), so they are
// inflated here. The dev server sends the raw payload and needs no decompression.
async function download(url, fallbackMessage) {
  const response = await fetch(url);
  if (!response.ok) {
    const failure = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(failure.error || fallbackMessage);
  }
  if (!new URL(url, self.location.href).pathname.endsWith(".gz")) return response.arrayBuffer();
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can't decompress forecast data; please update it");
  }
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

async function loadField({ url, layer, hour }) {
  const buffer = await download(url, "field failed");
  const magic = magicOf(buffer);
  let grid;
  if (magic === "WND1" || magic === "WVD1" || magic === "WHG1") grid = decodeWind(buffer);
  else if (magic === "SCL1") grid = decodeScalar(buffer);
  else throw new Error(`unexpected payload ${magic}`);
  if (grid.values) {
    grid.encoded = encodeScalar(grid);
    if (layer === "apcp" && hour === 0) grid.emptyAccum = peakValue(grid.values) <= 0.05;
  } else {
    grid.encoded = encodeWind(grid);
  }
  if (grid.hgt) {
    grid.analysis = {
      encoded: encodePressure({ ni: grid.ni, nj: grid.nj, hpa: grid.hgt }),
    };
  }
  return grid;
}

async function loadPressure({ url }) {
  const buffer = await download(url, "pressure field failed");
  const grid = decodePressure(buffer);
  grid.encoded = encodePressure(grid);
  return grid;
}

// Every ArrayBuffer reachable from a grid, once each, for the transfer list.
export function buffersOf(grid) {
  const found = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (ArrayBuffer.isView(value)) {
      found.add(value.buffer);
      return;
    }
    for (const key of Object.keys(value)) visit(value[key]);
  };
  visit(grid);
  return [...found];
}

export function loadFrame(request) {
  return request.kind === "pressure" ? loadPressure(request) : loadField(request);
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = async (event) => {
    const request = event.data;
    try {
      const grid = await loadFrame(request);
      self.postMessage({ id: request.id, grid }, buffersOf(grid));
    } catch (error) {
      self.postMessage({ id: request.id, error: String(error?.message || error) });
    }
  };
}
