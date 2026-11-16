# ADR-0038: The wind rose in the mono tile set

Status: **Proposed** (2026-11-16)

## Context
- **The mono tile set has four tiles** (`value`, `bar`, `clock`, `position`, ADR-0035). A layout for the Waveshare ESP32-S3-RLCD-4.2 could not hold a wind rose: the tile showed "not on this display".
- **The wind rose is the legacy wind page** (ADR-0010) and the tile a sailor most wants on a cockpit display. The colour rose draws it with colour (green and red sectors, orange and violet markers), grey for stale values and an overlay for the history popup.
- **A 1-bit panel with no touch** has no colour, no grey and no tap.

## Decision
A `wind_rose` tile in `esphelm_tiles_mono`, as ADR-0035 prescribes for a new tile type: a file (`mono_wind_rose.cpp`), a case in the factory and the name in `tile_types()`. The schema, the plugin and the editor do not change: a display lists `wind_rose` in `hello.widgets`, and the editor's tile library follows that list.

- **Same data, same mechanics.** The slots, the `config` keys, the units, the redraw throttle and the stale tracking are the colour rose's (`Binding`, `paths()`, `on_value()`, `tick()`). The layout of a rose does not depend on the display kind.
- **Drawn in the ink and the page colour only.**
  - The ring has ticks every 10 degrees from 180 px (every 30 below), longer ones at the quarters.
  - The close-hauled sectors (20 to 60 degrees each side) are blocks of 4 degrees: starboard solid, port outlined. Green and red are not needed to tell them apart.
  - The compass card is an ink band with the compass points in the page colour, turned by the heading. It has the eight points (N, NE, E, ...) from 180 px, else the four cardinals; sixteen would not fit a 1-bit display. The points are drawn as strokes (`label()` in `esphelm_rose_geometry.h`), not with a font and not with LVGL's scale as the colour rose does: on the device LVGL's rotated 1-bit text was readable at the quarter turns and broke into streaks at the diagonals (a first version used the scale).
  - The markers are triangles pointing at the card: A (apparent wind) solid, T (true wind) outlined, each with a page-coloured halo so it stands out from the band and the sectors. The letters are drawn as strokes (`esphelm_rose_geometry.h`), so they turn with the marker (their tops point away from the centre, like the card's letters) and stay sharp at 1 bit. A marker is at least 13 px wide on each side of its tip, so its letter reads on a rose of about 215 px.
  - The heading and up to three values in the middle, and the corner values outside the ring, as on the colour rose.
- **The size tiers differ from the colour rose's** (`WIND_ROSE_FIT`: full from 260 px, compact from 150). On the 400x300 display a rose beside the page footer is only about 215 px, so it would never reach the full tier. In the mono rose:
  - the heading in the middle stays with the full tier (from 260 px), so the three values can stay big;
  - the corner values come from the compact tier (150 px), each where its box clears the ring;
  - the finer ticks, the eight points and the marker letters come from 180 px (`DETAIL_FROM`).
  The editor's size hint uses the colour thresholds, so for a mono display it understates what the display draws. A mono variant of `WIND_ROSE_FIT` in the schema would fix that; it is left out here, as the schema is the contract (CLAUDE.md, rule 1).
- **The geometry is pure C++** in the core (`esphelm_rose_geometry.h`), with a g++ host test, as `esphelm_wind_rose.h` and `esphelm_mono.h` are.
- **No frame.** The other mono tiles are frames; the rose is the picture.
- **A stale marker is left out** rather than dimmed, as there is no grey. The values in the middle show `--` as on the colour rose.
- **Not in this version:** laylines, the target angle, the waypoint marker (the `showLaylines`, `showTarget` and `showWaypoint` keys are accepted and ignored) and the history popup (no touch).
- **The corner values are a copy** of the colour set's `CornerValues` (`mono_corner_values.h`), which uses the core's helpers only. The copy keeps the two tile sets independent and leaves the colour set untouched.

## Consequences
- **A mono display can show the rose.** Its layout needs nothing special.
- **Two copies of the corner values** (the colour set's and this one). Moving the class into the core would remove the copy, but changes the colour set and so needs its builds checked.
- **The editor's size hint is conservative** for a mono display (see above).
- **Not drawn yet:** the performance graphics. A layout that turns them on shows the rose without them on a mono display.
- **Looks to be judged on the device.** The drawing was agreed on a mock-up; how the compass letters and the strokes come out at 1 bit is checked on the Waveshare ESP32-S3-RLCD-4.2. The SDL end-to-end test has no golden image for it yet.
