# ADR-0019: History per value, off by default; the wind rose; angles on the circle

Status: **Accepted** (2026-10-28). Changes parts of ADR-0018.

## Context
ADR-0018 records every value tile unless `history: false`. You asked for two things:
- **Choose what records:** each value is switched on or off in the editor, so values nobody looks at take no memory.
- **The wind rose too:** graphs for its values.

A wind rose shows up to ten values: seven slots, the apparent wind angle, the true wind direction and the heading. On a C3/C6, which records at most six values, one rose could use up the limit.

ADR-0018 also averaged every value as a plain number. For angles that's wrong: 350° and 10° make a point at 180°, and a heading graph jumped from top to bottom at north.

## Decision
- **Nothing records unless switched on.**
  - **Value tiles:** `history: true`. Absent now means off (it meant on in ADR-0018). The feature was unreleased, so the change costs nothing.
  - **Wind rose:** the new optional `history` field lists the values that record, e.g. `["center1", "apparentAngle"]`.
    - Allowed names (`ROSE_HISTORY_KEYS`): the seven slot names, then `apparentAngle`, `trueDirection` and `heading`.
    - An unknown or repeated name is `INVALID_VALUE`.
    - A name whose slot is empty records nothing; it isn't an error.
    - Within schema v1. Older firmware ignores the field.
- **The limits count values, not tiles:** `HISTORY.maxValuesPsram` (48) and `maxValuesNoPsram` (6). `historySeries(layout)` and `historyCount(layout)` list what a layout records, in the same order as the device. When the limit is reached, the later values don't record, and the display logs them.
- **Ids:** a rose value records under `"<tile id>/<name>"`. A tile id can't contain `/`, so the two kinds of id never clash.
- **The popup:**
  - A tap anywhere on a rose that records opens it on the rose's first recorded value.
  - One button per recorded value sits under the header: the slot's label, else "Centre 1" etc.; "AWA", "TWD" and "HDG" for the angles (`ROSE_HISTORY_TITLES`, the same table on both sides).
  - Test hook: `@history <name>`.
- **The mark:** the rose's sparkline mark goes in a free bottom corner (left, else right). When both bottom corners show values, there's no mark, but the rose is still tappable.
- **Angles:** a unit with a wrap range (`deg`, `deg180`) records on the circle.
  - **A point's mean** is the circular mean of its values. Its min and max are how far the values went either side, so they may lie outside the range.
  - **The popup** draws a window around its circular mean (`unwrapAround`), so a line across north stays smooth. Its labels are printed back in the unit's range (e.g. 346, 0, 14; "min 349, max 12"). Zone bands are not drawn for angles.
  - **Shared cases:** `circularMean`/`unwrapAround` in `packages/schema/src/history.ts` and `circular_mean`/`unwrap_around` in `value_history.h` must reproduce `fixtures/history.cases.json`.
  - **Values that cancel out:** a point whose values cancel out (90 and 270) keeps its first value.
- **The editor:**
  - *Tap for history* on value tiles starts unchecked.
  - On the wind rose: a *Record history* checkbox in each filled slot, and a *History* section with the three angles.
  - Under each, a counter: "Recording N values in this layout", with a warning once the C3/C6 or the PSRAM limit is passed.
  - *Preview graph* has the same value buttons and draws angles the same way.
- **Starter templates:** a few values record: SOG and depth tiles; on the roses, AWS, depth and the apparent wind angle.

## Consequences
- **No history by default:** layouts without `history` record nothing, and their pages look as they did before ADR-0018. Sixteen SDL goldens went back to their pre-ADR-0018 images pixel for pixel.
- **Build cost:** flash about +12.5 KB on both boards, mostly double-precision `atan2`/`hypot` (P4 3.294 → 3.306 MB; C3 76.8 → 77.4 %). Static RAM is 80 B lower.
- **Per-value memory** is unchanged, plus 16 B of sums per window for angles.
- **A spread over 180°** (a heading spinning round within one window) still shows a jump. That's acceptable for 10-minute and 1-hour graphs.
- **The Wind starter's rose** fills all four corners, so it shows no mark.
