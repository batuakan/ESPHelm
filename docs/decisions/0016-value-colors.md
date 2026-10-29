# ADR-0016: Colours on value tiles

Status: **Accepted** (2026-10-26)

## Context
You asked for colours on value tiles: a fixed colour per tile, and colour by value (thresholds, like a gauge's zones). Two existing rules constrain this:
- the theme supplies colours; layouts never carry hex
- the night theme is red only, to keep night vision

## Decision
- **Fixed colour:** `color` is one of `blue`, `green`, `yellow`, `orange`, `red`, `purple`, never a hex code. The theme maps each name to a colour.
  - By day, six distinct colours, dark enough for the light grey tile in sunlight.
  - At night, all six are the night text red. Hue at night would cost night vision.
- **Colour by value:** `zones` on a value tile are `{ from?, to?, state }` in display units.
  - A value tile has no `min`/`max`, so either end may be left open, e.g. `{ to: 2, state: "alarm" }` means "2 or less". At least one end is required; `from` must be below `to` when both are given (`INVALID_ZONE`).
  - Matching is the same as gauge and bar zones: both ends included, the last matching zone wins. It is defined once in `packages/schema/src/valueZones.ts` and mirrored in `esphelm_value_zones.h`. The shared cases in `fixtures/value-zones.cases.json` run against both, the C++ side through g++.
  - The device stores a missing end as ±infinity, since JSON can't express infinity.
- **Which colour the number gets** (caption and unit stay muted):
  1. stale or no value: muted
  2. a matching zone: the theme's zone colour. At night a `normal` zone uses the text colour, because the dim "normal" shade would look stale.
  3. otherwise the fixed colour
  4. otherwise the theme's text colour
- **Within schema v1:** both fields are optional. Older firmware ignores them, so it shows the value in the normal colour, which is safe.

## Consequences
- At night the fixed colours disappear, and the zones differ only in shade: warn is a darker orange-red, while alarm and emergency are only slightly brighter than normal text. A value tile at night can't say much through colour.
- The number is recoloured only in the widget's existing throttled redraw, so there is no extra cost on value updates. Memory: one colour byte and the zone list per tile (24 bytes per zone).
- The editor preview uses the same matching and copies the display's colours by hand into CSS variables (like the zone colours before it).
