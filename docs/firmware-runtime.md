# esphelm_runtime: firmware reference

ESPHome external component in `firmware/components/esphelm_runtime/`. It shows layouts from the signalk-esphelm plugin on an LVGL display. Architecture: ADR-0007.

**Scope:** every page of the layout: grid pages with every tile type of the catalog, `chart` only with PSRAM. `hello.widgets` lists exactly these, so the plugin refuses to assign a layout that needs anything else.

## Configuration

```yaml
external_components:
  - source: { type: git, url: https://github.com/batuakan/ESPHomeSignalK, ref: main, path: components }
    components: [signalk]
  - source: { type: local, path: components }
    components: [esphelm_runtime]

signalk:                          # no host: found with mDNS (ADR-0026); update_interval defaults to 1s

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
    digits: [esphelm_font_digits_large, esphelm_font_digits_huge]  # optional: glyphs "0123456789.-:" only
  board: waveshare-esp32-p4-86    # reported in hello
  touch: true
  stale_after: 15s                # default when a tile sets no staleAfter
  # max_layout_bytes: 65536       # override the computed capacity
  # store_dir: "."                # host build only: where the cache files go
  # backlight: display_backlight  # a dimmable light: layout brightness and screen timeout
  # time_id: sntp_time            # an ESPHome time source for the clock when SignalK has none
  # sound:                        # alarm tones and touch clicks (ADR-0033)
  #   rtttl: board_rtttl          # ESPHome's rtttl component (required)
  #   speaker: board_speaker      # its speaker, for the volume (else rtttl's gain)
  #   click: "click:d=32,o=7,b=250:c"   # optional: replace a tune (click, alert, warn, alarm, emergency)
```

All the fonts form one ladder, sorted by line height. Tile text picks the largest size that fits the tile (ADR-0017). `firmware/fonts.yaml` sets the sizes by substitution: P4 and the 720 SDL build use 28 / 42 / 64 / 96 / 144 px, the default 480 build 22 / 32 / 48 / 64 / 96, and the C3 14 / 20 / 28 / 40 / 56. The `digits` fonts (192 / 288, 128 / 192 and 80 / 112) have only the glyphs a number needs, so they're cheap even that large. Only a value tile's number uses them, while its text is numeric. The hello reports the ladder as `fontLineHeights` and `digitFontLineHeights`.

`backlight` is optional (ADR-0015). Without it, brightness is only logged, and the screen timeout covers the screen with black instead of switching the light off. The P4 config sets it and removes the hardware package's fixed `lvgl.on_idle`, so the layout's `screenTimeout` decides.

**Rotation** (ADR-0028): the layout's `settings.rotation` turns the display just before the layout's page is built (`rotate_()`, ESPHome's `LvglComponent::set_rotation()`, picture and touch), so a cached layout boots turned and a layout without it turns it back to 0. A change closes the panel and the history popup, the alarm banner cuts its text for the new width, and a `hello` with the turned size follows. A board allows it with `lvgl: rotation: 0`, which sets `USE_ESPHELM_ROTATION` and `capabilities.rotation`; elsewhere the setting is logged once and ignored.

**Sound** (ADR-0033): with `sound:`, the runtime plays alarm tones and touch clicks through ESPHome's `rtttl` (`sound.cpp`, `SoundPlayer`). An alarm sounds when its notification's `method` contains `"sound"` and it isn't acknowledged: `alert` and `warn` once, `alarm` every 5 s, `emergency` back to back (`esphelm_sound.h`, shared with `packages/schema/src/sound.ts`), stopped by an acknowledgement, the alarm clearing or the server going offline. A click plays when a touch lands on something with an event handler (one LVGL input-device callback), never over an alarm tune or on a wake touch. Volume and touch clicks come from the layout's `settings.sound` and the *Settings* tab. The P4's hardware package wires the ES8311, the I2S speaker, the amplifier (GPIO53) and `rtttl`. `rtttl` plays through a `mixer` into an I2S speaker that never stops, warmed up by a silent tune at boot with the amplifier still off, so the codec doesn't pop when its clock starts. The other boards have no speaker, compile no sound code and leave `capabilities.sound` out of `hello`.

**The clock** (ADR-0024) is set from the layout's `clockPath` (default `navigation.datetime`, GPS time), and runs on `millis()` in between, so it keeps time offline. It's subscribed only when the layout has a clock tile or a clock screen saver. `time_id` is optional: any ESPHome `time:` component, used when SignalK hasn't sent a time for ten minutes: `homeassistant`, or `sntp` with `servers:` on the boat's LAN (its defaults are internet pool servers, and ESPHelm doesn't depend on the internet). No ready-made config sets it. A time before 2020 (a GPS without a fix) is ignored. With the layout's `screenSaver` set, the screen timeout dims the backlight to `screenSaverBrightness` and shows the time and/or date faintly instead of going dark; until the display knows the time it goes dark as before. The digits fonts need `:` for the time; a font without it is skipped for clocks.

Ready-made configs:

| File | Target | Status |
|---|---|---|
| `firmware/esphelm_sdl.yaml` | desktop, 480×480 | compile, run, e2e test. Test hooks: `esphelm_shot_request <file>`, `esphelm_page_request <n>`, `esphelm_tap_request <tile> [button]` (autopilot buttons: `-10 -1 +1 +10 auto wind route standby`; a value tile or a wind rose that records opens its history, `@history close\|10m\|1h\|6h\|<rose value name>` works its popup), `esphelm_exit_request`. `ESPHELM_TEST_HISTORY=<key>[,<key>…]` (a tile id, or `<rose id>/<name>`) seeds those values with a fixed curve, across north for angles, and keeps them still (goldens) |
| `firmware/esphelm_sdl_720.yaml` | desktop, 720×720 with the P4-86 font sizes | compile, 720 renders in the e2e test. It repeats `signalk_host`/`signalk_port` because `-s` on the command line does not override substitutions of the included `esphelm_sdl.yaml`; the e2e test refuses to run a build that isn't compiled for its test port |
| `firmware/esphelm_sdl_wide.yaml` | desktop, 1280×800 with the P4-86 font sizes | compile, renders in the e2e test: a square layout stretched to a landscape screen, the panel, and a layout with `settings.rotation: 90` turning it to 800×1280 |
| `firmware/esphelm_sdl_cyd.yaml` | desktop, 320×240 with the CYD font sizes | compile; a preview of layouts on the CYD (not in the e2e test) |
| `firmware/esphelm_p4.yaml` | Waveshare ESP32-P4-86, 720×720 | compiles, checked on hardware |
| `firmware/esphelm_guition_4848s040.yaml` | Guition ESP32-S3-4848S040, 4" 480×480, S3 with PSRAM (`hardware/guition-esp32-s3-4848s040.yaml`: ESPHome's `mipi_rgb` model `GUITION-4848S040`, GT911 touch, backlight GPIO38). The 480 font sizes of the SDL build | compiles (flash 1,799,787 B of 8 MB, static RAM 121,647 B); **not yet run on hardware** |
| `firmware/esphelm_cyd.yaml` | ESP32-2432S028R "cheap yellow display", 2.8" 320×240, ESP32 without PSRAM (`hardware/esp32-2432s028r.yaml`: ESPHome's `mipi_spi` model `ESP32-2432S028`, the micro-USB ILI9341 revision, turned to landscape by the panel; XPT2046 resistive touch, backlight GPIO21). No chart pages, 6 recorded values; dense layouts need bigger tiles at this size | compiles (flash 1,491,819 B, 81 % of its 1.75 MB app partition; static RAM 55,524 B); **not yet run on hardware**, touch calibration and orientation unchecked |
| `firmware/esphelm_c3_compile_check.yaml` | ESP32-C3 + 240×240 GC9A01A (placeholder pins) | compile-only check |

The device configs have no secrets (ADR-0026): `firmware/wifi.yaml` compiles in no network, only the setup network and its captive portal, and the SignalK server is found with mDNS. The SDL configs set `signalk_host`/`signalk_port` (the e2e passes them with `-s`).

## What the display does

| Situation | Screen |
|---|---|
| Boot with a cached layout | the cached layout (`cur`, else `lkg`), before any network traffic |
| The setup network is up (ADR-0026) | "Set up Wi-Fi": a QR code to join it, its name and this display's password, then "choose the boat's network"; the menu button is in the corner |
| Wi-Fi not connected | "Joining Wi-Fi" |
| No server found yet (mDNS) | "Looking for a SignalK server" |
| No SignalK connection or token yet | "Connecting to SignalK" + host:port |
| Access request pending | "Approve this display in SignalK": *Security → Access Requests*, grant **read/write** |
| Approved, not adopted | "Adopt this display in ESPHelm" + device id |
| Adopted, no layout | "No layout assigned" |
| Layout rejected | "Layout rejected", with the first error code and pointer (only when nothing else is shown) |
| Value not updated within `staleAfter` | `--`, dimmed (gauge and bar keep their last position, dimmed; wind pointers dim) |
| Any layout | a footer with the page title and the settings menu button (ADR-0025); with more than one page also `<` and `>` (disabled at the ends) and "n/m" |
| The footer's menu button (ADR-0025), or the status page's | the settings panel below the banner, in three tabs: *Settings* (brightness, Day / Night / Auto, *Screen off* with a screen timeout), *Network* (Wi-Fi and the SignalK server, ADR-0026) and *Info* (the display, SignalK, the layout and the clock); only its close button closes it |
| Zones change in the server's metadata (ADR-0020) | within seconds (at most about a minute) the visible tiles use them, replacing their own; the page is rebuilt once, without a new layout |
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

## Pages and the footer (ADR-0009, ADR-0025)
- **Only the visible page exists.** Changing page deletes its LVGL objects and widgets and builds the next one, so memory stays at one page's worth (matters on C3/C6 without PSRAM).
- Every layout has a footer (since ADR-0025; before, only layouts with more than one page): the page title, the settings menu button and, with several pages, `<`, `>` and "n/m". Its height is 2.2 × the small font's line height (52 px with the 480² fonts). Presses are applied from `loop()`, never inside the LVGL event, because rebuilding the page deletes the button that was pressed.
- The page index survives a layout update with the same layout id (clamped if pages were removed). A new layout id starts at page 1. A reboot starts at page 1.
- There is no swiping; the legacy apps keep theirs.

## Settings panel (ADR-0025)
- **Opening and closing:** the footer's menu button (or the status page's, before there is a layout) opens `SettingsPanel` on LVGL's top layer, below the alarm banner, on its *Settings* tab; *Network* and *Info* are the others. Only the tab shown is built. Only its close button closes it; the screen timeout and losing the layout (e.g. the device is unassigned) close it too.
- **Brightness** is a slider for the theme shown: day 5–100 %, night 1–100 %. It dims live and is saved when let go. On a board without a backlight it is only logged.
- **Theme:** *Day* and *Night* override the layout's theme and the sun; *Auto* hands it back.
- **Sound** (ADR-0033, only with `sound:`): a *Volume* slider (10–100 %, saved when let go, with a click at the new volume) and a *Touch sounds* button (tap parts `volume=<10-100>`, `touch-sounds`).
- **Screen off,** shown when the layout has a screen timeout, switches off (or to the screen saver) at once.
- **Saved choices** are kept in `Slot::PREFS` (NVS key `prefs`; `esphelm_prefs.bin` on the host) by `display_prefs.cpp`.
  - **Format:** a self-checking record, `v=2;th=…;bd=…;bn=…;vo=…;to=…` plus the layout values they were chosen against. A `v=1` record (before sound) still reads, with no sound overrides.
  - **Read:** before the first layout, so they survive a reboot. A record that doesn't parse or has a value out of range is ignored.
  - **Dropped:** when a layout brings a different `theme`/`autoTheme` (theme choice), `brightness.day`/`.night` or `sound.volume`/`.touch` (that override), and a day/night choice when the sun changes. The first sun value after a boot is not a change.
- **Information** (the *Info* tab, one column of sections that scrolls) is refreshed once a second while it shows.
  - **Display:** id, board, firmware, screen, uptime, free memory (internal, and PSRAM). Free memory is not on the host.
  - **SignalK:** server, stream, deltas received and messages dropped, the last delta's age, subscribed paths. The counters come from ESPHomeSignalK.
  - **Layout:** name, version, where it came from (fetched, cached, last known good), pages, the plugin's state for the device.
  - **Clock:** UTC, its source, the time zone.
  - **Long values** are shortened with "..". Each section is a box with three labels (heading, names, values), so the row count of a section is fixed.
- **Network tab** (ADR-0026), rows refreshed like *Info*, with controls below each section:
  - **Wi-Fi:** network and signal (`USE_WIFI`), IP (`USE_NETWORK`), whether the setup network is on. While it is, its QR code, name and password.
  - **SignalK server:** address, host name, stream. *Change server* runs `SignalK::scan_servers()` and lists up to 6 of `servers_found()`; a tap calls `choose_server()`. *Forget server* asks *Yes* and calls `forget_server()`. With `host:` in the YAML: "Set in the firmware".
  - **Factory reset:** last, under its own heading (with `USE_ESPHELM_WIFI_SETUP`: no network in the YAML; tap part `factory-reset`). It asks *Yes*, then runs ESPHome's factory reset (`global_preferences->reset()`, which erases the whole NVS partition: Wi-Fi, token, server, cached layouts, the display's choices) and restarts into the setup network.

## Setup without configuration (ADR-0026)
- **Setup network password:** made once per display in `setup_ap_()` (before Wi-Fi starts: the runtime's setup priority is higher), 10 characters of `esphelm_wifi_setup.h`'s alphabet from the hardware RNG with `bootloader_random_enable()`, saved in `Slot::AP` (NVS key `ap`), checked on load. `__init__.py` refuses a `password` under `wifi: ap:`.
- **When it opens:** ESPHome's rules with `ap_timeout: 2min` and `provisioning: timeout: 10min` (`firmware/wifi.yaml`); after the first connection the runtime sets the AP timeout to 0, so it never opens again until a power-up.
- **Server binding:** ESPHomeSignalK saves the server it uses (ESPHome preference 10003, on the host build too: a file in `ESPHOME_PREFDIR`, default `~/.esphome/prefs/`) and accepts only that one after a restart; see its `server_discovery.h`.

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
| `engine` | one object drawn in its draw callback (`widget_engine.cpp`, ADR-0032) | the legacy engine screen: a 240° RPM arc (zone bands outside the ticks, ticks red in an alarm zone, labels in hundreds with "x100" from 1000) and the `left`, `right` and `bottom` slot gauges with icons (SVG paths filled into an A8 mask at layout time by `esphelm_icon_raster.h`, drawn in the theme colour), red wedge needles, and up to four corner values (`CornerValues` in `corner_values.cpp`, shared with the wind rose; a bottom corner may sit in the arc's open bottom). Geometry and icon polygons from `esphelm_engine_shapes.h` (generated) and `esphelm_engine.h` (checked against `fixtures/engine.cases.json`). On the page background, like the rose. Slots from 260 px, labels from 160 px (`ENGINE_FIT`); a stale value mutes its needle and icon |

**Wind rose size tiers** (`esphelm_sizes.h`, generated from `WIND_ROSE_FIT` in `packages/schema`, ADR-0010). The rose measures the shorter side of its cell after layout:
- **full** (≥ 260 px): every tick, all 16 compass points, heading, slots. Slot values use the biggest font at which all of them fit inside the card: the value font, else the next full font of the ladder (ADR-0017), down to the small font. So a slightly smaller rose, e.g. while the alarm banner pushes the page down, steps down one size instead of straight to the label font.
- **compact** (≥ 150 px): ticks every 30°, only N/E/S/W on the card, no heading; as many slots as fit.
- **pointers** (< 150 px): ring, sectors and markers only.

**Performance graphics** (ADR-0029, `esphelm_wind_rose.h`): laylines, the waypoint W and the target angle bar are drawn on the markers overlay before the T and A markers, in every tier. Laylines run from the edge of the centre values (a sixth of the rose in the pointers tier) across the ring, `d/60` wide (the target bar half as wide again, across the ring only). Each graphic needs all its values fresh, else it isn't drawn; a SignalK beat or gybe angle that is stale or implausible gives way to the tile's fixed one. The rose subscribes to the extra paths only for the graphics that are on.

**Corner values** (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`): a value over its caption, pushed into the tile's corner and aligned to its side. Each shows only in the full tier and when its box (value in the label font, else the small font, and the caption) lies outside the ring; otherwise it's hidden.

Ring, band and marker sizes scale with the rose (ring ≈ d/15, as on the legacy page). The rose tile uses the page background instead of the tile colour. Zone styles are kept per (state, arc width), so a gauge and a rose on the same page keep their own arc widths.

**Autopilot rules** (ADR-0011):
- **Engage:** the first tap on AUTO / WIND / TRACK arms it ("AUTO?", accent colour, "tap AUTO again to engage"). A second tap within 3 s sends a PUT of the mode to `statePath`. The arm expires after 3 s, and any other button cancels it. The request shows as "sending …" until the state value matches; after 5 s it shows "no response from the autopilot".
- **STANDBY** PUTs `standby` on one tap.
- **Course buttons** PUT ±1 / ±10 (a number, degrees) to `adjustPath`. They're enabled only while the state is fresh (within the default stale time) and not `standby` / `off` / `disabled`.
- **Offline** (no SignalK connection): every button is disabled, and the tile says "offline".
- **Size:** below `AUTOPILOT_FIT` (260×220 px of content) the tile shows status only, with no buttons. In narrow tiles TGT and HDG stack; in tiny ones HDG is dropped.
- Disabled buttons use the theme's dark colours (LVGL's grey recolour is turned off; this applies to the footer buttons too).

**Chart tiles** (`chart.cpp` and `chart_store.cpp`, ADR-0012 and ADR-0030; Web-Mercator maths ported from ESPTiles, MIT):
- **One store for every chart** (`ChartTileStore`, owned by the runtime): 256 px RGB565 map tiles (131,072 bytes each) in PSRAM, keyed by chart, zoom and tile. Charts are centred on the vessel, so charts of the same chart and zoom need the same tiles, and each is fetched and kept once.
  - **Budget:** set when the first tile is needed: 40 % of the free PSRAM, between 16 and 48 tiles (2–6 MB; logged as "Chart tiles: up to N"). Memory is allocated per tile as it arrives and reused.
  - **Wanting:** every tick, each chart tells the store which tiles cover its view, nearest to the vessel first. A tile wanted in the last second is never evicted; when the budget is full the least recently wanted other tile makes room, and if every tile is on screen, nothing more is fetched (the edges stay blank).
  - **Fetching:** the store alone uses the second HTTP worker (`GET …/esphelm/tiles/<chart>/<z>/<x>/<y>`, so tiles never delay hellos and layout fetches), one tile at a time, the most wanted first. A body must be exactly 131,072 bytes; anything else is dropped. 404 tiles stay blank; other failures are retried after 30 s. Each loaded tile is logged at debug level ("Chart tile … loaded").
  - **Lifetime:** kept across page changes while the layout has charts, so a chart page you come back to draws at once; freed when a layout without charts is applied.
- **Drawing:** each chart draws the store's tiles that cover its cell straight from the store in its draw callback (no image of its own), then the overlay: a vessel arrow along the heading, the anchor marker and the alarm radius (metres → pixels at the latitude and zoom). Without PSRAM it shows a message instead.
- **Size tiers** (`CHART_FIT` in `esphelm_sizes.h`): zoom + / − buttons (applied in the next tick, each chart keeps its own zoom) from 200 px on the shorter side; the bottom label "lat lon z" (with "position stale" when the position is older than the stale time) from 260 px; an ANCHOR ALARM banner when the anchor notification's `state` isn't `normal`/`nominal`, or below 200 px a red frame.
- **Night:** the map is darkened and tinted red (a recolour on each drawn tile).
- **Offline:** tiles already in the store stay; nothing is stored on flash, so a reboot without the server shows placeholders.

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
| `chart` tiles (ADR-0030) | the shared store: up to its budget of 131,072 B map tiles in PSRAM (16–48, 2–6 MB), whatever the number of chart tiles, plus ≈80 B per slot; per chart tile ≈5 KB of LVGL objects and a few hundred bytes of state; up to one tile body (131 KB) in flight; an 8 KB second HTTP worker task |
| Zones from the server (ADR-0020) | 24 B per zone per tile that uses them, a second list of the layout's own zones, and one map entry per path with zones (SI, up to 16 zones); a transient 4 KB body per read. Nothing per value, nothing in flash |
| Value history (ADR-0018, ADR-0019) | per recorded value (a value tile, or one wind rose value), allocated when a layout is applied: 4,320 B with PSRAM (three windows × 120 points × 12 B, in PSRAM, up to 48 values), 2,880 B without (two windows, up to 6 values, only while 48 KB of internal RAM stay free); angles add 16 B of sums per window |
| `graph` tile (ADR-0021) | its recorded value (the row below) and, while its page is shown, ≈8.8 KB of LVGL objects with its 1.9 KB point buffer (four graphs with two zones = 35,152 B) |
| centre-zero gauge / bar (ADR-0023) | one more LVGL arc (gauge) or line (bar) and two labels for the ends |
| `clock` tile (ADR-0024) | up to four labels and a few bytes of state; nothing per update. The screen saver adds two labels to the sleep cover, created on first use |
| Wind rose performance graphics (ADR-0029) | four more bindings per rose (about 4 × 60 B plus their path strings), always made, subscribed only when their graphic is on; no LVGL objects (drawn on the markers overlay), nothing per update |
| `engine` tile (ADR-0032) | one LVGL object (≈5.2 KB with its cell on the host build, a full-screen tile), its RPM ticks worked out at layout time (≤ 81 ticks, ≈1.3 KB), four bindings, the slots' zones and an A8 mask per icon (side², ≈3.7 KB each at a full 720 tile, ≈1.7 KB at 480); nothing per update |
| `heading_tape` tile (ADR-0022) | four LVGL objects; the ticks are drawn in its draw callback from a stack list (at most 37) |
| History popup | about 25 LVGL objects while open (plus one button per wind rose value), none when closed; a 2 KB point buffer inside the runtime |
| Alarm banner | a fixed table (16 entries with PSRAM, 8 without; under 200 B each) and six LVGL objects, created on the first alarm |
| Footer | not counted above (built before the measurement starts); a few hundred bytes, now on every layout, with the menu button's three bars |
| Settings panel (ADR-0025) | about 20 LVGL objects with the *Settings* tab, about 30 with *Info* (four per section), none when closed; the saved choices are one record of under 100 B in NVS |
| Sound (ADR-0033) | the five tune strings (under 200 B) and a few words of state in the runtime, one LVGL input-device callback; the I2S speaker's buffer (100 ms at 16 kHz, 16 bit: 3.2 KB), the mixer's buffers and ESPHome's speaker and mixer tasks, only with `sound:` (the P4); I2S writes silence all the time |
| Rotation (ADR-0028) | a second LVGL draw buffer as large as the first while rotation is enabled in the YAML (in PSRAM on the P4 and the Guition); nothing per layout |
| Layout JSON | transient: body + ArduinoJson document, freed after parsing; the model keeps its own compact copies. Only wind rose tiles carry a `RoseConfig` |
| P4 runtime firmware, static | RAM 98,742 B (17.1 %), flash 3.37 MB (20.4 %; the settings panel with LVGL's slider and the delta counters 15.5 KB, the history popup, its circular maths and LVGL's chart widget about 40 KB of it, the graph tile 6.5 KB, the heading tape 7.1 KB, centre zero with LVGL's arc 9.8 KB, the clock and its screen saver 14.8 KB); the five full fonts (up to 144 px) are about 0.6 MB of that, the two digit fonts 197 KB |
| C3 compile check, static | RAM 112,768 B of 321,296 B (35.1 %), flash 1.48 MB of 1.8 MB (80.7 %) |

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
  14. **chart tiles**, with the charts stand-in from `startSignalK({ chartSim: true })` (generated PNG tiles):
      - a chart filling its page: tiles through the plugin, the anchor and its radius
      - recentring after a 350 m move
      - zoom in through the hook (`esphelm_tap_request map zoom_in`)
      - the anchor alarm
      - a page whose chart the server doesn't have
      - a 2x2 chart beside a rose and a 1x1 chart of the same chart (`fixtures/valid/chart-tiles.json`): each map tile fetched once, the small chart without buttons; zooming the big one fetches only its new zoom; leaving the page and coming back fetches nothing
  15. **the boot guard** (`ESPHELM_TEST_CRASH_ON=<tile id>` makes the host build abort while building that tile):
      - a fetched layout that crashes the display is skipped after one crash, refused when fetched again, and reported in the hello
      - offline, a cached layout that crashes is tried twice, then the last known good layout is shown, also after a normal restart
  16. **alarms**: a depth alarm and a battery warning show in the banner (worst first, "+1"); tapping shows the next; ACK goes to the plugin, which silences the alarm on the server; both acknowledged give the strip; an escalation to `emergency` shows the full banner again; back to `normal` clears it

  17. **display settings**: a layout with `startPage`, `autoTheme: sun` and a 10 s `screenTimeout` opens on its start page; `environment.sun` = dusk switches to night with the night brightness; the screen goes off after 10 s, an alarm switches it on, and so does a touch (`esphelm_tap_request @screen`); switching the theme on the display (`esphelm_tap_request @theme`) from night to day holds while the sun stays down and is handed back to `autoTheme` at sunrise

  17b. **settings panel** (ADR-0025): the footer's menu button (`@menu`) opens it on *Settings* (screenshots by day and at night, at 720 too), and `@settings tab-info` shows *Info* (by day, and at 720); `@settings tab-network` shows *Network* ("Set in the firmware" at 480; at 720 with `ESPHELM_TEST_SERVERS=fixed`: the server buttons, the list of two made-up servers, picking one, the *Forget server* question, *Cancel* and *Yes*); *Night* and the slider (`@settings night`, `@settings brightness=15`) are applied and saved, come back after a restart (the sun's first value doesn't undo them), and another night brightness from the editor replaces the display's; *Auto* hands the theme back; *Screen off* switches off at once; a saved record that is not valid is ignored. `ESPHELM_TEST_INFO=fixed` writes "test" for the values that change by themselves

  18. **position tiles**: the four formats of one live position (two wide tiles, two single cells in a smaller font), then a value that isn't a position (`--`)

  19. **value tile colours**: six fixed colours, a depth in its warn zone, a voltage in its alarm zone over the tile's own blue, an engine temperature in a normal zone; by day and at night

  20. **text sizes** (`fixtures/valid/value-sizes.json`): a full-width, a 2x2 and four single-cell value tiles at 480 with live values (a temperature of "500" steps down a size), and the same layout offline at 720

  21. **value history**: a tile without `history` opens nothing; a tile on page 2 without values shows "Collecting..."; the close button closes the popup; a live SOG sent every second becomes points of the graph; with a seeded curve (`ESPHELM_TEST_HISTORY`): the page with the marks, the 10 min and 1 h windows, an alarm banner over the popup, night, and the page unchanged after closing; the wind roses (a mark on the one that records, a tap on the other does nothing, its first value recording live, the popup's value buttons, the apparent wind angle and a heading tile across north without a jump); the popup and a rose's popup at 720
  21b. **zones from the server** (ADR-0020): zones put on the server replace a value tile's and a gauge's own and reach a bar without any, with no new layout fetched; a changed zone is followed; rubbish and an emptied list bring the tile's own back, pixel for pixel.
  21c. **graph tiles** (ADR-0021, `fixtures/valid/graph.json`): a live SOG becomes a line on its tile; with seeded curves, a 2x2 depth graph with a zone band, a fixed-range SOG, a heading across north and a 6 h barometer without axis labels, by day and at night; a tap opens the popup on its value; the same page offline at 720
  21d. **heading tapes** (ADR-0022, `fixtures/valid/heading-tape.json`): three tapes at 480 with live values (across north, COG right of centre, the target left, the waypoint bearing off the left edge; a magnetic 60° tape; a 1x1 tape without markers), a turn to 20°, a marker gone stale on its own, night; and offline at 720 (muted, "--", no markers)
  21e. **centre-zero gauges and bars** (ADR-0023, `fixtures/valid/center-zero.json`): a rudder and a rate of turn (port/starboard), a house current (−50…20, plus/minus) and a vertical start current, with live values one way, then the other way round, and at night; offline at 720 (no fill, "--")

  21g. **setup** (ADR-0026, offline from an empty flash, `ESPHELM_TEST_SETUP=ap|joining` standing in for Wi-Fi): the *Set up Wi-Fi* screen with its QR code, the status page's menu button opening the panel, the *Network* tab with the setup network, and "Joining Wi-Fi"
  21f. **clocks** (ADR-0024, `fixtures/valid/clock.json`, clock frozen with `ESPHELM_TEST_CLOCK=frozen`): "--" before a time arrives; `navigation.datetime` 09:05 UTC in July shown as 11:05 in Stockholm summer time, 12-hour with seconds, UTC with a dmy date, and a weekday date; night; the screen saver with the time and date after a 10 s timeout, and a touch waking it; a 2015 GPS date is ignored; offline at 720 ("--")
  21h. **mounting rotation** (ADR-0028, `fixtures/valid/rotation.json`): at 480 online, a layout with `settings.rotation: 90` turns the display and the plugin's device list shows the new `hello` (rotation 90); after a restart the cached layout turns it before its page is built; a layout without it turns it back. The 1280×800 build offline: a square layout stretched to it, the panel, then the rotation layout turns it to 800×1280 (portrait page and panel)
  21i. **wind rose performance** (ADR-0029, `fixtures/valid/rose-performance.json`): at 480 with live values, upwind on starboard tack with the laylines at the fixed beat angle and the waypoint W; SignalK's beat angle moves them and the target bar appears; downwind on port at SignalK's gybe angle; the true wind gone stale: the laylines and the bar go, A and W stay
  21j. **engine tiles** (ADR-0032, `fixtures/valid/engine.json`): at 480 with live values (1800 rpm, 3.5 bar, 40 % fuel, 85 °C, and engine hours, alternator, exhaust and fuel rate in the corners where they fit), then every needle in an alarm zone, night, the fuel level gone stale (its icon and needle muted) while the others stay live, and page 2's smaller tiles without their gauges; offline at 720 the full tile and page 2's 2x2 tiles with their gauges (labels instead of icons, a battery icon)
  Ninety-six screenshots are compared with `firmware/test/golden/*.png` (`UPDATE_GOLDEN=1` re-records them; review them by eye before committing). It needs an X display, the ESPHome CLI (`ESPHOME`), and Python with Pillow (`PYTHON`).

## Releases (ADR-0031)
`.github/workflows/release.yml` builds the P4-86, Guition 4848S040 and CYD firmware on a pushed tag and creates a **draft** GitHub release with each board's `.factory.bin` (esptool, at 0x0) and `.ota.bin` (the captive portal's upload), plus `SHA256SUMS`.

1. Bump `FIRMWARE_VERSION` in `esphelm_runtime.h` in a PR and merge it.
2. Tag the merge commit and push the tag: `git tag v0.5.0 && git push origin v0.5.0`. A tag that doesn't match `FIRMWARE_VERSION` fails before building; `v0.5.0-rc.1` makes a draft prerelease.
3. The run pins ESPHomeSignalK's `main` to one commit for every board (`-s signalk_ref <sha>`; the board files default to `main`) and names it in the notes. The P4 gets esp-hosted-firmware v2.9.3, checked against the sha256 in `hardware/waveshare-esp32-p4-86.yaml`. When that pin changes, change `ESP_HOSTED_VERSION` in the workflow with it.
4. Flash the draft's files on hardware, then publish the release.

## Hardware check (P4-86)
All steps below were checked on the P4-86 (2026-11-05). Keep them for new boards and for changes that touch them.

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
11. **Chart** (needs a SignalK charts plugin with a raster PNG/JPEG chart, e.g. MBTiles). Add a chart page (or a chart tile) in the editor, pick the chart, and Save & send.
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
15. **Day/night on the display.** Replaced by step 24 (the settings panel, ADR-0025); holding the page title does nothing any more.
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

19. **Zones from the server (ADR-0020).** Show a value tile and a gauge with live values, then edit their path's zones in the SignalK admin UI (*Data Browser → Meta Data*).
    - Within a few seconds, or about a minute at most, the tile's colour and the gauge's bands follow. The page redraws once; check that this isn't disturbing.
    - The log says `Tile <id>: <n> zones, from the server`. No `Showing fetched layout` line comes with it.
    - A value inside an alarm zone also brings the alarm banner, from the server's own notification.
    - Remove the zones: the tile's own come back.

20. **Graph tiles (ADR-0021).** Assign `packages/schema/fixtures/valid/graph.json` with a live depth, SOG, heading and pressure.
    - Each graph shows "Collecting..." for about 10 s after the layout arrives, then its line fills from the right. The page doesn't stutter every 5 s when points close.
    - The depth graph has its y range, "-10 m" and "now"; the small HDG and Baro tiles show the line only.
    - Turning across north, the HDG line stays smooth.
    - Tap a graph: the history popup opens on that value.

21. **Heading tapes (ADR-0022).** Assign `packages/schema/fixtures/valid/heading-tape.json` with a live heading, COG and, if you have them, a route and an autopilot.
    - Turning the boat scrolls the tape smoothly, without tearing, and the number matches the chart plotter's heading.
    - The COG triangle sits where the plotter draws COG. With a route active, the waypoint diamond points the way to steer; off the tape it's an arrow at the edge on the side of the shorter turn.
    - The magnetic tape shows "M" after its number.
    - At night all markers are red; check that their shapes can still be told apart.

22. **Centre-zero gauges and bars (ADR-0023).** Assign `packages/schema/fixtures/valid/center-zero.json` with a live rudder angle and battery currents if you have them.
    - The rudder needle and its fill follow the helm smoothly; the fill is red to port and green to starboard, and the value reads e.g. "12 ° P".
    - The house current bar fills left of the middle when discharging ("-30.0 A") and right when charging, and never past 20.
    - At night all fills are red; check that P and S (and − and +) can still be told apart.

23. **Clocks and the screen saver (ADR-0024).** Assign `packages/schema/fixtures/valid/clock.json` (Stockholm time, the screen saver with the time and date after 30 s) with a GPS sending `navigation.datetime`; pick your own zone in the editor's display settings first if you like.
    - The Local and 12 h tiles match your phone's clock, the UTC tile is your phone's time minus your zone's offset, and the seconds tick evenly.
    - Without touching it, after 30 s the screen dims to a faint time and date that are readable up close and change each minute; the rest of the screen is black.
    - One touch wakes it at full brightness without pressing anything under your finger.
    - Unplug the network: the clocks keep running. Reboot without the network: they show "--" until a time arrives (no clock without a source).
24. **The settings panel (ADR-0025).** On any layout (a one-page one too), the footer has a button with three bars on the right, left of **>**.
    - A tap opens the panel on its *Settings* tab, with *Info* beside it. Drag the brightness slider: the backlight follows while you drag. Let go, close the panel, and reboot: the brightness stays.
    - *Night* switches to the red theme at once and *Auto* back to the layout's (or the sun's). The night brightness slider is separate from the day one.
    - The *Info* tab shows the display's IP and Wi-Fi signal (check them against your router), the SignalK server's address, and a *Deltas* count that rises while you watch.
    - Change the night brightness in the editor and Save & send: the display takes the editor's value.
    - Check that the menu button, the slider and the three theme buttons are easy to hit with a wet thumb, and that the panel is readable at night.
25. **Setup without configuration (ADR-0026).** Erase the flash first (`esptool.py erase_flash`, or `esphome run` after an erase): this wipes the token and the layout, so the display has to be approved and adopted again.
    - **Setup screen:** it shows *Set up Wi-Fi* with a QR code, the network `esphelm-p4-` + six characters and a password. Scan the QR code with a phone camera: the phone joins, and the portal page opens (else go to http://192.168.4.1). Pick your network.
    - **Server:** the display joins, finds your SignalK server ("Looking for a SignalK server", then "Approve this display") and, once approved and adopted, shows its layout.
    - **Reboot:** it rejoins and goes back to the same server without asking for approval again.
    - **Router off:** switch the router off for 5 minutes or more after the display has connected. No `esphelm-p4-…` network appears on your phone, and the display keeps its pages with stale values.
    - **Mistyped password:** at the bottom of the panel's *Network* tab, *Factory reset* → *Yes*: the display restarts into its setup network (and must be approved again in SignalK afterwards). Enter a wrong password in the portal. Power-cycle: within about 2 minutes the setup network is back; it disappears 10 minutes after power-up.
    - **Server list:** *Change server* lists your server(s) (with the address and port); *Forget server* → *Yes* makes the display ask for approval again (new entry under *Access Requests*).
    - Check that the QR code scans from about 30 cm by day and at night.
26. **Rotation (ADR-0028).** In the editor, *Display settings → Mounted → Turned 90° clockwise*, then *Save & send*:
    - The display's picture turns clockwise and touch follows it (the buttons react where you press).
    - The editor showed the turned screen as soon as you picked it, and its size stays so after the display's next hello.
    - Power-cycle: the display starts turned, before the page appears. Set *As built (0°)* and *Save & send* to go back.
27. **Wind rose performance (ADR-0029).** Give a wind rose *Laylines* and *Waypoint* in the editor's *Performance* section (the *Wind* starter has them), with live wind and heading, and a route if you have one:
    - Close-hauled, the line for your tack (green on starboard tack, red on port) lies on the bow, and the other one shows the heading after a tack, about twice the beat angle away.
    - Bear away past the beam: the lines jump to the gybe angle, behind the beam.
    - Without a polar plugin they use the fixed angles (45° / 150°, or the ones set in the drawer); with one, they follow `performance.beatAngle` / `gybeAngle`.
    - W points at the active waypoint, as on the heading tape. Unplug the wind sensor: within 15 s the laylines go, and the rose doesn't show stale guidance.
28. **Chart tiles (ADR-0030).** Put a chart tile beside the rose (2x2) and a small one elsewhere, of the same chart:
    - Both draw around the vessel; the small one has no zoom buttons, and with anchor watch on it is framed red in an alarm.
    - Zoom the big one: only it changes, and its new zoom fills in; the small one stays.
    - Move (or drive the position): both pan smoothly, without blank flashes for tiles that stay in view. Note how a full screen of tiles draws compared with the old chart page.
    - Info tab: free PSRAM after switching between pages a few times stays put (the store keeps its tiles, it doesn't grow).
29. **Engine tile (ADR-0032).** Apply the *Engine* starter (one engine tile) with a running engine, or live `propulsion.p0.*` and `tanks.fuel.0.currentLevel`:
    - It looks like the editor's preview: the RPM arc with its coloured band, "RPM" and "x100" in the centre, oil on the left, fuel on the right, coolant at the bottom.
    - The needles follow the values smoothly; the RPM needle crosses the labels without leaving marks.
    - The icons are clear at full size; at night everything is red.
    - Unplug a sensor (or stop its value): after its stale time its needle and icon turn dim, the others carry on.
30. **Sound (ADR-0033).** Connect an 8 Ω speaker to the speaker connector (MX1.25):
    - **Touch:** a tile that opens its history, the footer's buttons and the settings panel's controls click; an empty page background doesn't, and neither does the touch that wakes a dark screen. *Settings → Touch sounds: off* silences them (and survives a reboot).
    - **Alarms:** publish `notifications.test` with `{"state":"alarm","method":["visual","sound"],"message":"Test"}`: a tone at once, then every 5 s; *ACK* stops it. `emergency` repeats without a pause; `warn` beeps twice, once. With `method: ["visual"]` it stays silent.
    - **Volume:** the *Volume* slider changes the loudness and clicks at the new volume when let go; the editor's *Display settings → Sound → Volume* applies after *Save & send* (and drops the display's own choice).
    - **Noise:** no hiss or hum from the speaker while nothing plays (the amplifier is always on). If nothing sounds at all, the pins are the first suspect (logged: `esphelm.sound` and `i2s_audio`).
