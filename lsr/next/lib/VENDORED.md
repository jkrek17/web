# Vendored libraries

Served from this directory so the app needs no CDN (the CSP allows scripts from `'self'` only).
Source-map comments were removed so browsers do not request maps that are not shipped.

| Directory | Package | Version | License |
|---|---|---|---|
| `maplibre/` | [maplibre-gl](https://github.com/maplibre/maplibre-gl-js) (`dist/maplibre-gl.mjs`, `maplibre-gl-worker.mjs`, `maplibre-gl.css`; the `.mjs` files saved as `.js`) | 6.13.0 | BSD-3-Clause (`maplibre/LICENSE.txt`) |
| `pmtiles/` | [pmtiles](https://github.com/protomaps/PMTiles) (`dist/pmtiles.js`, IIFE build, global `pmtiles`) | 4.5.0 | BSD-3-Clause |
| `protomaps-basemaps/` | [@protomaps/basemaps](https://github.com/protomaps/basemaps) (`dist/esm/index.js`, saved as `basemaps.js`) | 5.7.2 | BSD-3-Clause |
| `fontawesome/` | Font Awesome Free | | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT |

The ES modules are saved with a `.js` extension because some web servers do not send a JavaScript MIME type for `.mjs`, which browsers require for modules. `app.js` points MapLibre at the renamed worker with `maplibregl.setWorkerUrl(...)`.

To update: `npm pack <package>@<version>`, copy the same files, remove the `//# sourceMappingURL=` line, and update this table.
The `@protomaps/basemaps` major version must match the tile schema of `basemap/us-core.pmtiles` (v4 tiles ↔ 5.x package).
