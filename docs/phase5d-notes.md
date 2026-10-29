# Phase 5d notes: chart page with anchor watch

Status: **done, pending your review and the P4 hardware check** · 2026-10-25

This ports the legacy chart app (ESPTiles tiles, vessel, anchor and alarm radius) to a runtime page kind. Design: ADR-0012.

## What changed
- **Schema:** the `chart` page kind (chart id, zoom 1–20, anchor watch, paths with `CHART_DEFAULTS`), additive within v1. Fixtures and a *Chart and anchor watch* starter layout.
- **Plugin:**
  - **Device route** `GET /signalk/v1/api/esphelm/tiles/<chart>/<z>/<x>/<y>`: the chart from the SignalK resources API, its PNG/JPEG tile from the chart's `tilemapUrl` (with the device's Authorization), decoded with **pngjs** and **jpeg-js** (new dependencies, MIT and BSD-3), returned as RGB565 with an ETag. 64-tile LRU.
  - **Editor route** `GET /plugins/esphelm/api/charts`.
  - **Compatibility:** chart pages count as the `chart` widget.
- **Firmware** (`chart.cpp`, ported from ESPTiles):
  - **Tiles:** a 3.2 MB PSRAM tile buffer only while the page is shown, tiles from a second HTTP worker, recentring by moving tiles inside the buffer.
  - **Overlay:** the vessel arrow, the anchor marker and radius, the alarm banner.
  - **Controls:** zoom buttons, the lat/lon/zoom label, a stale indicator, a red-tinted chart at night.
  - **PSRAM only:** `chart` is in `hello.widgets` only with PSRAM.
- **Editor:**
  - **Chart page:** "+ Chart page" and a chart drawer (picker from the server's charts, zoom, anchor watch, paths).
  - **Preview:** the chart's real tiles at the live position, with the overlay.
  - **Display theme:** the control now shows on chart pages too.
- **Test harness:** `startSignalK({ chartSim: true })` adds a charts provider stand-in serving generated PNG tiles.

## Verified
- `npm test`: 15 files, 448 tests. Type-check, lint and build are clean.
  - **Schema and C++ parser:** chart fixtures and odd-field mutations give the same codes.
  - **Tile service:** PNG/JPEG decoding, exact RGB565 bytes, the LRU, every error code.
  - **Routes:** auth, 304, 400/415.
  - **Editor:** chart page operations and a component test (chart picker, preview tile URL at the live position, saved page).
- `npm run e2e -w signalk-esphelm`:
  - real 256×256 RGB565 tiles through the device route
  - 304 on ETag
  - 401 without a token, 404 for an unknown chart
- `npm run e2e:sdl`: all checks, 27 goldens.
  - The 5 new chart goldens were reviewed and identical on a second run.
  - Covered: tiles, the anchor radius, recentring after 350 m, zoom in, the anchor alarm, an unknown chart.
  - Existing goldens unchanged.
- `npm run e2e:editor` (Chrome): all checks, including a chart page with real tiles in the preview and the display downloading it.
- Compiles: P4 (RAM 94,924 B, flash 2.68 MB); C3 (RAM 108,944 B, flash 68.1 %). The C3 build has no PSRAM, so it doesn't list `chart`.

## Not verified / gaps
- **Real charts and hardware:**
  - Tested only with the generated stand-in chart, never a real charts plugin (MBTiles) or the P4.
  - Tile speed, PSRAM headroom and touch on the zoom buttons are unknown.
  - Hardware check step 11 in `docs/firmware-runtime.md`.
- **No tiles offline after a reboot** (they aren't stored on flash). Tiles already loaded stay while the server is down.
- **Chart formats:** only raster PNG/JPEG charts at 256 px. Vector (`pbf`) and WebP are refused, and so are servers reachable only over SSL.
- **Anchor watch only shows.** Setting, raising and changing the radius stay in the anchor alarm plugin.
- **North-up only.**
- **ESPTiles has no LICENSE file** (its README says MIT). The port credits it in `chart.cpp`.
- **`firmware/esphelm_sdl_1280.yaml`** appeared during this phase. It isn't mine, so I left it untracked.

## Next
Phase 6: hardening.
