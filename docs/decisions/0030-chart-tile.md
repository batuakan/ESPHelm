# ADR-0030: The chart becomes a tile, with one shared store of map tiles

Status: **Accepted** (2026-11-08). Supersedes ADR-0012's page kind and per-page buffer.

## Context
- **A page only:** the chart was a page kind (ADR-0012), so it couldn't sit beside a wind rose or depth, the layout people want on a helm display.
- **Memory per chart:** each chart pasted 5×5 map tiles of 256 px into its own 1280×1280 RGB565 picture, 3.2 MB of PSRAM. Two charts would have cost two pictures. The Guition S3 has 8 MB of PSRAM in all.
- **Most tiles are shared:** every chart is centred on the vessel. Charts of the same chart and zoom need the same map tiles, and a small one needs only the middle ones of a big one.

## Decision
**A `chart` tile:** the page's fields (`chart`, `zoom`, `anchor`, `config` paths) on a tile with the usual placement.
- **The page kind goes,** like the wind rose page in Phase 5b (ADR-0010).
  - `migrateLayout` turns a stored chart page into a 1×1 grid page (same id and title) with one chart tile (`<page id>-chart`). The plugin runs it on load and the editor on import.
  - The validator and the firmware answer the old shape with `UNKNOWN_PAGE_KIND`.
  - The schema stays v1, under the same pre-release exception as 5b.
- **"+ → Chart page"** in the editor now makes that 1×1 page, and the tile library has a Chart tile (2×2 where it fits).

**One store of map tiles** (`ChartTileStore`, `chart_store.cpp`, owned by the runtime):
- **Slots:** 256 px RGB565 tiles in PSRAM, keyed by chart, zoom and tile.
- **Budget:** 40 % of the free PSRAM when the first tile is needed, between 16 and 48 tiles (2–6 MB). Memory is allocated per tile as it arrives and reused, so a small chart doesn't hold the whole budget.
- **Wanting:** each chart tells the store every tick which tiles cover its view, nearest to the vessel first.
  - A tile wanted in the last second is never evicted.
  - When the budget is full, the least recently wanted other tile makes room.
  - If every tile is on screen, nothing more is fetched and the edges stay blank. That happens only with several large charts at different zooms on a small budget.
- **Fetching:** the store is the only user of the tile worker, one tile at a time, the most wanted across all charts first. The checks are unchanged: exactly 131,072 bytes, 404 means no tile there, other failures are retried after 30 s.
- **Lifetime:** tiles are kept across page changes while the layout has charts, so a chart page you come back to draws at once. They are freed when a layout without charts is applied.
- **Drawing:** each chart draws the stored tiles that cover its cell in its own draw callback (night recolour per tile), then its overlay. There is no picture per chart, so recentring is just drawing at new offsets. The old buffer shifting (`recenter_`) is gone.

**Small tiles** (`CHART_FIT`, shared with the editor's size hint):
- **From 200 px** on the shorter side: zoom buttons. Each chart keeps its own zoom.
- **From 260 px:** the position line.
- **Below 200 px:** an anchor alarm frames the tile in red instead of the banner. The alarm banner above the page (ADR-0014) names it.

## Consequences
- **Memory:** a fixed budget whatever the number of chart tiles, instead of 3.2 MB per chart. One full-screen chart at 720×720 needs up to 16 tiles (2 MB), against 3.2 MB before.
- **Drawing cost:** up to 16 (720×720) or 30 (1280×800) image draws per refresh instead of one big image, the same pixels from PSRAM. Checked on the desktop; the P4 check is hardware step 28.
- **Offline after an update:** a display updated to this firmware refuses an old cached chart layout (unknown page kind). It shows its built-in page until the plugin serves the migrated layout, which gets a new ETag when the plugin migrates it.
- **Unchanged:** PSRAM only (`chart` in `hello.widgets`), north up, the plugin's tile endpoint, and no tiles on flash.
