# Phase 5b notes: the wind rose becomes a tile

Status: **done, pending your review and the P4 hardware check** · 2026-10-25

Phase 5 is now split into four parts:
- 5a: tiles, multi-page with a footer, starter layouts
- 5b: this phase, the wind rose as a tile
- 5c: the autopilot tile
- 5d: chart/anchor (full page)

Design: ADR-0010.

## What changed
- **Schema** (breaking within v1, approved):
  - The `kind: "widget"` page is removed. `wind_rose` is a tile type with `config` and `slots`, and can share a page with other tiles.
  - `WIND_ROSE_FIT` size tiers: full ≥ 260 px, compact ≥ 150 px, else pointers only. They are shared with the firmware through the generated `esphelm_sizes.h`.
  - `migrateLayout()` converts old rose pages.
  - New fixtures; templates `sailing-720` and `wind-engine-720` for large displays.
- **Firmware 0.3.0:**
  - The rose is built per tile and picks its tier from the cell size. Slot values drop to the small font before slots are dropped.
  - Zone styles are kept per arc width, which fixes gauges and roses on one page overwriting each other's arc width.
  - Small gauges use the small font, and drop the unit below 160 px.
  - New `firmware/esphelm_sdl_720.yaml`.
- **Plugin:**
  - Stored layouts with the old page kind are migrated on load and rewritten once.
  - `/api/widgets` returns `tileSlots` instead of `pageWidgets`.
- **Editor:**
  - Wind rose in the tile library (2×2 where it fits).
  - "+ Wind rose page" adds a 1×1 grid with a rose.
  - The rose previews inside its tile at the tier the display will use, and tapping a slot opens it in the tile drawer.
  - Size hint per rose.
  - Large-display templates are listed first on 720 displays.
  - Fixed a 5a bug: the tile type class `tile-value` collided with the `.tile-value` text style and shrank value tiles in the editor preview.

## Verified
- `npm test`: 14 files, 397 tests.
  - TS and C++ validators agree on every fixture, including the new rose fixtures and the removed page kind.
  - `migrateLayout`.
  - `WIND_ROSE_FIT` matches the generated header.
  - Plugin store migration and the `/widgets` shape.
  - Editor `layoutOps`, `sizing`, and component tests (rose page, rose tile next to tiles, slot editing, size hints).
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm run e2e:sdl`: all checks, 13 goldens reviewed by eye; a second run matched with 0 changed pixels.
  - **480:** a Helm page with a 2×2 rose (compact, two slots), a 1×1 rose (pointers only) and engine tiles, live, stale and offline.
  - **720:** offline from a seeded cache. `rose-and-engine-720` shows a full rose with all three slots (small font) next to engine tiles, then a compact and a medium rose.
- `npm run e2e:editor` (Chrome): all checks.
  - a template wind page (hint "full", live pointer and slot value)
  - a rose tile next to a gauge
  - reordering, and the display downloads three pages
  - *Sailing (large display)* listed first and delivered exactly
  - phone slot tap
- `npm run e2e -w signalk-esphelm`: passes.
- Compiles:
  - P4 (RAM 94,156 B, flash 2.64 MB)
  - C3 compile check (RAM 108,200 B; flash 65.9 %)

## Not verified / gaps
- **Hardware:** nothing has run on the P4 yet (Phases 3–5b). The hardware check in `docs/firmware-runtime.md`, step 8, now includes the Sailing template.
- The editor's slot count in a compact rose is approximate: hello names fonts but doesn't give their sizes.
- At 480, a 2×2 rose in a 3×3 grid (≈250 px) is just under the full tier, so it shows only two slots. That's by design, but you may prefer a lower `full` threshold once you've seen it on the panel.
- Firmware 0.2.0 rejects rose layouts with `UNKNOWN_TILE_TYPE` and falls back to its last-known-good layout. Flash 0.3.0 before using roses.
- Two files in the repo root, `esphelm_cur.bin` and `esphelm_lkg.bin` (from a host-build run in the repo root on 2026-10-25 09:37), are not gitignored. I left them alone.

## Next
5c: the autopilot tile, with PUT actions (−10/−1/+1/+10, mode, with a confirm step to engage). Below a size tier it shows status only, without controls. It needs a schema addition, firmware and editor support.
