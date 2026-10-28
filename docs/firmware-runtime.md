# esphelm_runtime: firmware reference

ESPHome external component in `firmware/components/esphelm_runtime/`. It shows layouts from the signalk-esphelm plugin on an LVGL display. Architecture: ADR-0007.

**Scope (Phase 5d):** every page of the layout: grid pages with `value`, `gauge`, `bar`, `switch`, `wind_rose` and `autopilot` tiles, and `chart` pages (PSRAM only). `hello.widgets` lists exactly these (`chart` only with PSRAM), so the plugin refuses to assign a layout that needs anything else.

## Configuration

```yaml
external_components:
  - source: { type: git, url: https://github.com/batuakan/ESPHomeSignalK, ref: main, path: components }
    components: [signalk]
  - source: { type: local, path: components }
    components: [esphelm_runtime]

signalk:
  host: !secret signalk_host      # update_interval defaults to 1s

lvgl:
  pages:
    - id: esphelm_page
      widgets:
        - obj: { id: esphelm_container, width: 100%, height: 100% }

esphelm_runtime:
  container: esphelm_container    # LVGL obj the runtime owns (required)
  fonts:                          # ESPHome font ids (required); see firmware/fonts.yaml
    value: esphelm_font_value
    label: esphelm_font_label
    small: esphelm_font_small
    extra: [esphelm_font_medium, esphelm_font_huge]   # optional: more sizes for tile text
    digits: [esphelm_font_digits_large, esphelm_font_digits_huge]  # optional: glyphs "0123456789.-" only
  board: waveshare-esp32-p4-86    # reported in hello
  touch: true
  stale_after: 15s                # default when a tile sets no staleAfter
  # max_layout_bytes: 65536       # override the computed capacity
  # store_dir: "."                # host build only: where the cache files go
  # backlight: display_backlight  # a dimmable light: layout brightness and screen timeout
```

All the fonts form one ladder, sorted by line height. Tile text picks the largest size that fits the tile (ADR-0017). `firmware/fonts.yaml` sets the sizes by substitution: P4 and the 720 SDL build use 28 / 42 / 64 / 96 / 144 px, the default 480 build 22 / 32 / 48 / 64 / 96, and the C3 14 / 20 / 28 / 40 / 56. The `digits` fonts (192 / 288, 128 / 192 and 80 / 112) have only the glyphs a number needs, so they're cheap even that large. Only a value tile's number uses them, while its text is numeric. The hello reports the ladder as `fontLineHeights` and `digitFontLineHeights`.

`backlight` is optional (ADR-0015). Without it, brightness is only logged, and the screen timeout covers the screen with black instead of switching the light off. The P4 config sets it and removes the hardware package's fixed `lvgl.on_idle`, so the layout's `screenTimeout` decides.

Ready-made configs:

| File | Target | Status |
|---|---|---|
| `firmware/esphelm_sdl.yaml` | desktop, 480×480 | compile, run, e2e test. Test hooks: `esphelm_shot_request <file>`, `esphelm_page_request <n>`, `esphelm_tap_request <tile> [button]` (autopilot buttons: `-10 -1 +1 +10 auto wind route standby`; a value tile or a wind rose that records opens its history, `@history close\|10m\|1h\|6h\|<rose value name>` works its popup), `esphelm_exit_request`. `ESPHELM_TEST_HISTORY=<key>[,<key>…]` (a tile id, or `<rose id>/<name>`) seeds those values with a fixed curve, across north for angles, and keeps them still (goldens) |
| `firmware/esphelm_sdl_720.yaml` | desktop, 720×720 with the P4-86 font sizes | compile, 720 renders in the e2e test. It repeats `signalk_host`/`signalk_port` because `-s` on the command line does not override substitutions of the included `esphelm_sdl.yaml`; the e2e test refuses to run a build that isn't compiled for its test port |
| `firmware/esphelm_p4.yaml` | Waveshare ESP32-P4-86, 720×720 | compiles; **not yet run on hardware** |
| `firmware/esphelm_c3_compile_check.yaml` | ESP32-C3 + 240×240 GC9A01A (placeholder pins) | compile-only check |

The P4 and C3 configs need `firmware/secrets.yaml` (`wifi_ssid`, `wifi_password`, `signalk_host`); it is git-ignored.

## What the display does

| Situation | Screen |
|---|---|
| Boot with a cached layout | the cached layout (`cur`, else `lkg`), before any network traffic |
| No SignalK connection or token yet | "Connecting to SignalK" + host:port |
| Access request pending | "Approve this display in SignalK": *Security → Access Requests*, grant **read/write** |
| Approved, not adopted | "Adopt this display in ESPHelm" + device id |
| Adopted, no layout | "No layout assigned" |
| Layout rejected | "Layout rejected", with the first error code and pointer (only when nothing else is shown) |
| Value not updated within `staleAfter` | `--`, dimmed (gauge and bar keep their last position, dimmed; wind pointers dim) |
| Layout with more than one page | a footer: `<` and `>` buttons (disabled at the ends) and "title n/m" |
| A tap on a value tile or wind rose that records (ADR-0018, ADR-0019) | its history popup below the banner: a button per value for a rose, live value, min/max, a line graph of the last 10 min / 1 h / 6 h (6 h with PSRAM only; angles drawn around their mean so north doesn't jump), "Collecting..." until there are two points; only its close button closes it |
| An active SignalK notification (`alert` … `emergency`) | the alarm banner at the top, which pushes the page down (ADR-0014): the worst unacknowledged alarm, "+N", ACK; a thin strip once acknowledged; "(offline)" without a server |
| Layout `settings` (ADR-0015) | the start page at boot and when the start page changes; the night theme while `environment.sun` is dusk or night (`autoTheme: sun`, the page is rebuilt); day/night brightness; after `screenTimeout` s without a touch (at least 10) the backlight goes off under a black cover that swallows the waking touch. An `alarm`/`emergency` switches it back on |
| A layout crashed the display (boot guard, ADR-0013) | the last known good layout (else the status page); the crashing layout is refused until a changed one is sent |

**Protocol** (`docs/plugin-api.md`):
1. After the token is approved and on every stream (re)connect, send `POST …/devices/hello`.
2. Subscribe to `plugins.esphelm.<deviceId>.version`. When it differs from the shown layout's ETag, `GET …/layout` with `If-None-Match`.
3. Run a fallback poll every 5 minutes.
4. If the plugin answers that the device is pending or has no layout, the screen clears.
5. If the plugin is unreachable, the cached layout stays up.

**Subscriptions** are derived from the **visible page** (one listener per unique path of its tiles, including each wind rose's sources and slots), plus the layout version path and `notifications.*` for the alarm banner. ESPHomeSignalK batches changes: additions are an incremental subscribe; a removal is unsubscribe-all followed by a full resubscribe, and the server replays cached values. So a page shows the latest values as soon as it is opened.

## Pages and the footer (ADR-0009)
- **Only the visible page exists.** Changing page deletes its LVGL objects and widgets and builds the next one, so memory stays at one page's worth (matters on C3/C6 without PSRAM).
- The footer appears only when the layout has more than one page. Its height is 2.2 × the small font's line height (52 px with the 480² fonts). Presses are applied from `loop()`, never inside the LVGL event, because rebuilding the page deletes the button that was pressed.
- The page index survives a layout update with the same layout id (clamped if pages were removed). A new layout id starts at page 1. A reboot starts at page 1.
- There is no swiping; the legacy apps keep theirs.

## Widgets
All widgets are pure functions of (config, latest value, theme), redraw at most every 250 ms and only when something changed. Colours come from the theme (`colors_for`): **day** is light for sunlight (white page, light grey tiles `#E6EAEE`, dark text, white controls; the wind rose keeps the legacy red/green/orange/purple with a dark card), **night** is red on black with zones differing in brightness, not hue.

Each tile type has its own file, `widget_<type>.cpp` (`value`, `gauge`, `bar`, `switch`, `autopilot`, `wind_rose`, `position`), with its class and factory. `widgets.cpp` holds the theme colours, value formatting, the font fitting and `make_tile_widget()`, which picks the factory. Helpers shared by the widgets are declared in `widget_common.h`. A new tile type adds a file and a case there.

| Widget | Drawn with | Notes |
|---|---|---|
| `value` | labels | the number in the largest font whose sample ("88" plus the decimals) fits the tile, with the caption and unit scaled alongside; a wider live value steps it down (ADR-0017). Coloured by `color` or `zones` (ADR-0016). With `history: true`, the tile records, is tappable and shows a small sparkline mark bottom-left (ADR-0018) |
| `gauge` | `lv_scale` (270°, round inner), zone sections, line needle | the value and unit sit in the open bottom of the arc, in the largest font that fits there (ADR-0017); below 160 px tick labels and the unit are dropped |
| `bar` | `lv_bar` | indicator colour follows the zone the value is in; vertical bars put the unit under the value. The value takes the largest font that fits beside or above the bar |
| `switch` | `lv_switch` | a tap sends a PUT of the new boolean (needs the read/write token). The switch shows the requested state at once and then follows the path's value; without a confirming value within 5 s it reverts and shows `!` |
| `position` | labels | latitude over longitude, formatted by `esphelm_position.h` (the same text as the editor, checked against `fixtures/position.cases.json`). The largest font of the ladder in which the widest text of the chosen format fits; it's chosen again when the page is laid out anew (alarm banner). Anything but two numbers in range shows `--` |
| `wind_rose` | two `lv_scale`s and a drawn overlay | the legacy wind page: a fixed ring relative to the bow (thick ticks every 30°, thin every 5°, wide red/green close-hauled sectors at 20–60°), a compass card inside it turning with the heading (the 16 points written along the band), triangle markers on the ring (orange A for apparent wind, purple T for true wind = `trueDirection − heading`), the heading ("12°T", or °M for a magnetic path) and big centre values. Night uses reds only. When any value in its `history` records, the whole rose is tappable and shows the mark in a free bottom corner (ADR-0019). Size tiers below |
| `autopilot` | labels and `lv_button`s | state (AUTO / WIND / TRACK / STANDBY), "TGT x°" and "HDG x°"; course buttons −10/−1/+1/+10, the configured mode buttons and STANDBY (on its own wide row when it wouldn't fit a quarter of the width). Rules below |

**Wind rose size tiers** (`esphelm_sizes.h`, generated from `WIND_ROSE_FIT` in `packages/schema`, ADR-0010). The rose measures the shorter side of its cell after layout:
- **full** (≥ 260 px): every tick, all 16 compass points, heading, slots. Slot values use the biggest font (value → label → small) at which all of them fit inside the card.
- **compact** (≥ 150 px): ticks every 30°, only N/E/S/W on the card, no heading; as many slots as fit.
- **pointers** (< 150 px): ring, sectors and markers only.

**Corner values** (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`): a value over its caption, pushed into the tile's corner and aligned to its side. Each shows only in the full tier and when its box (value in the label font, else the small font, and the caption) lies outside the ring; otherwise it's hidden.

Ring, band and marker sizes scale with the rose (ring ≈ d/15, as on the legacy page). The rose tile uses the page background instead of the tile colour. Zone styles are kept per (state, arc width), so a gauge and a rose on the same page keep their own arc widths.

**Autopilot rules** (ADR-0011):
- **Engage:** the first tap on AUTO / WIND / TRACK arms it ("AUTO?", accent colour, "tap AUTO again to engage"). A second tap within 3 s sends a PUT of the mode to `statePath`. The arm expires after 3 s, and any other button cancels it. The request shows as "sending …" until the state value matches; after 5 s it shows "no response from the autopilot".
- **STANDBY** PUTs `standby` on one tap.
- **Course buttons** PUT ±1 / ±10 (a number, degrees) to `adjustPath`. They're enabled only while the state is fresh (within the default stale time) and not `standby` / `off` / `disabled`.
- **Offline** (no SignalK connection): every button is disabled, and the tile says "offline".
- **Size:** below `AUTOPILOT_FIT` (260×220 px of content) the tile shows status only, with no buttons. In narrow tiles TGT and HDG stack; in tiny ones HDG is dropped.
- Disabled buttons use the theme's dark colours (LVGL's grey recolour is turned off; this applies to the footer buttons too).

**Chart pages** (`chart.cpp`, ADR-0012; grid and maths ported from ESPTiles, MIT):
- **Buffer:** a 1280×1280 RGB565 image (5×5 tiles of 256 px, 3,276,800 bytes) is allocated in PSRAM when the page is built and freed when it goes away. Without PSRAM, or if the allocation fails, the page shows a message instead.
- **Tiles:** fetched from `GET …/esphelm/tiles/<chart>/<z>/<x>/<y>` on a second HTTP worker (so they never delay hellos and layout fetches), one at a time, nearest to the vessel first, and copied into the buffer on the main loop.
  - A body must be exactly 131,072 bytes; anything else is dropped.
  - 404 tiles stay blank; other failures are retried after 30 s.
  - When the vessel crosses into another tile, the grid moves the tiles it keeps inside the buffer and fetches the rest; a zoom change starts over.
- **View:** north up, with the vessel's position in the middle. The overlay is drawn: a vessel arrow along the heading, the anchor marker and the alarm radius (metres → pixels at the latitude and zoom), and an ANCHOR ALARM banner when the anchor notification's `state` isn't `normal`/`nominal`.
- **Controls:** zoom + / − buttons (applied in the next tick), and a bottom label "lat lon z" that adds "position stale" when the position is older than the stale time.
- **Night:** the chart image is darkened and tinted red.
- **Offline:** tiles already in the buffer stay; nothing is stored on flash, so a reboot without the server shows placeholders.

The PUT goes through ESPHomeSignalK `put_request`; signalk-server answers it only if a provider handles that path (e.g. a digital-switching plugin). The firmware does not read the PUT response, it trusts the value stream.

**Value formatting:**
- Numbers are converted with the shared unit table (`esphelm_units.h`, generated from `packages/schema/units.json`) and shown with `decimals` (default 1).
- Booleans show as `on` / `off`.
- Strings keep ASCII and `°`; any other character becomes `?`.
- Each tile redraws at most 4 times per second, and only when the text changes. The layout is never rebuilt on a value change.

## Untrusted input: capacity guards and fallback
The parser (`layout_parser.cpp`) validates the full v1 contract with the same codes as `validateLayout` (ADR-0007), plus these device-only guards:

| Guard | Value |
|---|---|
| Body size | 256 KiB with PSRAM; otherwise 16 KiB or a quarter of the largest free block, whichever is smaller (`max_layout_bytes` overrides). Checked from `Content-Length` before reading, and again while reading. |
| String length | 128 bytes |
| JSON nesting | 12 |
| Errors kept | first 16 |
| Free heap while building tiles | stop below 32 KiB (ESP-IDF) |

Any refusal keeps the current layout on screen and is logged with its code. A layout is written to `cur` only after it parsed **and** rendered, and is promoted to `lkg` after 30 s on screen.

**Persistence** (ADR-0002):
- **Storage:** NVS namespace `esphelm`, blobs `cur` and `lkg` on ESP-IDF. On the host: `esphelm_cur.bin` and `esphelm_lkg.bin` in `store_dir`.
- **Record format:** `magic | body_len | crc32 | etag_len | etag | body`. A torn or corrupted record is detected and ignored.
- **Boot guard** (ADR-0013): a third record, `boot` (`esphelm_boot.bin` on the host), holds the etag being shown, the crash count and a skipped etag. It's written before a layout is built and cleared after 30 s on screen. After a crash reset (panic or watchdog; on the host, any exit but a clean one), a fetched layout that never got cached is skipped at once, and a cached one after its second crash. The hello reports it as `recovery.skippedLayoutEtag`.

## Threading
- LVGL, SignalK callbacks and all runtime state live on the ESPHome main loop.
- HTTP runs on a worker (FreeRTOS task with 8 KB stack on ESP-IDF; `std::thread` on host). Only requests and results cross over, through a mutex-protected queue.
- ESPHomeSignalK's WebSocket task only queues complete messages.

## Memory

| Item | Measured |
|---|---|
| `value` tile (LVGL objects) | **≈1.8–2.0 KB** on the 64-bit host build (24 tiles = 49,136 B; 4 tiles = 7,136 B). |
| `switch` tile | ≈2.6 KB (8 tiles = 20,992 B) |
| `gauge`, `bar` tiles | ≈2–2.7 KB each (energy page: gauge + bar + value = 6,416 B; engine page: 2 gauges + bar = 6,544 B) |
| `wind_rose` tile | ≈6.7–6.9 KB in full (full screen: 6,720 B at 720, 6,864 B at 480); 720 page with a 2x2 rose and five tiles: 23,936 B |
| `autopilot` tile | ≈11 KB with its 11 buttons (full screen at 480: 10,992 B); a status-only tile builds the same objects and hides the buttons |
| `position` tile | ≈1.7 KB (four tiles = 6,640 B) |
| `chart` page | 3,276,800 B tile buffer (PSRAM) + ≈6 KB of LVGL objects; up to one tile body (131 KB) in flight; an 8 KB second HTTP worker task |
| Value history (ADR-0018, ADR-0019) | per recorded value (a value tile, or one wind rose value), allocated when a layout is applied: 4,320 B with PSRAM (three windows × 120 points × 12 B, in PSRAM, up to 48 values), 2,880 B without (two windows, up to 6 values, only while 48 KB of internal RAM stay free); angles add 16 B of sums per window |
| History popup | about 25 LVGL objects while open (plus one button per wind rose value), none when closed; a 2 KB point buffer inside the runtime |
| Alarm banner | a fixed table (16 entries with PSRAM, 8 without; under 200 B each) and six LVGL objects, created on the first alarm |
| Footer | not counted above (built before the measurement starts); a few hundred bytes |
| Layout JSON | transient: body + ArduinoJson document, freed after parsing; the model keeps its own compact copies. Only wind rose tiles carry a `RoseConfig` |
| P4 runtime firmware, static | RAM 98,094 B (17.0 %), flash 3.31 MB (20.0 %; the history popup, its circular maths and LVGL's chart widget about 40 KB of it); the five full fonts (up to 144 px) are about 0.6 MB of that, the two digit fonts 197 KB |
| C3 compile check, static | RAM 112,120 B of 321,296 B (34.9 %), flash 1.42 MB of 1.8 MB (77.4 %) |

Widget figures are logged at DEBUG by the renderer per page (`Page n/m "id": k widgets, N bytes`) on the 64-bit host; on ESP32 pointers are half the size, so expect less.

The heap left on a C3 at runtime (after Wi-Fi and the 10 % LVGL buffer) hasn't been measured, because there's no C3 hardware yet.

## Tests
- `npm test` includes `firmware/test/parser.cpp.test.ts`. It compiles the parser with g++ (`-Wall -Wextra -Werror`) against ArduinoJson 7.4.3 (MIT), fetched from GitHub on first run into the git-ignored `firmware/test/.cache/` (`firmware/test/arduinojson.ts`; `ESPHELM_ARDUINOJSON=<dir with ArduinoJson.h>` for offline runs) and compares it with `validateLayout` on every fixture and on mutations. It also covers the device-only guards.
- `npm run build && npm run e2e:sdl` compiles `esphelm_sdl.yaml` for a test port (3993) and runs it against a real security-enabled signalk-server with the plugin. It checks:
  1. the access request asks for read/write
  2. the approval and adoption screens
  3. the assigned layout renders
  4. live SI values are shown converted (5.0 m/s → 9.7 kn)
  5. an edit is picked up via the version delta
  6. unsubscribe-all + resubscribe happens on the same socket
  7. stale values after the server stops
  8. a four-page layout (`fixtures/valid/multi-page-widgets-480.json`: value, gauge, bar, a full-screen rose, vertical bar, switch, and a Helm page with a 2x2 and a 1x1 rose next to engine tiles) renders with the footer; every page is shown through the page hook with live values
  9. tapping the switch (tap hook) sends a PUT, which a PUT-echo test plugin (`startSignalK({ putEcho })`) answers with a delta; the server has the new value and the switch follows
  10. stale values after the server stops
  11. the cached multi-page layout appears on a reboot without a server
  12. the 720×720 build (`esphelm_sdl_720.yaml`) starts offline from a seeded cache record (`firmware/test/cache_record.ts`) and renders `fixtures/valid/rose-and-engine-720.json` and the `helm-720` starter layout (rose and autopilot side by side)
  13. **the autopilot**, against the stand-in from `startSignalK({ autopilotSim: true })` (classic PUT interface; adjustHeading moves the target only while engaged):
      - +10 in standby does nothing
      - the first AUTO tap only arms; the second engages, and the server's state becomes `auto`
      - +10 moves the target by exactly 10°
      - an armed WIND expires after 3 s without sending
      - STANDBY is one tap
      - offline, even STANDBY is refused
  14. **a chart page**, with the charts stand-in from `startSignalK({ chartSim: true })` (generated PNG tiles):
      - tiles through the plugin, the anchor and its radius
      - recentring after a 350 m move
      - zoom in through the hook (`esphelm_tap_request chart zoom_in`)
      - the anchor alarm
      - a page whose chart the server doesn't have
  15. **the boot guard** (`ESPHELM_TEST_CRASH_ON=<tile id>` makes the host build abort while building that tile):
      - a fetched layout that crashes the display is skipped after one crash, refused when fetched again, and reported in the hello
      - offline, a cached layout that crashes is tried twice, then the last known good layout is shown, also after a normal restart
  16. **alarms**: a depth alarm and a battery warning show in the banner (worst first, "+1"); tapping shows the next; ACK goes to the plugin, which silences the alarm on the server; both acknowledged give the strip; an escalation to `emergency` shows the full banner again; back to `normal` clears it

  17. **display settings**: a layout with `startPage`, `autoTheme: sun` and a 10 s `screenTimeout` opens on its start page; `environment.sun` = dusk switches to night with the night brightness; the screen goes off after 10 s, an alarm switches it on, and so does a touch (`esphelm_tap_request @screen`); holding the footer title (`esphelm_tap_request @theme`) switches night to day, which holds while the sun stays down and is handed back to `autoTheme` at sunrise

  18. **position tiles**: the four formats of one live position (two wide tiles, two single cells in a smaller font), then a value that isn't a position (`--`)

  19. **value tile colours**: six fixed colours, a depth in its warn zone, a voltage in its alarm zone over the tile's own blue, an engine temperature in a normal zone; by day and at night

  20. **text sizes** (`fixtures/valid/value-sizes.json`): a full-width, a 2x2 and four single-cell value tiles at 480 with live values (the RPM "2400" steps down a size), and the same layout offline at 720

  21. **value history**: a tile without `history` opens nothing; a tile on page 2 without values shows "Collecting..."; the close button closes the popup; a live SOG sent every second becomes points of the graph; with a seeded curve (`ESPHELM_TEST_HISTORY`): the page with the marks, the 10 min and 1 h windows, an alarm banner over the popup, night, and the page unchanged after closing; the wind roses (a mark on the one that records, a tap on the other does nothing, its first value recording live, the popup's value buttons, the apparent wind angle and a heading tile across north without a jump); the popup and a rose's popup at 720

  Forty-eight screenshots are compared with `firmware/test/golden/*.png` (`UPDATE_GOLDEN=1` re-records them; review them by eye before committing). It needs an X display, the ESPHome CLI (`ESPHOME`), and Python with Pillow (`PYTHON`).

## Hardware check (P4-86)
Flash with `~/venv/bin/esphome run firmware/esphelm_p4.yaml`, then check:
1. The display shows **"Approve this display in SignalK"**. In the SignalK admin UI, *Security → Access Requests* lists "ESPHome device: esphelm-p4" asking for read/write. Approve it.
2. Within a few seconds the screen shows **"Adopt this display in ESPHelm"** with the device id. `GET /plugins/esphelm/api/devices` lists it as pending.
3. Adopt it and assign a layout (e.g. `packages/schema/fixtures/valid/grid-2x2-values-480.json`). The grid appears without a reboot, and the values update and are converted.
4. Unplug the SignalK server's network. After `staleAfter` the values show `--`, and the layout stays up.
5. Power-cycle the display with the server still unreachable. The same layout comes back immediately.
6. Watch the log for `Page n/m "…": k widgets, N bytes of LVGL objects`; that's the real per-page memory on the P4.
7. Assign `packages/schema/fixtures/valid/multi-page-widgets-480.json` (or a template from the editor). The footer is at the bottom; `<` and `>` change pages, and are greyed out at the ends. Check that the buttons are easy to hit with a finger.
8. Gauges, bars and the wind rose look right at 720×720 (label sizes, needle length, sectors at ±20–60°). Assign the *Sailing (large display)* template from the editor: a 3x3 rose next to SOG/STW/depth with engine tiles below. All three centre values should be readable at a glance.
9. A switch tile on a path with a real PUT handler toggles the device; on a path without one it reverts after 5 s with `!`.
10. **Autopilot** (at the dock, or with the pilot's drive disconnected first). Assign the *Autopilot* or *Helm (large display)* starter layout.
    - With the pilot in standby, ±1/±10 are greyed out and do nothing.
    - One tap on AUTO shows "AUTO?" and nothing happens. Tapping AUTO again within 3 s engages the pilot, and the display shows AUTO.
    - +10 moves the pilot's target 10° to starboard. STANDBY disengages on one tap.
    - Check that the buttons are easy to hit and that you can't engage by brushing the screen.
    - If your pilot only implements SignalK's v2 Autopilot API, nothing will respond (no bridge yet); say so and I'll add it.
11. **Chart** (needs a SignalK charts plugin with a raster PNG/JPEG chart, e.g. MBTiles). Add a chart page in the editor, pick the chart, and Save & send.
    - Tiles appear around the vessel within a few seconds, and the vessel arrow points along the heading.
    - Zoom + / − refetch the map. Moving (or a changing position) recentres it without blank flashes for tiles that stay in view.
    - With the anchor alarm plugin: the anchor and the circle match its radius, and the circle and banner turn red when it alarms.
    - Check the log for "Chart …" warnings, and how long a full screen of tiles takes.
12. **Alarms.** Raise a notification, e.g. set a shallow-depth alarm in the zones of `environment.depth.belowTransducer`, or use the anchor alarm plugin with a small radius.
    - The banner appears at the top within a second and pushes the page down; nothing on the page is hidden under it.
    - ACK is easy to hit. After ACK, apps that play sounds (e.g. the SignalK admin's notification sound, or KIP) go quiet, and the banner shrinks to a strip.
    - Make the alarm worse (`alarm` → `emergency`): the full banner comes back.
    - At night, the banner is dark with red text, with no bright area.
13. **Display settings.** In the editor's display settings, set day brightness 100 %, night 10 %, a 30 s screen timeout and *Auto day/night*. Save & send.
    - Without touching, the backlight turns off after 30 s. One tap turns it on again **without** pressing anything under your finger (try it over a switch tile).
    - A new alarm turns the screen on.
    - Switch the display theme (or wait for dusk with the derived-data plugin's `environment.sun`): night is clearly dimmer, and day goes back to full brightness. Check that 10 % is still readable in the dark and that the backlight doesn't flicker at low brightness (the LEDC runs at 100 Hz).
14. **Position tile.** Add a *Position* tile (it uses `navigation.position`) and try each format in the drawer; the display should show the same text as the editor's preview. Check that a 1×1 tile on the 720×720 display is still readable, and that unplugging the GPS turns it to `--` after the stale time.
15. **Day/night on the display.** On a layout with two or more pages, press and hold the page title in the footer.
    - After one second the page redraws in the other theme, at that theme's brightness. A short tap does nothing, and neither do the **<** / **>** buttons when held.
    - With *Auto day/night* on, the choice holds until `environment.sun` changes; a restart goes back to the layout's theme.
    - (Only the test hook was exercised on the desktop build; the real touch path is checked here for the first time.)
16. **Value tile colours.** Give a few value tiles a colour, and a depth tile zones such as "3 or less warn, 2 or less alarm".
    - By day, check that every colour is readable in sunlight, yellow in particular.
    - At night everything is red; check that a warn and an alarm value can still be told apart from normal.
17. **Text sizes.** Assign `packages/schema/fixtures/valid/value-sizes.json`.
    - The full-width SOG and the 2x2 depth use the large digit fonts, and the captions grow with the numbers.
    - A value tile on a boolean path shows "on"/"off" in a full font (the digit fonts have no letters).
    - In the single cells nothing is clipped. An RPM in the thousands or a 3-digit heading may shrink one size when its first value arrives.
    - Captions and units are readable at arm's length, and the editor's preview shows the same proportions.
18. **Value history.** Assign `packages/schema/fixtures/valid/value-history.json` with a live SOG, depth, wind and heading.
    - Value tiles with `history: true` show a small sparkline mark bottom-left; the HDG tile (no `history`) has none.
    - Tap SOG: the popup opens below any alarm banner. Touching the graph or the empty space does nothing; only **X** closes it, and the page is as before.
    - Over 10 minutes the 10 min graph fills from the right; switch to 1 h and 6 h. A steady value draws a flat line, not gaps.
    - Raise an alarm while it's open: the banner stays on top and the popup moves down.
    - Page 3: the large rose shows the mark bottom-right (its bottom-left corner holds SOG); the small rose has none and a tap does nothing. Tap the large rose: buttons AWS, SOG, AWA; each switches the graph.
    - Sail or turn across north: the AWA and HDG2 graphs stay smooth, their labels read e.g. 350, 0, 10.
    - Check the log for `History: N values, 3 windows, … bytes` and that the free heap stays healthy.
