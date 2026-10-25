# ADR-0008: Editor architecture

Status: **Accepted** (Phase 4, 2026-10-25)

## Context
The editor must be easy on a phone at sea and in the cockpit at night. It must reject everything the display would reject, and be served by SignalK without extra infrastructure (CLAUDE.md §6).

Your decisions:
- One layout per display.
- My own Pointer Events drag and drop, not a dnd library.

## Decision
- **Packaging:** React 19 + Vite in `packages/editor`, built into `packages/plugin/public/`. The plugin package carries the `signalk-webapp` keyword, so signalk-server serves it at `/signalk-esphelm/` with no second package to install. It reuses the SignalK admin login cookie; there's no auth of its own.
- **Same contract code everywhere:** the editor imports `@esphelm/schema` (bundled from source) and runs `validateLayout` on every change. The validator, unit table and formatting rules are the same ones the plugin and firmware follow, so "No problems" in the editor means the display will accept the layout.
- **Pure layout operations** (`layoutOps.ts`): add, move, resize, remove and grid changes are pure functions that never create overlaps or out-of-grid tiles. Shrinking the grid is the exception: it leaves tiles for the validator to flag. React components only wire pointer gestures to them.
- **Drag and drop** uses Pointer Events with `touch-action: none` on tiles. The cell is derived from the grid's bounding box, so the same code serves mouse, touch and pen.
- **Preview** is HTML styled like the firmware renderer, with live values from one SignalK stream (unsubscribe-all + subscribe, as on the device). SDL-rendered previews stay a later option (open question 7).
- **Path picker** data comes from the plugin (`GET /api/paths`: server paths + `meta.units` + latest value). Fitting units come from `units.json`'s new per-quantity `signalk` units string.

## Consequences
- The bundle is about 440 KB (≈134 KB gzipped), mostly React, Ajv and TypeBox. That's fine on a boat LAN.
- Validation runs client-side, so the plugin's 400/409 answers are a second line of defence, not the primary UX.
- No keyboard drag and drop yet. Tiles can be added by click and edited through the drawer, but moving them needs a pointer.
