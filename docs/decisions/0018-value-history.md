# ADR-0018: Value history popup

Status: **Accepted** (2026-10-28)

## Context
You asked for a graph of a value over time: tap a value tile, a popup shows how it changed, and a close button brings the page back.

Two places could keep the history:
- **The display.** It already receives every value it shows.
- **The plugin.** It could record paths, or use SignalK's history API.

The plugin keeps history across reboots, but it's empty whenever the server is unreachable. It also needs a new device endpoint, and most boats run no SignalK history provider. Golden rule 3 (offline first) decides it: **the display records**.

## Decision
- **Which tiles record:** every value tile records its recent values from boot, on **every page** of the layout, so the graph is already full when you open it. `history: false` on a tile turns it off.
  - The display also listens to the history paths of the pages it isn't showing. The subscription set still derives from the layout.
- **The windows:** 10 min, 1 h and 6 h, each a ring of 120 points (5 s, 30 s and 3 min per point). Each point is the mean, min and max of its values, in display units.
  - **No value in a point:** while the last value isn't stale yet (the tile's `staleAfter`), the point repeats it, because SignalK may send only changes. Otherwise the point is a gap, and the line breaks there.
- **Memory:** buffers are allocated when a layout is applied, never per value (`value_history.cpp`).
  - **PSRAM boards:** all three windows, in PSRAM, for up to 48 tiles: 4.3 KB per tile.
  - **No PSRAM (C3/C6):** 10 min and 1 h only, for up to 6 tiles: 2.9 KB per tile, and only while 48 KB of internal RAM stay free.
  - **Over the limit:** the remaining tiles get no history and aren't tappable; the display logs which ones.
  - The limits are `HISTORY` in `packages/schema/src/tiles.ts`, generated into `esphelm_sizes.h`.
- **Layout updates:** an update keeps the history of tiles with the same id, path and unit, so an editor save doesn't wipe the graphs.
- **Reboot:** a reboot loses the history.
- **The popup** (`history_popup.cpp`) is not a widget: it belongs to the runtime, like the alarm banner.
  - It covers the screen below the banner, on LVGL's top layer. The banner stays in front, and the popup moves down when the banner appears.
  - **Contents:**
    - the caption
    - the live value with its unit
    - min and max of the window
    - a line graph with three y labels and the time axis ("-10 m", "-5 m", "now")
    - the three window buttons and a close button
  - **Range and colour:** the y range is the window's min/max plus 10 %. Zones show as faint bands behind the line. The night theme is red only.
  - **No data yet:** "Collecting..." until a window has two points.
  - **Closing:** only the close button closes it; touches elsewhere are swallowed. It's opened in `loop()`, never inside an LVGL event.
  - **Its tile changes:** if a new layout removes the tile it closes; otherwise it reopens on the new tile.
- **The tile:** a value tile that records shows a small sparkline mark bottom-left, so it reads as tappable. The font has no arrow glyph.
- **Within schema v1:** `history` is optional; absent means on. Older firmware ignores it.
- **The editor** has a "Tap for history" checkbox on value tiles, and "Preview graph" opens a mock of the popup with an example curve, in the layout's theme. A tap on a tile in the editor selects it, so the mock opens from the drawer instead.

## Consequences
- **Build cost:** flash +30 KB (P4 3.26 → 3.29 MB, C3 74.8 → 76.5 %), static RAM +2.5 KB (the popup's point buffers).
- **A display has no history after a restart.** "Collecting..." for the first 10 s, and the 6 h window takes 6 h to fill.
- **Hidden pages:** the display now listens to the value paths on pages it isn't showing, which is a little more WebSocket traffic.
- **Steady values:** a steady value is drawn as a flat line only while it's fresh. A sensor that sends rarely (slower than its `staleAfter`) shows gaps; give it a longer `staleAfter`.
- **The C3 floor** gets 10 min and 1 h for 6 tiles at most.
- **No golden screenshot of a live recording:** the timing of live points isn't deterministic. The SDL goldens use a fixed seeded curve (`ESPHELM_TEST_HISTORY=<tile>`, host build only); live recording is checked through the log.
- **Many SDL goldens changed:** every value tile gained the 66-pixel mark. Seven goldens were added.
