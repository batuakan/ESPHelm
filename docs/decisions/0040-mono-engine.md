# ADR-0040: The engine tile in the mono tile set

Status: **Proposed** (2026-11-16)

## Context
- **The mono tile set** (ADR-0035, ADR-0039) did not have the `engine` tile (ADR-0032): a layout for the Waveshare ESP32-S3-RLCD-4.2 with an engine page showed "not on this display".
- **The colour engine tile** is a large RPM arc with a labelled scale and zones in colour, three small gauges inside it with icons (oil, fuel, coolant), and four corner values. The arcs, radii, scale and icons are defined once for the firmware and the editor (`engine.ts`, `esphelm_engine.h`, `esphelm_engine_shapes.h`), in the core.
- **A 1-bit panel** has no colour and no grey.
- **A tile beside the page footer on a 400x300 display is only about 215 px**, which is less than the colour tile's 260 px for the small gauges, and too small for its tick labels (it asks for a font of 14 % of the radius and finds none).

## Decision
An `engine` tile in `esphelm_tiles_mono`: a file (`mono_engine.cpp`), a case in the factory and the name in `tile_types()`, as ADR-0035 prescribes. The schema, plugin and editor do not change.

- **Same data, same geometry.** The RPM is the tile's own value, `min`, `max` and zones; the three slots, the four corner values, the units, the redraw throttle and the stale tracking are the colour tile's. The geometry comes from the core, so the display and the editor draw the same arcs.
- **Zones in the ink only:** a normal stretch is a thin line, a warn zone is a dashed band and an alarm or emergency zone a solid heavy band, as the mono tiles show warn as a heavy frame and alarm as an inverted tile. A tick in an alarm zone is a pixel heavier. On the small gauges a normal stretch is the track alone.
- **Needles are black wedges.** A gauge whose value has gone stale loses its needle, as there is no grey to dim it.
- **Icons are the core's** (`esphelm_icon_raster.h`, A8 masks drawn in the ink), but at least 24 px a side: at the colour tile's 17 % of the radius they would be about 18 px here, too small to tell a pump from a can at 1 bit.
- **The text** (tick numbers, unit, labels of slots without an icon) is upright and uses the largest font up to 20 % of the radius, which on this display is the smallest font.
- **Size tiers:** the tick numbers from 160 px (as the colour tile), the small gauges and the corner values from 180 px (`SLOTS_FROM`; the colour tile needs 260). The editor's size hint uses the colour thresholds, so for a mono display it understates what is drawn. A mono variant of `ENGINE_FIT` in the schema would fix that; it is left out, as the schema is the contract (CLAUDE.md, rule 1).
- **No frame** around the tile, as on the mono wind rose.
- **The corner values** are the mono set's `CornerValues` (`mono_corner_values.h`), shared with the wind rose.

## Consequences
- **A mono display can show an engine page.** Its layout needs nothing special.
- **Not drawn:** the history popup (no touch), and zones from the server for the small gauges (the colour tile does not either).
- **The editor's size hint is conservative** for a mono display.
- **Memory:** the three icon masks are 24x24 bytes or more each; nothing is allocated per value update.
- **Looks to be judged on the device.** The drawing was agreed on a mock-up; how the dashes, the icons and the labels come out at 1 bit is checked on the Waveshare ESP32-S3-RLCD-4.2. The SDL end-to-end test has no golden image for it yet.
