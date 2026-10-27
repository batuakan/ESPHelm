# ADR-0017: Tile text follows the tile size

Status: **Accepted** (2026-10-27)

## Context
Every value tile drew its number in one fixed font (96 px on the P4, 64 px on the default build), whatever the tile's size. A full-width tile looked empty, and a narrow one overflowed ("11.50" ran past the edges). ESPHome compiles fonts as bitmaps at fixed sizes, so LVGL can't scale them freely at runtime.

The alternatives were rejected:
- **Runtime TrueType (`tiny_ttf`):** costs RAM for a glyph cache, slows the first draw, and is too heavy for the C3 floor.
- **LVGL transforms:** blurry, and need an off-screen buffer per label.

## Decision
- **A font ladder.** The firmware compiles several sizes of the one font (Roboto) and sorts them by line height:
  - `fonts.value`, `fonts.label` and `fonts.small`
  - any number of `fonts.extra`
  - `firmware/fonts.yaml` adds `medium` and `huge`
- **The fit rule** (`TEXT_FIT` in `packages/schema/src/tiles.ts`, generated into `esphelm_sizes.h`). A value tile's number gets the largest font in which:
  - its sample text fits the content width; the sample is `"88"` plus the tile's decimals (`88.8` with the default one decimal)
  - its digits, plus the caption line above and the unit line below (when the tile has them), fit the height
- **Caption and unit** take the largest font at most 40 % of the number's line height, never smaller than the smallest font.
- **Values wider than the sample** step the number down one size at a time until they fit; examples are an RPM of "2400", a heading of "241", or a text value.
  - They never step back up until the page is laid out again.
  - At the smallest size, the text is cut off with dots.
  - Text no longer than the sample isn't measured, so ordinary value changes never re-lay out a tile.
- **When it's chosen:** in `layout_done()`, which runs again when the alarm banner resizes the page.
- **Other tiles** use the same helper (`fit_font`) for their main text, each in its own text box:
  - **gauge:** the centre value, in the open bottom of the arc (0.7 d × d/4)
  - **bar:** the value, between the caption and the bar, or beside a vertical bar
  - **autopilot:** the state; with buttons, at most the value font in a third of the height
  - **position:** its two lines
- **Not changed:**
  - the switch caption
  - the wind rose, which keeps its own pixel tiers (ADR-0010)
  - the alarm banner, footer and chart page
- **Hello** reports `fontLineHeights`, so the editor previews the same sizes.
  - The editor estimates widths from Roboto's proportions (`textFit.ts`) and draws value tiles in the same Roboto file, so its choice matches the device's in practice.
  - The device always measures real glyphs.
- **Within schema v1:** the layout format doesn't change, and `fontLineHeights` is optional.
  - The plugin's hello validation rejects unknown fields, so update the plugin before flashing firmware that sends it.

## Consequences
- **Ladders and flash cost:**

  | Board | Ladder (px) | Flash | RAM |
  |---|---|---|---|
  | P4 and the 720 SDL build | 28 / 42 / 64 / 96 / 144 | +386 KB (2.68 → 3.06 MB of 16.5 MB) | +280 B |
  | default 480 build | 22 / 32 / 48 / 64 / 96 | | |
  | C3 | 14 / 20 / 28 / 40 / 56 | 69.2 → 73.1 % | +280 B |

- **The sample is a compromise.** Two digits suits most speeds, depths, voltages and temperatures. Headings, percentages and RPM step down once when the first value arrives, so a tile's number can shrink once right after the page appears.
- **A tile's font can stay one size too small.** After a value like 105 m, the depth stays smaller until the layout is applied again; growing back on every shorter value would make the text jump.
- **Two decimals make the number smaller.** A tile with two decimals has a wider sample, so its number is smaller than a one-decimal tile of the same size.
- Many SDL goldens changed (bigger numbers in roomy tiles, smaller in narrow ones). Two were added: `32-value-sizes` and `720-04-value-sizes`.
