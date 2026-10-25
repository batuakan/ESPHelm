# esphelm_runtime: firmware reference

ESPHome external component in `firmware/components/esphelm_runtime/`. It shows layouts from the signalk-esphelm plugin on an LVGL display. Architecture: ADR-0007.

**Phase 3 scope:** the **first grid page**, with **`value` tiles**. Other tile types and full-page widgets are validated but shown as a placeholder. `hello.widgets` lists only `value`, so the plugin won't assign layouts that use them.

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
| `firmware/esphelm_sdl.yaml` | desktop, 480×480 | compile, run, e2e test |
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
| Value not updated within `staleAfter` | `--`, dimmed |

**Protocol** (`docs/plugin-api.md`):
1. After the token is approved and on every stream (re)connect, send `POST …/devices/hello`.
2. Subscribe to `plugins.esphelm.<deviceId>.version`. When it differs from the shown layout's ETag, `GET …/layout` with `If-None-Match`.
3. Run a fallback poll every 5 minutes.
4. If the plugin answers that the device is pending or has no layout, the screen clears.
5. If the plugin is unreachable, the cached layout stays up.

**Subscriptions** are derived from the layout (one listener per unique tile path). ESPHomeSignalK batches changes: additions are an incremental subscribe; a removal is unsubscribe-all followed by a full resubscribe, and the server replays cached values.

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
| `value` tile (LVGL objects) | **≈2.0 KB** on the 64-bit host build (24 tiles = 49,136 B, logged at DEBUG by the renderer). Not measured on ESP32; pointers are half the size there, so expect less. |
| Layout JSON | transient: body + ArduinoJson document, freed after parsing; the model keeps its own compact copies |
| P4 runtime firmware, static | RAM 93,524 B (16.2 %), flash 2.6 MB (15.7 %) |
| C3 compile check, static | RAM 107,592 B of 321,296 B (33.5 %), flash 1.17 MB of 1.8 MB (63.7 %) |

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
  8. the cached layout appears on a reboot without a server

  Six screenshots are compared with `firmware/test/golden/*.png` (`UPDATE_GOLDEN=1` re-records them). It needs an X display, the ESPHome CLI (`ESPHOME`), and Python with Pillow (`PYTHON`).

## Hardware check (P4-86)
Flash with `~/venv/bin/esphome run firmware/esphelm_p4.yaml`, then check:
1. The display shows **"Approve this display in SignalK"**. In the SignalK admin UI, *Security → Access Requests* lists "ESPHome device: esphelm-p4" asking for read/write. Approve it.
2. Within a few seconds the screen shows **"Adopt this display in ESPHelm"** with the device id. `GET /plugins/esphelm/api/devices` lists it as pending.
3. Adopt it and assign a layout (e.g. `packages/schema/fixtures/valid/grid-2x2-values-480.json`). The grid appears without a reboot, and the values update and are converted.
4. Unplug the SignalK server's network. After `staleAfter` the values show `--`, and the layout stays up.
5. Power-cycle the display with the server still unreachable. The same layout comes back immediately.
6. Watch the log for `Grid page …: N bytes of LVGL objects`; that's the real per-tile memory on the P4.
