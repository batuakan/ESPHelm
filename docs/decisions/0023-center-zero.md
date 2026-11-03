# ADR-0023: Centre-zero gauges and bars

Status: **Accepted** (2026-11-04)

## Context
You asked for a centre-zero indicator, for values that swing either side of zero: rudder angle, heel, rate of turn, battery current (charging or discharging), trim.
- **What already worked:** a gauge or bar accepted a range like −35 to 35.
- **What was missing:** the bar filled from `min`, the gauge had only a needle, there was no zero mark, and nothing said which side the value was on.

You chose an option on the existing gauge and bar, not a new tile. You also chose sides set per tile: port/starboard or plus/minus.

## Decision
- **Two optional fields on `gauge` and `bar`:**
  - **`centerZero: true`:** centres the scale on zero and fills from zero to the value. It needs `min < 0 < max`, else `INVALID_RANGE` on `/min`.
  - **`sides`:** `portStarboard` (the default) or `plusMinus`. Without `centerZero` it has no effect.
    - **Not an error:** a cross-field rule would need a semantic code, and `INVALID_VALUE` is structural, so the JSON Schema and the validator would disagree.
    - **Editor:** it offers `sides` only when *Centre zero* is on.
- **The scale is symmetric,** from −M to M with M = max(|min|, |max|).
  - **Zero is always in the middle,** at 12 o'clock on the gauge.
  - **`min` and `max` still clamp the value** and bound the zones.
  - **Example:** a battery current of −50…20 is drawn −50…50, and its needle stops at 20.
- **The sides:**
  - **portStarboard:** the value shows as a magnitude and a side letter ("12 ° P"). The fill is red to port and green to starboard, the wind rose's colours. P and S mark the ends.
  - **plusMinus:** signed ("+8.2 A"). The fill is the accent colour, and the ends are "−" and "+". A vertical bar has positive up.
  - **Zero:** a value that rounds to zero has no side or sign.
  - **Night:** everything is red, so the letter or sign tells the sides apart. The port red is bright and the starboard red dim.
- **Shared text:** `centerZeroSpan`, `centerZeroText` and `centerZeroTick` live in `packages/schema/src/centerZero.ts`. `esphelm_center_zero.h` mirrors them, and `fixtures/center-zero.cases.json` is checked by a TS test and a g++ test.
  - **Rounding:** both round halves up with floor(x + 0.5), because `toFixed` and `printf` disagree on ties such as 12.5.
- **Drawing:**
  - **Gauge:** an `lv_arc` in symmetrical mode over the ring for the fill, a zero tick, and P and S in the top corners of its square, where no needle or value reaches. `arc` is now in `LVGL_FEATURES`.
  - **Bar:** LVGL's symmetrical bar mode, a zero line and the end letters. A matching zone's colour wins over the side's.
  - **Stale:** a stale value draws no fill; the needle and the "--" text are muted.
- **Angles:** the `deg` unit wraps to 0–360, so −12° would read 348. Checking *Centre zero* in the editor switches `deg` to `deg180` (−180…180).
- **Older firmware** ignores both fields and draws a plain gauge or bar. That's readable, so there's no hello flag for it.

## Consequences
- **Memory:** the gauge gains one arc object and two labels; the bar gains a line and two labels. Nothing is allocated per value.
- **Build cost** (against `main`): flash +9.8 KB on the P4 (3,328,530 → 3,338,324 B) and +10.0 KB on the C3 (1,443,412 → 1,453,392 B, 78.7 → 79.2 %), most of it LVGL's arc widget, new to the build; static RAM unchanged.
- **Asymmetric ranges look lopsided on purpose:** −50…20 leaves the 20…50 part of the scale empty, so the zero stays in the middle where the eye expects it.
