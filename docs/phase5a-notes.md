# Phase 5a notes: gauge, bar, switch, wind rose, multi-page with a footer

Status: **done, pending your review and the P4 hardware check** · 2026-10-25

Phase 5 is split: **5a** (this) ports the legacy wind, speeds, energy, engine and switchboard apps; **5b** autopilot; **5c** chart/anchor (ESPTiles). No schema change was needed: `gauge`, `bar`, `switch` and `wind_rose` were in schema v1 since Phase 1.

## What exists now
- **Starter layouts** `packages/schema/templates/{wind,grid,energy,engine,switchboard}.json`, exported as `TEMPLATES` from `@esphelm/schema`. Paths come from the legacy YAML. The switchboard uses `electrical.switches.<name>.state`, because the legacy one was unbound.
- **Firmware** (`esphelm_runtime` 0.2.0):
  - `widgets.cpp`: `value`, `gauge`, `bar`, `switch` tiles and the `wind_rose` page. Details and memory: `docs/firmware-runtime.md`.
  - **Multi-page with a footer** (`<` / `>` and "title n/m"), no swiping. Only the visible page is built and subscribed (ADR-0009).
  - **Switch tiles send a PUT**, show the pending state, and revert with `!` after 5 s without a confirming value.
  - `hello.widgets` = value, gauge, bar, switch, wind_rose.
  - SDL test hooks: `esphelm_page_request <n>`, `esphelm_tap_request <tile id>`.
- **Editor:**
  - page tabs (add grid / wind rose / starter page, rename, reorder, delete), "Templates" to start over from a starter layout, footer preview
  - gauge/bar/switch previews and settings (min/max, zones, orientation; switches list on/off paths first)
  - wind-rose preview with live pointers and clickable centre slots; rose source settings
  - problems on any page or slot jump to it
  - Usage: `docs/editor.md`.
- **Test harness:** `startSignalK({ putEcho: [paths] })` installs a tiny plugin that accepts PUTs on those paths and echoes them back as deltas.

## Verified
- `npm test`: 12 files, 366 tests (templates validated by TS and the C++ parser; layoutOps page/slot/template operations; editor component tests for wind-rose slots, page reorder, gauge zones, templates). `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm run e2e:sdl` (signalk-server 2.26.0): all checks, 10 goldens, reviewed by eye. Two runs in a row gave 0 changed pixels.
  - The Phase 3 single-page flow: goldens 01–04 unchanged, so no footer on one page.
  - Multi-page fixture: each page through the page hook, with live gauge/bar/needles.
  - Switch tap → PUT → echo → the server holds `true` and the switch shows on.
  - Stale values after the server stops; the cached multi-page layout after an offline reboot.
- `npm run e2e:editor` (Chrome headless): 16/16 checks. They cover a wind page from a template with a slot changed to depth (live pointer and value), a gauge with a zone on a new grid page, and reordering. The display downloads the three pages in the edited order, with no console errors. The phone slot drawer is also checked. Screenshots reviewed by eye.
- `npm run e2e -w signalk-esphelm`: passes.
- Compiles: `firmware/esphelm_p4.yaml` (RAM 93,708 B, flash 2.64 MB) and `firmware/esphelm_c3_compile_check.yaml` (RAM 107,760 B of 321,296 B; flash 65.9 %).
- The legacy configs were not touched.
- Memory per page on the host build: speeds (4 values) 7,136 B, energy 6,416 B, engine 6,544 B, wind rose 4,720 B, switchboard (8 switches) 20,992 B.

## Not verified / gaps
- **Hardware:** nothing in Phases 3–5a has run on the P4 yet. Checklist: `docs/firmware-runtime.md` → *Hardware check* (steps 7–9 are new: footer buttons, widget look at 720², switch PUT).
- **Switch PUT on a real boat:** a PUT needs a handler on the server (e.g. a digital-switching plugin). It was tested only against the echo test plugin. The firmware ignores the PUT response and trusts the value stream; a rejected PUT shows up as the 5 s revert.
- **C3/C6 runtime heap** is still unmeasured (no hardware). One 8-switch page is ~21 KB on the 64-bit host; expect less on the 32-bit ESP32.
- The editor's preview is an HTML/SVG approximation. Tick labels and exact proportions differ from the display (open question 7); the SDL goldens are the reference.
- The editor bundle is now ~463 KB (138 KB gzipped).
- Not built: swiping, remembering the page across reboots, keyboard reordering of tiles, copying tiles between pages.

## Next
- **5b:** autopilot. A new full-page widget with PUT actions (±1/±10, mode); needs a schema addition (`widget: "autopilot"`), firmware and editor.
- **5c:** chart/anchor with ESPTiles.
