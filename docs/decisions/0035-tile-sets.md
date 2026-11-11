# ADR-0035: Tile sets: the core and the tiles are separate components

Status: **Accepted** (2026-11-11)

## Context
- **Monochrome displays are coming.** The first is the Waveshare ESP32-S3-RLCD-4.2: a 400×300 1-bit reflective LCD, with no touch and no backlight.
- **The colour tiles don't suit 1-bit.** They rely on colour, grey, anti-aliased arcs and touch. On a 1-bit panel they would come out ragged, or carry meaning a 1-bit panel can't show.
- **The constraints:**
  - The colour displays must look exactly as they do now.
  - A mono firmware must not carry the colour tiles, and a colour firmware must not carry the mono ones.
- **What's shared:** about two thirds of `esphelm_runtime` has nothing to do with drawing a tile. That part is the layout client, the flash cache and boot guard, the parser, subscriptions, display prefs, the alarm banner, footer, settings panel and value history. A second, copied runtime would mean fixing every bug in that part twice.

## Decision
**`esphelm_runtime` is the core. A tile set is a separate ESPHome component, and a firmware has exactly one.**

- **The contract** is `esphelm_runtime/widgets.h`: `Fonts`, `Colors`, `WidgetEnv`, `Widget`, and four functions the tile set defines:

  | Function | What it does |
  |---|---|
  | `colors_for(Theme)` | the palette, also used by the core's banner, footer, settings panel and popup |
  | `make_tile_widget(cell, tile, env)` | builds a tile |
  | `tile_types(out, psram)` | the types it renders, sent as `hello.widgets` |
  | `display_kind()` | `"color"` or `"mono"`; `hello` sends `display.kind` only for mono, so older plugins accept a colour display's hello |

  They're resolved at link time, with no registry and no virtual dispatch.
- **`esphelm_tiles_color`** holds today's tiles:
  - `widget_*.cpp`, `corner_values.cpp` and `chart.cpp`;
  - `tiles_color.cpp`: the palettes, the factory, and helpers only these tiles use (`zone_style`, `style_cell`, `make_history_mark`).
- **`esphelm_tiles_mono`** renders black-and-white tiles against the same contract (`mono_*.cpp`, `tiles_mono.cpp`):
  - **Tiles:** `value`, `bar`, `clock` and `position`. `switch` and `autopilot` need touch, and the round tiles need more work; a type the set lacks shows *Not on this display*, though the plugin doesn't send one.
  - **The look:** each tile is an outlined frame on the page, its labels taking their colour from the cell.
  - **Zones** show as a style: a heavy frame for warn, an inverted tile for alarm and emergency. A value tile's colour is ignored.
  - **Stale:** "--", as the colour tiles show a missing value.
  - **The palette:** two colours, black on white by day; dark and night are both white on black.
  - **The settings panel** offers *Plain*, *Inverted* and *Auto*.
- **Pure black and white:** LVGL 9.5's software renderer anti-aliases rounded corners and lines whatever the display's antialiasing flag says. So a mono build (`USE_ESPHELM_MONO`, defined by the mono set) thresholds every area by brightness just before LVGL flushes it (`esphelm_mono.h`, an `LV_EVENT_FLUSH_START` handler). The panel driver then only ever gets pure black and pure white. Fonts are built with `bpp: 1` (`font_bpp` in `fonts.yaml`), so text is crisp rather than thresholded.
- **ESPHome binary displays** draw any colour but black in ink, so a black-on-white picture would come out inverted. `esphelm_tiles_mono: ink_on: true` flips the thresholded pixels for such a driver. That's one line per board, with no fork of the driver.
- **The first board** is the Waveshare ESP32-S3-RLCD-4.2 (`firmware/esphelm_rlcd.yaml`):
  - its panel driver is kylehase/ESPHome-ST7305-RLCD (Apache-2.0), pinned to a commit;
  - ESPHome's LVGL sends each finished frame to it (`update_when_display_idle`).
  - **No touch:** its two buttons call the runtime's `tap()`. KEY is the next page (`@next`, wrapping round), and a long press switches between Plain and Inverted. BOOT acknowledges the alarm shown.
  - **Not reachable from the buttons:** the settings panel. Wi-Fi comes from the captive portal and the server from mDNS, so nothing there is needed to get going.
- **The core keeps what any tile set shares:**
  - **Helpers** in `widget_base.h/.cpp`: labels, font fitting, value formatting, `Binding`, scale steps.
  - **Header-only geometry:** the wind rose, engine, heading tape and centre zero. A header nobody includes costs nothing, and the generators and g++ tests keep their paths.
- **Charts are optional in the core.** The chart tile store (`chart_store.*`) and its HTTP worker are owned by the runtime, but compile only with `USE_ESPHELM_CHARTS`, which the colour set defines. A build without charts carries neither.
- **The history popup** (ADR-0018) stays in the core. It's opened by the runtime, not by a tile.
- **Each component turns on its own LVGL features:** the core for the grid, footer, panel and popup; a tile set for its widgets.
- **The YAML:**
  - `esphelm_tiles_color:` goes next to `esphelm_runtime:`, and in `external_components`.
  - `esphelm_runtime`'s final validation refuses a config with no tile set or with more than one.
- **Layouts aren't affected.** The layout schema doesn't change: a tile set renders the schema's tile types. The editor and plugin already go by `hello.widgets`.
- **The editor follows `display.kind`.** On a mono display the preview is black and white, the themes are *Plain* (`day`) and *Inverted* (`dark`; `night` looks the same there), and value tiles have no colour choice.

## Consequences
- **Moving files changes nothing on the colour displays.** The SDL goldens stay identical.
- **The firmware YAMLs gain one line each.** A custom YAML without it fails `esphome config` with a message saying what to add.
- **A new tile type** goes into each tile set that should render it. A set that leaves a type out just doesn't list it in `tile_types`.
- **New tile set helpers:** a helper both sets need belongs in `widget_base`; one that draws in a set's own style stays in that set.
