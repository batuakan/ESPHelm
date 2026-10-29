# ADR-0012: Chart page and its tile pipeline

Status: **Accepted** (Phase 5d, 2026-10-25)

## Context
The legacy chart app showed map tiles around the vessel through your ESPTiles component, with the vessel, the anchor position and the anchor alarm radius. Its tiles came from your separate `SignalKRGB565Proxy` plugin, which turns the PNG tiles of SignalK's charts plugin into raw RGB565, because the display can't decode PNG or JPEG.

ESPTiles keeps a 5×5 grid of 256 px RGB565 tiles in one image buffer: 1280 × 1280 × 2 bytes, about 3.2 MB.

Your decisions:
- the ESPHelm plugin converts tiles itself, with small pure-JS decoders
- ESPTiles' code is ported into the runtime (ESPTiles itself unchanged)
- anchor watch is display only
- north-up only

## Decision
- **Page kind `chart`**: a SignalK chart id, `zoom` 1–20, `anchor` on/off, and the paths it follows (`CHART_DEFAULTS`). It's a full page; the footer stays.
- **Tile pipeline**: the device asks the plugin for `GET /signalk/v1/api/esphelm/tiles/<chart>/<z>/<x>/<y>` with its token. The plugin:
  1. looks the chart up in the SignalK resources API (whichever charts plugin the boat runs)
  2. fetches the tile from its `tilemapUrl` on the same server, forwarding the device's Authorization
  3. decodes it with pngjs or jpeg-js (MIT, BSD-3)
  4. returns 256×256 RGB565 little-endian with an ETag, keeping 64 tiles in an LRU

  Vector (`pbf`), WebP and other formats are refused with 415. The editor shows them but doesn't let you pick them. Everything stays on the boat's LAN unless a chart's own `tilemapUrl` points elsewhere.
- **Firmware**:
  - The ESPTiles grid and maths live in `chart.cpp`, and the buffer exists only while the chart page is shown.
  - Tiles go through a second HTTP worker, so they never delay layout updates. They are fetched one at a time, nearest first, and copied into the buffer on the main loop.
  - Anything but exactly 131,072 bytes is dropped.
  - The overlay (vessel, anchor marker, radius circle, alarm banner) is drawn, not imaged, so it scales with the display.
- **PSRAM only**: firmware lists `chart` in `hello.widgets` only when it has PSRAM, so the plugin refuses chart layouts for C3/C6 displays.
- **North-up**: the vessel symbol turns; the map doesn't, because rotating a 1280 px image on every heading change is too expensive.
- **Night**: the chart image is darkened and tinted red (an LVGL recolour), because daylight chart colours would ruin night vision.

## Consequences
- **No tiles without the server.** Tiles aren't stored on the device. Offline, the chart page keeps the tiles it already has in memory, but after a reboot it shows placeholders. Caching tiles in flash is a possible follow-up.
- **SSL-only servers:** the plugin fetches relative tile URLs over plain HTTP on localhost, so a server that only offers SSL isn't handled yet.
- **Anchor watch only shows.** Dropping, raising and setting the radius stay in the anchor alarm plugin or its app.
- **The SignalKRGB565Proxy plugin isn't needed** for ESPHelm displays any more. The legacy app still uses it.
