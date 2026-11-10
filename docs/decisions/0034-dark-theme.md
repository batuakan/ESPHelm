# ADR-0034: A dark theme for the displays

Status: **Accepted** (2026-11-10)

## Context
- **Today:** the displays have two themes (ADR-0015):
  - **Day:** a white page with dark text, for sunlight.
  - **Night:** red on black, which keeps night vision. Zones differ in brightness, not hue, and charts are tinted red.
- **The gap:** neither suits a dim cabin, or anyone who prefers a dark screen by day but wants the full colours: zones, the wind rose's red and green, the value tile colours.
- **The editor** already has a dark theme of its own (`packages/editor/src/styles.css`), separate from the display's.

## Decision
**A third layout theme, `dark`, that looks like the editor's dark theme.**
- `theme` is `day | dark | night`. It's an added value, so `LAYOUT_VERSION` stays 1.
- **The palette** (`colors_for()` in `widgets.cpp`, mirrored by `.display-frame[data-theme-preview='dark']` in the editor):
  - the editor's dark page `#0E141A`, panel `#17202A` as the tiles, text `#E5EBF1`, muted `#93A1AE`;
  - accent `#4A9EFF`;
  - zones in the editor's green, amber and red;
  - lighter shades of the six value tile colours and of the wind rose's colours, to read on the dark tile.

**Night keeps meaning red only.** The code had used "night" for two things, which are now separate helpers in `layout_model.h`:

| Helper | True for | What it controls |
|---|---|---|
| `red_only` | Night | a normal zone in the text colour; red-tinted charts |
| `dark_page` | Night and Dark | the zone bands of graphs and the history popup, drawn a little stronger |

Dark otherwise behaves as Day, with these specifics:
- **The alarm banner:** a band in the alarm's colour, with text in the dark page colour, because the bands are light shades.
- **QR codes:** black on white. Cameras read inverted codes badly.

**Auto swaps between Night and the day-side theme.**
- **The day-side theme:**
  - the last Day or Dark picked on the display;
  - otherwise the layout's theme;
  - Day when the layout's theme is Night.
- **With `autoTheme: sun`:** Night at dusk and night, the day-side theme otherwise.
- **The footer's theme button:** toggles Night and the day-side theme.
- **The panel** has Day, Dark, Night and Auto (two rows of two where four don't fit).
  - Day or Dark also becomes the day side.
  - Night holds until the next sun change, as before.
  - Auto clears the pick and keeps the day side.
- **Saving:** the day side is saved with the other display choices (`ds=` in the `v=3` record; `v=1` and `v=2` still read). It's dropped, like the theme pick, when the layout brings another `theme` or `autoTheme`.

**Brightness is unchanged.** Night uses `brightness.night` and its 1 % floor. Day and Dark use `brightness.day` and its 5 % floor.

**Older firmware.**
- Firmware before this refuses a `dark` layout (an unknown value) and keeps its last good one, as golden rule 2 requires.
- `hello` reports `capabilities.darkTheme: true`. The editor disables *Dark* for a display that doesn't.

## Consequences
- **Cost:** the palette is about 60 bytes of constants, with no RAM cost on any board.
- **New widgets:** each one must decide which of `red_only` and `dark_page` it means. Plain `colors_for()` colours need no decision.
- **Charts in the Dark theme are drawn as by day.** Darkening map tiles would need a different recolour from Night's, which nobody asked for yet.
- **On a layout whose theme is Night, Auto now shows Day by day.** Before, it stayed Night all day, which made the setting pointless.
