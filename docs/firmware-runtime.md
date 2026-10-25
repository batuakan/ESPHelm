# esphelm_runtime: firmware reference

ESPHome external component in `firmware/components/esphelm_runtime/`. It shows layouts from the signalk-esphelm plugin on an LVGL display. Architecture: ADR-0007.

**Scope (Phase 5c):** every page of the layout, with `value`, `gauge`, `bar`, `switch`, `wind_rose` and `autopilot` tiles. `hello.widgets` lists exactly these, so the plugin refuses to assign a layout that needs anything else (chart/anchor comes in Phase 5d).

## Configuration

```yaml
external_components:
  - source: { type: local, path: ../../ESPHomeSignalK/components }
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
  board: waveshare-esp32-p4-86    # reported in hello
  touch: true
  stale_after: 15s                # default when a tile sets no staleAfter
  # max_layout_bytes: 65536       # override the computed capacity
  # store_dir: "."                # host build only: where the cache files go
```

Ready-made configs:

| File | Target | Status |
|---|---|---|
| `firmware/esphelm_sdl.yaml` | desktop, 480×480 | compile, run, e2e test. Test hooks: `esphelm_shot_request <file>`, `esphelm_page_request <n>`, `esphelm_tap_request <tile> [button]` (autopilot buttons: `-10 -1 +1 +10 auto wind route standby`), `esphelm_exit_request` |
| `firmware/esphelm_sdl_720.yaml` | desktop, 720×720 with the P4-86 font sizes | compile, offline render check in the e2e test |
| `firmware/esphelm_p4.yaml` | Waveshare ESP32-P4-86, 720×720 | compiles; **not yet run on hardware** |
| `firmware/esphelm_c3_compile_check.yaml` | ESP32-C3 + 240×240 GC9A01A (placeholder pins) | compile-only check |

The P4 and C3 configs need `firmware/secrets.yaml` (`wifi_ssid`, `wifi_password`, `signalk_host`); a symlink to `../legacy/secrets.yaml` works.

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

**Protocol** (`docs/plugin-api.md`):
1. After the token is approved and on every stream (re)connect, send `POST …/devices/hello`.
2. Subscribe to `plugins.esphelm.<deviceId>.version`. When it differs from the shown layout's ETag, `GET …/layout` with `If-None-Match`.
3. Run a fallback poll every 5 minutes.
4. If the plugin answers that the device is pending or has no layout, the screen clears.
5. If the plugin is unreachable, the cached layout stays up.

**Subscriptions** are derived from the **visible page** (one listener per unique path of its tiles, including each wind rose's sources and slots), plus the layout version path. ESPHomeSignalK batches changes: additions are an incremental subscribe; a removal is unsubscribe-all followed by a full resubscribe, and the server replays cached values. So a page shows the latest values as soon as it is opened.

## Pages and the footer (ADR-0009)
- **Only the visible page exists.** Changing page deletes its LVGL objects and widgets and builds the next one, so memory stays at one page's worth (matters on C3/C6 without PSRAM).
- The footer appears only when the layout has more than one page. Its height is 2.2 × the small font's line height (52 px with the 480² fonts). Presses are applied from `loop()`, never inside the LVGL event, because rebuilding the page deletes the button that was pressed.
- The page index survives a layout update with the same layout id (clamped if pages were removed). A new layout id starts at page 1. A reboot starts at page 1.
- There is no swiping; the legacy apps keep theirs.

## Widgets
All widgets are pure functions of (config, latest value, theme), redraw at most every 250 ms and only when something changed. Colours come from the theme (`colors_for`): day is the dark-blue palette, night is red on black with zones differing in brightness, not hue.

| Widget | Drawn with | Notes |
|---|---|---|
| `value` | labels | as before |
| `gauge` | `lv_scale` (270°, round inner), zone sections, line needle | the value and unit sit in the open bottom of the arc; below 240 px the value uses the small font, below 160 px tick labels and the unit are dropped |
| `bar` | `lv_bar` | indicator colour follows the zone the value is in; vertical bars put the unit under the value |
| `switch` | `lv_switch` | a tap sends a PUT of the new boolean (needs the read/write token). The switch shows the requested state at once and then follows the path's value; without a confirming value within 5 s it reverts and shows `!` |
| `wind_rose` | `lv_scale` 0–360 (bow at top), close-hauled sectors 20–60°, pointer lines | apparent wind pointer from `apparentAngle`; true wind pointer from `trueDirection − heading` when `showTrueWind`; "HDG x°"; slots `center1..3` stacked in the middle. Pointers cover the outer third of the radius so the slots stay readable. Size tiers below |
| `autopilot` | labels and `lv_button`s | state (AUTO / WIND / TRACK / STANDBY), "TGT x°" and "HDG x°"; course buttons −10/−1/+1/+10, the configured mode buttons and STANDBY (on its own wide row when it wouldn't fit a quarter of the width). Rules below |

**Wind rose size tiers** (`esphelm_sizes.h`, generated from `WIND_ROSE_FIT` in `packages/schema`, ADR-0010). The rose measures the shorter side of its cell after layout:
- **full** (≥ 260 px): tick labels every 30°, heading, slots. Slot values use the label font if all slots fit that way, else the small font.
- **compact** (≥ 150 px): ticks every 30° without labels, no heading, thinner sectors; as many slots as fit (small font if needed).
- **pointers** (< 150 px): ring, sectors and pointers only.

Pointer and sector widths scale with the rose. Zone styles are kept per (state, arc width), so a gauge and a rose on the same page keep their own arc widths.

**Autopilot rules** (ADR-0011):
- **Engage:** the first tap on AUTO / WIND / TRACK arms it ("AUTO?", accent colour, "tap AUTO again to engage"). A second tap within 3 s sends a PUT of the mode to `statePath`. The arm expires after 3 s, and any other button cancels it. The request shows as "sending …" until the state value matches; after 5 s it shows "no response from the autopilot".
- **STANDBY** PUTs `standby` on one tap.
- **Course buttons** PUT ±1 / ±10 (a number, degrees) to `adjustPath`. They're enabled only while the state is fresh (within the default stale time) and not `standby` / `off` / `disabled`.
- **Offline** (no SignalK connection): every button is disabled, and the tile says "offline".
- **Size:** below `AUTOPILOT_FIT` (260×220 px of content) the tile shows status only, with no buttons. In narrow tiles TGT and HDG stack; in tiny ones HDG is dropped.
- Disabled buttons use the theme's dark colours (LVGL's grey recolour is turned off; this applies to the footer buttons too).

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
| `wind_rose` tile | ≈4.5–6.5 KB (full screen at 480: 6,576 B; 720 page with a 2x2 rose and five tiles: 18,288 B) |
| `autopilot` tile | ≈11 KB with its 11 buttons (full screen at 480: 10,992 B); a status-only tile builds the same objects and hides the buttons |
| Footer | not counted above (built before the measurement starts); a few hundred bytes |
| Layout JSON | transient: body + ArduinoJson document, freed after parsing; the model keeps its own compact copies. Only wind rose tiles carry a `RoseConfig` |
| P4 runtime firmware, static | RAM 94,276 B (16.4 %), flash 2.65 MB (16.1 %) |
| C3 compile check, static | RAM 108,320 B of 321,296 B (33.7 %), flash 1.23 MB of 1.8 MB (66.8 %) |

Widget figures are logged at DEBUG by the renderer per page (`Page n/m "id": k widgets, N bytes`) on the 64-bit host; on ESP32 pointers are half the size, so expect less.

The heap left on a C3 at runtime (after Wi-Fi and the 10 % LVGL buffer) hasn't been measured, because there's no C3 hardware yet.

## Tests
- `npm test` includes `firmware/test/parser.cpp.test.ts`. It compiles the parser with g++ (`-Wall -Wextra -Werror`) against the vendored ArduinoJson 7.4.3 (`firmware/test/third_party/`, MIT) and compares it with `validateLayout` on every fixture and on mutations. It also covers the device-only guards.
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

  Twenty-two screenshots are compared with `firmware/test/golden/*.png` (`UPDATE_GOLDEN=1` re-records them; review them by eye before committing). It needs an X display, the ESPHome CLI (`ESPHOME`), and Python with Pillow (`PYTHON`).

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
