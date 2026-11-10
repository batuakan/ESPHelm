# ADR-0032: Engine tile

Status: **Accepted** (2026-11-09)

## Context
- **The legacy engine screen** (ESPHelmv1 `modules/applications/engine.yaml`) was one picture: a large RPM arc with oil pressure and fuel level inside it and the coolant temperature at the bottom.
- **The runtime's port** (the `engine` template) was three separate tiles: an RPM gauge, a coolant gauge and an oil bar. It used three tiles' worth of space and looked nothing like the original.
- **No images:** the runtime has no image assets, and its text is limited to ASCII and °.

## Decision
**A new tile type, `engine`.**
- **The RPM is the tile's own fields:** DataItem, `min`, `max`, `zones`, as on a gauge, without centre zero. So the server's zones (ADR-0020), path replacement and the firmware's one-path-per-tile zone handling work for it unchanged.
- **Three free slots, `left`, `right` and `bottom`:** each a DataItem with its own `min`, `max`, `zones` and an `icon`. Any value can go in any slot; a new tile starts with oil, fuel and coolant, the legacy screen's values.
- **Four corner values, `topLeft`, `topRight`, `bottomLeft`, `bottomRight`** (added 2026-11-10): plain DataItems in the tile's corners, as on a wind rose, for numbers the dials don't show (engine hours, alternator voltage, exhaust, fuel rate). The firmware's corner code moved out of the wind rose into `CornerValues` (`corner_values.cpp`), which both tiles use. Each shows with the slots and only where it clears the drawing: outside the circle of radius R, or, since the RPM arc is open at the bottom, a bottom corner below the arc's ends (0.52 R) and outside the bottom gauge (0.9 R). The editor applies the same rule with the display's two smallest fonts.

**Geometry, defined once in `packages/schema/src/engine.ts`:**
- **The RPM arc:** 240° from lower left over the top to lower right.
- **`left` and `right`:** 90° arcs inside it, both rising upward.
- **`bottom`:** an 80° arc in the opening.
- **RPM ticks:** the smallest 1/2/5 × 10ⁿ step with at most 8 intervals, labelled; medium and minor ticks between them, minor only where there's room. Labelled in hundreds with "x100" from 1000.
- **Zones** are a band outside the ticks; ticks inside an alarm zone are red. Needles are red wedges.

**Icons are SVG paths, filled on the display, not images:**
- **The set:** oil can, fuel pump, thermometer and battery: the ESPHelmv1 assets (`oil.svg`, `fuel.svg`, `engine_temperature.svg`, `battery.svg`), which are Material Design Icons by Pictogrammers (Apache License 2.0, credited in the README). Their path data is kept in `engine.ts`.
- **One shape for both sides:** `svgPath.ts` flattens the path data to polygons (curves and arcs cut into segments), fitted to a 0..1 box with the aspect kept. These polygons are generated into the firmware and drawn by the editor, both filled with the nonzero rule.
- **Drawing on the display:** at layout time each icon is filled once into an A8 mask the size it is shown (`esphelm_icon_raster.h`: 4 sub-scanlines per row, exact coverage along each span, so the edges are antialiased). It is drawn as an image in the theme's colour (red at night, muted when stale), so a colour change needs no new mask.
- **Why not images:** one bitmap per size would cost flash and still be scaled; LVGL's vector graphics need ThorVG, too heavy for the C3. Nothing is added to the board YAMLs.
- **Without an icon,** a slot shows its label.

**One source for both sides:**
- **Generated:** the arcs, radii and icons are generated into the firmware's `esphelm_engine_shapes.h`.
- **Mirrored:** `engineScale()` and `engineAngle()` are mirrored by `esphelm_engine.h`, and `fixtures/engine.cases.json` proves the two agree.

**Size tiers (`ENGINE_FIT`), by the shorter side:**
- the slots from 260 px;
- labels from 160 px;
- below that, the RPM arc alone.

**Drawing in the firmware:**
- **One object** drawn in a draw callback, like the wind rose and heading tape.
- **Values:** a value change only invalidates it; four throttled bindings decide when.

## Consequences
- **Schema:** an additive tile type, so it stays v1. Displays with older firmware don't list `engine` in `hello.widgets`, and the plugin refuses layouts using it for them (`UNSUPPORTED_WIDGET`).
- **The `engine` template** becomes one engine tile. The 720 templates keep their separate tiles.
- **Memory:**
  - the RPM ticks are worked out at layout time (up to 81 ticks, about 1.3 KB per tile), plus four bindings and the slots' zones;
  - each icon's mask is its side squared in bytes (0.17 R: about 3.7 KB at a full 720 tile, 1.7 KB at 480);
  - the polygons are about 5.5 KB of flash for the four icons;
  - nothing is allocated per value update.
- **Not done:**
  - zones from the server for the slots (the zone handling is one path per tile);
  - a tap for a history graph;
  - digital readouts of the gauges themselves (a corner value or a value tile does that);
  - more icons.
