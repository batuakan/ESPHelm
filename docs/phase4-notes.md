# Phase 4 notes: editor MVP

Status: **done, pending your review** · 2026-10-25

## What exists now
- **`packages/editor`:** React 19 + Vite 8 editor, built into `packages/plugin/public/` and served by SignalK at `/signalk-esphelm/`. Usage: `docs/editor.md`; design: ADR-0008.
  - Display list with **Adopt**; one layout per display, created on first save.
  - First grid page:
    - grid size
    - add tiles by click or **drag from the library**
    - **drag to move**, **corner to resize**, with snap previews and overlap checks (own Pointer Events code: mouse and touch)
  - Tile drawer:
    - **path picker** (search with current value and SI units)
    - units filtered by the path's quantity, with a sensible default
    - decimals, label (ASCII + `°` checked live), stale timeout, delete
  - Live preview values over one SignalK stream, converted like the display.
  - Problems list from `validateLayout`; **Save & send** is disabled while there are problems.
  - Themes: Day / Dark / Night (red on black). Phone layout with a bottom-sheet drawer.
- **Schema** (additive): `units.json` quantities name their SignalK `meta.units`; `quantityForSignalKUnits()` / `unitsForSignalKUnits()`.
- **Plugin:** `GET /plugins/esphelm/api/paths` for the path picker. The package is also a `signalk-webapp` (`signalk.displayName: "ESPHelm"`).
- **Tests:**
  - `packages/editor/test/` (layout ops, formatting, API errors, component tests in jsdom)
  - `packages/editor/e2e/e2e_editor.ts` (`npm run e2e:editor`, real Chrome via playwright-core)
  - the plugin `/api/paths` route test
- **Shared harness:** `sk-harness.ts` gained a `sampleData` option (NMEA 0183 sample feed).

## Verified
- `npm test`: 12 files, 341 tests. `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm run e2e:editor` (signalk-server 2.17.2, Google Chrome headless): 12/12 checks.
  - login hint, adopt
  - path picker selects kn, a live value is shown converted
  - real mouse drag from the library, and corner resize to two rows
  - invalid label blocks Save & send
  - Save & send: the display's `GET layout` returns exactly the edited tiles, and the version delta carries the new ETag
  - no browser console errors
  - phone viewport with touch opens the drawer

  Screenshots (desktop day and night, phone dark) reviewed by eye. Glyph icons that render poorly were replaced by inline SVG after the first review.
- No regressions: `npm run e2e -w signalk-esphelm` and `npm run e2e:sdl` (goldens) still pass.

## Not verified / gaps
- **The optional single run of editor → SDL firmware wasn't built.** Each half is proven against the same plugin: the editor test checks what the display downloads, and the firmware test checks it renders what the plugin serves.
- Real phones, Safari and Firefox: only Chrome with an emulated phone was tested.
- Keyboard-only moving of tiles.
- Multi-page editing, wind-rose slots, and settings for gauge/bar/switch (only `value` is rendered by the firmware).
- The bundle is ~440 KB (134 KB gzipped).

## Next (Phase 5)
Port the existing apps to widgets: wind, engine, energy, grid, then chart/anchor, autopilot, switchboard. That needs firmware renderers for `gauge`/`bar`/`switch`/`wind_rose` plus editor support for their settings and slots.
