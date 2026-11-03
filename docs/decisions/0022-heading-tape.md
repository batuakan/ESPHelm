# ADR-0022: Heading tape tile

Status: **Accepted** (2026-11-03)

## Context
You asked for a compass tile as a heading tape: a strip of compass ticks that scrolls with the heading under a fixed centre line. It's easier to read at the helm than a number. You wanted three markers on it: course over ground, the bearing to the next waypoint, and the autopilot target.

## Decision
- **A new tile type, `heading_tape`:**
  - **`label`:** a caption.
  - **`span`:** degrees across the tape, 30–180, default 90.
  - **`markers`:** a subset of `cog`, `bearing`, `target`. Absent: all three.
  - **`config`:** the four paths. Defaults: `navigation.headingTrue`, `navigation.courseOverGroundTrue`, `navigation.course.calcValues.bearingTrue`, `steering.autopilot.target`.
  - **`staleAfter`**
  - **No `unit` or `decimals`:** it's whole degrees. The number gets "T" or "M" from the heading path, as on the wind rose.
- **Shared geometry:** `tapeMarks()` and `tapeX()` in `packages/schema/src/headingTape.ts` decide the ticks, their labels and the marker positions. `esphelm_heading_tape.h` mirrors them, and `fixtures/heading-tape.cases.json` is checked by a TS test and a g++ test.
  - **Ticks:** every 30° major and labelled (N, E, S, W at the cardinal points), every 10° medium, every 5° minor.
  - **Density:** minor ticks only from 6 px apart, and 10° labels only from 40 px per 10° (`HEADING_TAPE_FIT`, in device pixels).
  - **Editor:** its preview draws the same ticks for the tile's width on the display.
- **Markers:**
  - **Shapes:** COG is a triangle under the tape ("C"), the waypoint bearing a diamond ("W"), the autopilot target a notch on the top edge ("A"). Shape and letter tell them apart, because at night every colour is red.
  - **Freshness:** a marker is drawn only while its value is fresh, so without a route or an autopilot those markers just don't appear.
  - **Off the tape:** a marker beyond the edge becomes an arrow at that edge, on the side of the shorter turn (`tapeX`), so a waypoint behind the boat still says which way to turn.
- **Drawing (`widget_heading_tape.cpp`):**
  - **Objects:** a caption, the heading number, and one tape object that draws its ticks, labels and markers in an `LV_EVENT_DRAW_MAIN` callback, as the chart page's overlay does. That's four LVGL objects whatever the span.
  - **Redraws:** the tape is invalidated when the heading or a marker moves by half a degree or more, at most every 250 ms. Nothing is allocated per value and nothing re-lays out.
- **Stale heading:** the number shows "--", and the tape stays where it was, muted, without markers.
- **True and magnetic aren't converted.** Each marker is drawn at its own value. A magnetic heading with true markers puts them off by the magnetic variation. Converting would need `navigation.magneticVariation` and rules for when it's missing, so it's left out. The editor warns when the heading and an enabled marker disagree, by their paths' names.

## Consequences
- **Memory:** four LVGL objects per tape; the tick list is built on the stack while drawing.
- **Build cost** (against `feat/graph-tile`): flash +7.1 KB on the P4 (3,321,402 → 3,328,530 B) and +7.5 KB on the C3 (1,435,932 → 1,443,412 B, 78.3 → 78.7 %); static RAM +112 B on both.
- **Drawing cost:** each redraw draws up to 37 ticks and 13 labels.
- **No tap action.** A tape doesn't record its values; a graph tile on the heading does.
