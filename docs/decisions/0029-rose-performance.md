# ADR-0029: Performance graphics on the wind rose

Status: **Accepted** (2026-11-08)

## Context
- **What sailors use:** steering upwind or downwind, the questions are "am I at the right angle?" and "can I lay the mark yet?". Instrument displays answer them graphically, with laylines and the waypoint drawn on the wind display.
- **Numbers are already possible:** VMG, target speed and polar speed ratio fit in the rose's slots as ordinary paths.
- **What the rose lacked:** graphics. Its close-hauled sectors are fixed at 20–60° on each side.
- **Where the angles come from:** SignalK has `performance.beatAngle`, `performance.gybeAngle` and `performance.targetAngle`. A polar plugin fills them in; many boats run none.

## Decision
Three optional graphics on the `wind_rose` tile, each turned on in its config (`showLaylines`, `showWaypoint`, `showTarget`; absent = off, so existing layouts are unchanged). All are drawn on the rose's marker overlay under the A and T markers, in every size tier.

**Angles:**
- The rose is fixed to the bow and its angles are clockwise from it.
- TWA = true wind direction − heading, in (−180, 180], positive with the wind from starboard.
- The geometry is defined once, in `packages/schema/src/windRose.ts`. `esphelm_wind_rose.h` mirrors it, and `fixtures/wind-rose.cases.json` proves the two agree.

**Laylines:**
- **What's drawn:** the heading on each tack at the tack angle, as a line from the edge of the centre values to the ring.
  - The starboard-tack heading, TWA − angle, is green.
  - The port-tack heading, TWA + angle, is red.
  - The colours follow the tack the line belongs to, not the side of the rose it lands on.
- **Reading it:** sailing at the angle, your own tack's line lies on the bow, and the other shows where you'd point after a tack or gybe.
- **Upwind or downwind:** the beat angle while |TWA| < 90, the gybe angle otherwise. On the beam counts as downwind. The rose switches by itself; there is no mode to set.
- **The angle used:**
  - SignalK's angle (`beatAngle` / `gybeAngle`, any sign, by its size) while it is fresh and plausible: beat 20–80°, gybe 100–175° (`WIND_ROSE_TACK`, generated into `esphelm_sizes.h`).
  - Otherwise the tile's `fixedBeat` / `fixedGybe` (absent: 45° / 150°).
  - So laylines work without a polar plugin, and a bad value from one can't draw nonsense.

**Waypoint:** a W triangle on the ring at bearing − heading, with the letter and colour of the heading tape's waypoint marker (ADR-0022).
- **Default path:** `navigation.course.calcValues.bearingTrue`.
- **Magnetic headings:** a rose with a magnetic heading needs a magnetic bearing, or W is off by the variation. The editor warns about the mix, as on the tape.

**Target angle:** a bar across the ring at the polar's `targetAngle`, on the side the wind comes from (starboard when dead ahead or astern), in the T colour.
- **Reading it:** T forward of the bar means pinching (or sailing too low downwind); aft of it means footing.
- **No fallback:** without a polar there's no target, and the fixed angle is already shown by the laylines.

**Stale data:** each graphic is drawn only while every value it uses is fresh. Laylines and the bar need the true wind direction and the heading; W needs the bearing and the heading. On a boat, stale guidance is worse than none. The A and T markers keep their muted stale look, as before.

**Subscriptions:** the rose subscribes to the extra paths only for the graphics that are on.

## Consequences
- **Additive:** the schema stays v1. Older firmware ignores the new config keys (its parser skips unknown ones), so a layout with laylines shows a plain rose there.
- **Memory:** four more bindings per rose (about 4 × 60 B plus path strings), no LVGL objects, nothing allocated per update. The overlay already redraws when a wind value changes.
- **Not done:**
  - laylines drawn to the mark on a chart (the chart page has no route yet)
  - tide or leeway corrections
  - close-hauled sectors that follow the beat angle
  - a target speed graphic (target speed is a number for a slot)
