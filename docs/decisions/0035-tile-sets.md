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

- **The contract** is `esphelm_runtime/widgets.h`: `Fonts`, `Colors`, `WidgetEnv`, `Widget`, and three functions the tile set defines:

  | Function | What it does |
  |---|---|
  | `colors_for(Theme)` | the palette, also used by the core's banner, footer, settings panel and popup |
  | `make_tile_widget(cell, tile, env)` | builds a tile |
  | `tile_types(out, psram)` | the types it renders, sent as `hello.widgets` |

  They're resolved at link time, with no registry and no virtual dispatch.
- **`esphelm_tiles_color`** holds today's tiles:
  - `widget_*.cpp`, `corner_values.cpp` and `chart.cpp`;
  - `tiles_color.cpp`: the palettes, the factory, and helpers only these tiles use (`zone_style`, `style_cell`, `make_history_mark`).
- **`esphelm_tiles_mono`**, to come, renders the 1-bit tiles against the same contract.
- **The core keeps what any tile set shares:**
  - **Helpers** in `widget_base.h/.cpp`: labels, font fitting, value formatting, `Binding`, scale steps.
  - **Header-only geometry:** the wind rose, engine, heading tape and centre zero. A header nobody includes costs nothing, and the generators and g++ tests keep their paths.
- **Charts are optional in the core.** The chart tile store (`chart_store.*`) and its HTTP worker are owned by the runtime, but compile only with `USE_ESPHELM_CHARTS`, which the colour set defines. A build without charts carries neither.
- **The history popup** (ADR-0018) stays in the core. It's opened by the runtime, not by a tile.
- **Each component turns on its own LVGL features:** the core for the grid, footer, panel and popup; a tile set for its widgets.
- **The YAML:**
  - `esphelm_tiles_color:` goes next to `esphelm_runtime:`, and in `external_components`.
  - `esphelm_runtime`'s final validation refuses a config with no tile set or with more than one.
- **Layouts aren't affected.** The schema doesn't change: a tile set renders the schema's tile types. The editor and plugin already go by `hello.widgets`.

## Consequences
- **Moving files changes nothing on the colour displays.** The SDL goldens stay identical.
- **The firmware YAMLs gain one line each.** A custom YAML without it fails `esphome config` with a message saying what to add.
- **A new tile type** goes into each tile set that should render it. A set that leaves a type out just doesn't list it in `tile_types`.
- **New tile set helpers:** a helper both sets need belongs in `widget_base`; one that draws in a set's own style stays in that set.
