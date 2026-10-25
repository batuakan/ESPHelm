# ADR-0010: The wind rose is a tile; size is judged in pixels by the device

Status: **Accepted** (Phase 5b, 2026-10-25). Supersedes the full-page-widget part of ADR-0005.

## Context
ADR-0005 made the wind rose a page kind (`kind: "widget"`, `widget: "wind_rose"`) with named centre slots. On larger displays (720×720 and up) you want a rose next to other tiles, for example engine gauges, or several roses on one page. A page kind can't share the screen.

You decided:
- Drop the wind-rose page kind.
- Make the autopilot a tile too (later).
- Leave out "insert a template into a region"; ship denser starter layouts for large displays instead.

A minimum span in cells ("at least 2×2") can't express "big enough". Cell size depends on the grid and the screen: a full-screen rose is a 1×1 grid, and one cell of a 3×3 grid is 240 px on 720² but 130 px on 480².

## Decision
- **`wind_rose` is a tile type** with the same `config` and `slots` as the old page. `Page` is `GridPage` only. A page with `kind: "widget"` is rejected with `UNKNOWN_PAGE_KIND`, and `UNKNOWN_WIDGET` is retired. `kind` stays required so other page kinds (e.g. a full-page chart in 5d) can be added later.
- This **breaks v1 without a major bump**. You approved it because no released layouts or devices use the old shape. The plugin migrates layouts stored in its data dir on load (`migrateLayout`: each old page becomes a 1×1 grid page with one rose tile, ids kept or suffixed) and rewrites them once. The validator stays strict.
- **No minimum size in the schema.** The device measures the shorter side of the cell it got and picks a tier from `WIND_ROSE_FIT`:
  - **full** (≥ 260 px): tick labels, heading, slots
  - **compact** (≥ 150 px): no tick labels or heading; as many slots as fit
  - **pointers** (< 150 px)

  The numbers live in `packages/schema` and are generated into the firmware's `esphelm_sizes.h`. The editor shows the same tier as a hint, computed from the display's resolution and the runtime's grid geometry.
- Only rose tiles carry rose settings on the device (`std::shared_ptr<const RoseConfig>` on `Tile`), so value tiles don't grow on C3/C6.
- Chart/anchor stays full-page (5d): its tile cache is too heavy to repeat on a page.

## Consequences
- A full-screen rose costs one extra tile cell's padding compared with the old page; it now has the tile background like every other tile.
- Firmware 0.2.0, which parsed the old page kind, rejects new rose layouts with `UNKNOWN_TILE_TYPE` and keeps its last-known-good layout. Only test devices ran it.
- The editor's slot count in a compact rose is approximate, because the hello carries font names, not sizes.
- The autopilot tile (5c) follows the same pattern: a tile, with a size tier below which it shows status only, without controls.
