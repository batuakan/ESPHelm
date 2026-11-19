# ADR-0042: Gauge, heading tape and graph tiles in the mono tile set

Status: **Proposed** (2026-11-19)

## Context
- **What the mono tile set has:** value, bar, clock, position (ADR-0035), the wind rose (ADR-0039) and the engine (ADR-0040).
- **What a black-and-white display can't take:** a layout with a `gauge`, `heading_tape` or `graph`. The plugin refuses to send it (it goes by `hello.widgets`), and a cached one shows *Not on this display*.
- **Why the colour tiles don't carry over:**
  - **Gauge:** its zones are colour sections on an anti-aliased `lv_scale`, and the needle dims to grey when stale.
  - **Heading tape:** the markers are coloured, and the strip is set apart from the tile by a background of its own.
  - **Graph:** its zones are translucent bands behind the line.
- **What a 1-bit panel can do:** neither colour nor grey nor translucency, but dashes, heavy lines and an inverted tile.
- **Left out on purpose:**
  - `switch` and `autopilot`: they need touch, and the first mono board has none.
  - `alarms`: the banner and the BOOT button already cover it.
  - `chart`: RGB565 map tiles thresholded to 1 bit would be unreadable.

## Decision
Each of the three tiles gets its own file in `esphelm_tiles_mono` (`mono_gauge.cpp`, `mono_heading_tape.cpp`, `mono_graph.cpp`), a case in the factory and its name in `tile_types()`, as ADR-0035 prescribes. The schema, plugin and editor don't change.

- **The drawing helpers are shared.** The mono engine's arc, line, zone band, wedge and text helpers move to `mono_draw.h/.cpp`, and the engine, gauge and heading tape use them. The engine draws exactly as before: its goldens are unchanged.
- **Gauge:**
  - **Kept from the colour gauge:** the 270° scale, its 21 ticks (major every five) with five tick labels, centre zero (ADR-0023), and the small size below 160 px (no tick labels or unit, 11 ticks).
  - **Drawn in the ink**, in one draw callback:
    - **Zones** are bands along the scale, as on the engine: a thin line for normal, dashes for warn, a solid heavy band for alarm and emergency.
    - **The ticks** sit inside the widest band, so a solid band doesn't hide them.
    - **The needle** is a black wedge.
    - **Centre zero** is a solid band from zero to the value.
  - **The live value's zone also shows on the frame** (warn heavy, alarm inverted), as on a value or bar tile.
  - **Stale:** "--", with no needle and no fill.
- **Heading tape:**
  - **Kept from the colour tile:** its layout, its geometry (`esphelm_heading_tape.h`, shared with the editor) and its redraw throttle.
  - **The strip has a 2 px outline** in place of a background of its own.
  - **The markers are in the ink.** They already differ by shape and letter: COG a triangle, the waypoint bearing a diamond, the autopilot target a notch, beyond an edge an arrow. On a tape too short to give them a row of their own below the tick numbers, the letters are left out: in one colour a letter over a number reads as neither.
  - **Stale heading:** "--" over an empty strip. The colour tile keeps the strip, muted, but a 1-bit strip that keeps its ticks would look live.
- **Graph:**
  - **Kept from the colour tile:** the line, the header, and the axis labels from `GRAPH_AXIS_HEIGHT`.
  - **In the ink:** the line itself, and the grid lines, which are dashed.
  - **Zones:** a 6 px **ruler** beside the plot, with nothing for normal, dashes for warn and solid for alarm and emergency. There are no bands behind the line.
  - **The live value's zone shows on the frame.**
  - **No history popup** (no touch, ADR-0039). The line is drawn from the core's recording, as on the colour tile.

## Consequences
- **What a mono display can now show:** a helm page with a gauge, a heading tape and a graph.
- **Memory:** the gauge and the heading tape are a canvas object and up to four labels each. The graph is about 8 LVGL objects and a 480 B point buffer, as in colour. Nothing is allocated per value update.
- **The editor's preview** shows these tiles black on white but doesn't draw the warn dashes or the graph's ruler: the mono CSS turns zone colours black. This is the same compromise as for the engine.
- **The SDL e2e** checks the hello, a layout with all three, and two goldens: `mono-11-helm` (live) and `mono-12-helm-alarm` (the gauge in alarm, the graph in warn, a marker beyond the tape's edge). The fixture `mono-400.json` now uses a `switch` as its tile the mono set lacks.
- **Still to judge on the RLCD:** how the dashes, the tape's outline and the graph's thin line come out on the Waveshare ESP32-S3-RLCD-4.2.
