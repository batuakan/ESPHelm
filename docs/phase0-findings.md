# Phase 0 findings: runtime-configurable ESPHelm

Status: **draft for review** · Date: 2026-10-24 · Scope: recon only, no feature code.

## Executive summary

1. **The architecture in CLAUDE.md holds**, with one correction (auth/route placement, §5) and one required upstream change (dynamic subscriptions in ESPHomeSignalK, §3).
2. **Runtime LVGL construction works.** A host (SDL) spike built a 2×2 grid of tiles from C++ inside a YAML-declared container, screenshotted it and destroyed it cleanly (§4.7). On-device behavior is not verified yet.
3. **Trap found:** ESPHome compiles LVGL with *only the widgets/layouts the YAML uses*. The runtime must force-enable its catalog (`LV_USE_LABEL`, `LV_USE_GRID`, …) or its code does not compile (§4.2).
4. **SignalK server only supports unsubscribe-all.** A per-path unsubscribe makes the server **close the WebSocket** (verified). Dynamic subscriptions = "unsubscribe all, resubscribe full set" (§3.2, ADR-0004).
5. **`/plugins/<id>/*` routes require admin when security is on** (verified 401). Device endpoints cannot live at `/plugins/esphelm/api/devices/...` with a read token. They need a different mount, so CLAUDE.md §3 needs a correction (§5.2, ADR-0003).
6. ESPHomeSignalK already implements the SignalK **access-request token flow** and stores the token in NVS. We can reuse it for device auth.
7. ESPHomeSignalK has **thread-safety and memory-safety bugs** that a dynamic runtime would make worse. Examples: WebSocket callbacks mutate state from the IDF websocket task, an unbounded `memcpy` into a 1 KB stack buffer, and the token is logged at INFO (§3.6).
8. **Persistence:** store the layout in **NVS via the IDF API** (current + last-known-good blobs). No partition-table change is needed, so OTA keeps working (ADR-0002).
9. **Schema:** TypeBox (ADR-0001). **No fixed schema limits in v1** (decision 2026-10-24). Each device enforces memory-derived capacity guards and reports them in `hello` (§6.2).
10. **The existing builds broke on ESPHome 2026.9.1 and are now fixed** (§7). The causes were an LVGL 8→9 API change in ESPTiles and `notification.yaml`, removed ESPHome APIs, stricter meter validation, and the string-PUT codegen.
11. Target hardware is **ESP32-P4 (720×720), ESP32-S3 + PSRAM (480×480) *and* ESP32-C3/C6 (no PSRAM)**. C3/C6 are in scope (decision 2026-10-24) and set the low-memory design floor (§4.8). No C3/C6 display board file exists in the repo yet.

### Decisions recorded 2026-10-24 (answers to the Phase 0 questions)

| # | Decision |
|---|---|
| 1 | ESPHomeSignalK: local WIP stashed (`stash@{0}`), checkout fast-forwarded to upstream `main` `0100a70`. |
| 2 | A device **must** hold an approved SignalK access token, with **read/write** permission. No anonymous device access. |
| 3 | C3 and C6 remain **in scope**. |
| 4 | **No hard layout limits** defined yet. |
| 5 | Fonts stay as they are. Runtime text is limited to **ASCII + `°`**. |
| 6 | Fix the three existing builds (done, §7). |
| 7 | `.gitignore` extended and `LICENSE` committed (`929ca26`). |

---

## 1. Repository inventory

Git state: branch `esphelm_runtime`, 5 commits, many untracked files (see `git status`). Top level:

| Path | Purpose |
|---|---|
| `MFD.yaml` | Main device config for Waveshare ESP32-P4-86 (720×720): packages for hardware, fonts, theme, SignalK and apps (chart, weather, wind, energy, settings). **Fails `esphome config`** (§7). |
| `SDL_480.yaml`, `SDL_720.yaml` | Desktop (host/SDL2) builds at 480/720 for development and screenshots. |
| `c6.yaml` | Bare P4 + esp32_hosted (C6) Wi-Fi bring-up config ("Sunton…" project name is stale). |
| `MVVM.yaml` | SDL 720 config with only the tank levels app (experiment). |
| `Tile.yaml` | SDL 720 chart experiment; references non-existent `modules/sensors/signalk_base.yaml` and `modules/sections/globals.yaml` (broken, dead). |
| `server.py` | Flask proxy: fetches PNG chart tiles from a **hard-coded LAN SignalK** (`server.py:9`) and converts to RGB565 (`server.py:12-17`). It is the predecessor of the `signalk-rgb565-proxy` plugin, which `chart.yaml:13` now uses. **Not relevant to this initiative.** Candidate for `legacy/`. |
| `modules/hardware/` | Board files: P4-86 (MIPI-DSI 720²), three Waveshare/Guition S3 boards (480², octal PSRAM), SDL. |
| `modules/base/` | Shared: fonts (480/720), themes (dark/light), globals, swipe navigation, SignalK component include, Wi-Fi, settings (unit substitutions), images, audio, webserver, top layer. |
| `modules/applications/` | One file per page: wind, grid, energy, engine, chart (+anchor), autopilot(+2, WIP), switchboard, weather, tank_levels (WIP), settings, vevor (BLE heater, unrelated). |
| `modules/components/` | Reusable YAML "widgets" via `!include` + `vars`: grid_element, label_withdescription, icon_withvalue, digital_switch, tank_level, notification, weather_forecast, top_touch_detector. |
| `modules/screens/` | Untracked mock screens (boot, engine, tanks, hvac). |
| `modules/sensors/`, `modules/scripts/` | HA sensors, IMU, template sensors; backlight script. |
| `modules/assets/` | Fonts, SVG/PNG icons (**LFS-tracked** per `.gitattributes`). |
| `components/sdl_screenshot/` | ESPHome external component: `take_screenshot()` reads the SDL renderer and saves a BMP (`sdl_screenshot.cpp:19-44`). Includes `stb_image_write.h` (public domain). |
| `docs/images/` | README screenshots. |
| `.vscode/` | `tasks.json` (esphome compile current file), `launch.json` (gdb on host binary `.esphome/build/sdl2/.pioenvs/sdl2/program`). |
| `ESPHelm.code-workspace` | Multi-root workspace: ESPHelm + `../ESPHomeSignalK` + `../ESPTiles`. |
| `Mount.FCStd`, `*.FCBak` | FreeCAD enclosure/mount model. |
| `network_adapter_esp32c6.bin` | esp32_hosted coprocessor firmware, embedded by `update:` in the P4 hardware file. |
| `out.txt` | Dump of a resolved config (`esphome config` output). Scratch. |
| `token` | **A SignalK token file** written by the host build (`ESPHomeSignalK/.../signalk_x86.cpp:279-295`). **Not gitignored.** Contents not read. |
| `secrets.yaml` | Gitignored. Not read. |

### Licenses

| Project | License | Evidence |
|---|---|---|
| ESPHelm | MIT © 2025 batuakan | `LICENSE` (untracked!) |
| ESPHomeSignalK | MIT | `ESPHomeSignalK/LICENSE` |
| ESPTiles | README says MIT, **no LICENSE file** | GitHub repo listing; local checkout has none |
| signalk-rgb565-proxy | Apache-2.0 | `SignalKRGB565Proxy/LICENSE`, `package.json` |
| ESPHome | C++ runtime **GPLv3**, Python MIT | `esphome/LICENSE:5-8` |
| LVGL | MIT | (well known; not re-checked) |
| signalk-server, @signalk/server-api | Apache-2.0 | `package.json` |
| Tessera (UX reference) | AGPL-3.0 | CLAUDE.md. **Source was deliberately not opened.** |

**Compatibility:** no conflict.
- The firmware links ESPHome's GPLv3 C++, so *distributed firmware binaries* are GPLv3 combinations. MIT source in `esphelm_runtime` is compatible, but anyone shipping binaries must honor GPLv3 for them.
- The TS plugin and editor are separate programs talking over HTTP. MIT with Apache-2.0 deps is fine.
- Actions: add a LICENSE file to ESPTiles, and commit ESPHelm's `LICENSE` (currently untracked).

## 2. How the UI is built today

**Pages and navigation.** Each app file appends one page under `lvgl: pages:` (e.g. `wind.yaml:136-141`). Every page merges `modules/base/swipe_navigation.yaml` with `<<: !include`:
- Swipe left/right does `lvgl.page.next/previous` (`swipe_navigation.yaml:3-14`).
- Swipe down opens the settings page with a raw `lv_scr_load_anim` (`:22-37`), but only if the swipe began on a 20 px "top touch detector" strip (`components/top_touch_detector.yaml`, `globals.yaml:1-5`).

Page order = package order in the top-level YAML.

**Shared pieces.**
- Theme: `lvgl: theme:` in `theme_dark.yaml` / `theme_light.yaml`. Debug red outlines are still on for `obj` (`theme_dark.yaml:8-9`).
- Fonts: semantic size names (`roboto_Huge`, `_LARGE`, `_large`, `_normalsize`, `_small`, `_scriptsize`, `_tiny`) with per-resolution pixel sizes in `fonts_720.yaml` / `fonts_480.yaml`, plus MDI icon glyphs as `extras`.
- Globals: swipe state, `last_screen`.
- Unit choice: substitutions in `base/settings.yaml:1-4`.
- Background: a background image per page.

**Data binding.**
- One `sensor: platform: signalk` per path per app. The same path is re-declared in several apps (e.g. SOG in `wind.yaml:98` and `grid.yaml:28`).
- `on_value` pushes into widgets with `lvgl.label.update` / `lvgl.indicator.update`.
- Objects (position, notifications) arrive as **JSON strings in text_sensors** and are re-parsed in lambdas (`chart.yaml:65-90`, `notification.yaml:8-40`).

**Resolution independence today** is compile-time only:
- `screen_width/height` substitutions come from the hardware file, and app sizes derive from them (`wind.yaml:1-5`, `autopilot.yaml:3-5`, `grid_element.yaml:2-4`).
- Images are rasterised at build size (`wind.yaml:113-134` `resize:`).
- Fonts are chosen by **manually editing `fonts.yaml:2-4`** (720 hard-wired). SDL_480 includes `fonts_480.yaml` directly.
- Hard-coded pixels:
  - `digital_switch.yaml:21-31` (52/96/48)
  - `switchboard.yaml:2-3` (64/8)
  - `grid_element.yaml` paddings/radius
  - `wind.yaml:203-222` (y offsets)
  - `top_touch_detector.yaml` (20 px)
  - `toplayer.yaml:60-66`

**Mapping to planned widgets.**

| Existing | Planned widget | Fit |
|---|---|---|
| `grid_element` (label + big value + unit) | `value` | **Clean.** It already is the value tile. |
| `label_withdescription` (wind page centre stack) | `value` (compact variant) | Clean |
| engine/energy/tanks meters with arcs (zones) + needle | `gauge` (lv_scale + lv_arc sections + needle line) | Good. ESPHome's `meter` is itself an emulation on `lv_scale` in LVGL 9 (`lvgl/widgets/meter.py:104-112`). |
| tank_level, SoC bar | `bar` | Clean |
| `digital_switch` (switchboard; **not bound to SignalK today**) | `switch` (PUT + state feedback) | Clean UI, new data path |
| wind page (rose + 2 rotating image needles + arcs) | `wind_rose` | Medium/hard |
| chart heading/rose | `compass` | Medium |
| autopilot buttons → PUT | `autopilot` (full page) | Medium. String PUTs currently don't compile (§3.4). |
| chart/anchor | `chart_anchor` (full page) | Hard |
| weather/clock | ? | Hard (data source) |

**Hardest three to generalize:**
1. **chart_anchor.**
   - It depends on ESPTiles (its own worker task, LVGL image buffers, a meters↔pixels projection).
   - Several lambdas cross-wire widgets (`chart.yaml:37-110`).
   - There is a hard-coded LAN tile URL (`chart.yaml:13`).
   - Geographic objects arrive as JSON strings.

   This is a full-page widget with internal state. It violates "widgets are pure functions" unless ESPTiles is wrapped as a self-contained widget.
2. **wind_rose / compass.**
   - They rely on SVG→bitmap images pre-sized at compile time (`wind.yaml:113-134`), with needle pivots computed from the build size (`:178-191`).
   - At runtime the tile size is unknown, so we need vector drawing (lv_scale + lv_line/triangles) or `lv_image_set_scale` (CPU cost on S3).
   - Signed (−180..180) vs unsigned angle handling is buried in lambdas (`wind.yaml:62-65`).
3. **weather/clock.** The data comes from **Home Assistant** (`weather.yaml:1-2,136-200`), uses image icon sets plus MDI glyphs, and has no SignalK source. This is blocked on open questions #2/#3.

## 3. SignalK integration audit (ESPHomeSignalK)

**Which copy is built.** `modules/base/signalk.yaml:1-9` uses the **local** checkout `/home/batu/dev/ESPHomeSignalK/components`. The GitHub source is commented out; `esp32-s3-touch-lcd-1.28c.yaml:45-47` still uses `github://…@main`.
- The local HEAD is `ac73c5f`, with ~146 lines of **uncommitted** changes: sensor→delta publishing (`register_sensor`), metadata on `publish_delta`, ArduinoJson 7.4.3.
- Upstream `main` is 3 commits ahead (`0100a70`, 2026-10-20). Those are build-only fixes: IDF guard `USE_ESP32_FRAMEWORK_ESP_IDF`, the `esp_websocket_client` 1.8.0 component, and `synchronous=False` on actions.
- Neither line touches subscription logic, so **no architectural divergence**. A third, older copy lives in `~/dev/esphome/esphome/components/signalk` (`sync.sh`). It is unused by ESPHelm.
- **Update 2026-10-24:** the local WIP is stashed as `stash@{0}` ("local WIP before switching to upstream main"), and the checkout is now upstream `main` `0100a70`.
  - One fix on top, **uncommitted**: string/bool constants for `put_request`/`publish_delta` (§3.4).
  - The stash contains features ESPHelm doesn't use: `signalk: sensors:` publishing, and `meta:` on `publish_delta`.

Line numbers below were taken at `ac73c5f` + WIP. For the code regions cited, upstream `main` is identical apart from the guard/include changes listed above.

### 3.1 How subscriptions are declared
- **Compile time.** Each YAML `sensor/text_sensor/switch` codegens `parent.subscribe(var)` (`sensor/__init__.py:57`).
- `subscribe()` appends to `std::vector<SignalkSubscriber*> sensors_` (`signalk.h:57-65, 89`). There is no `unsubscribe`.
- The subscription message is built **only in `on_connected()`** from the whole vector (`signalk.cpp:63-84`). Calling `subscribe()` after connect stores the sensor but never tells the server.
- Each row sends `period`, `format`, `policy`, `minPeriod` (`signalk.cpp:73-77`). Note that `policy: ideal` is accepted by the YAML schema (`__init__.py:43`) but signalk-server ignores it with an error (`subscriptionmanager.js:148` in 2.17.2).

### 3.2 Can paths be (un)subscribed at runtime?
Not today. Server-side facts, **verified against a dev server (2.17.2)** with a WS probe:
- **Additive** subscribe messages on an open stream work; both sets are then delivered.
- **Per-path unsubscribe is rejected *and the server closes the socket*.** Response: `"Only '{"context":"*","unsubscribe":[{"path":"*"}]}' supported…"`, then `primus::server::close`. Code: `subscriptionmanager.js:82-96` (2.19.0, same in 2.17.2).
- `{"context":"*","unsubscribe":[{"path":"*"}]}` followed by a new subscribe yields **only** the new set.
- The server **replays cached latest values** on subscribe (`subscriptionmanager.js:151-154`), so a resubscribe immediately repopulates tiles.

**Required change (ADR-0004), est. 150–250 LOC in ESPHomeSignalK:**
- A runtime listener API: `add_listener(path, cb)` / `remove_listener(id)`, or `set_dynamic_paths(set)`.
- Diffing: additions → incremental subscribe. Removals → unsubscribe-all + full resubscribe (static YAML sensors ∪ dynamic).
- A mutex/queue so all state changes and callbacks happen on the ESPHome main loop.

### 3.3 Connection, auth, reconnect
- **ESP-IDF transport:** `esp_websocket_client` to `ws://host:port/signalk/v1/stream?subscribe=none` (`signalk.cpp:44,49`; `signalk_esp_idf.cpp:140-163`). **Plain `ws://` / `http://` only** (`signalk_esp_idf.cpp:202,237`). No TLS.
- **Auth:** two modes.
  - Username/password login (`signalk.cpp:99-136`).
  - **Access request** (default), which is fully implemented:
    1. POST `/signalk/v1/access/requests` with `clientId = MAC-derived UUID` (`signalk.cpp:150-157`, `utils.h:368-383`).
    2. Poll the href (`:183-218`).
    3. Store the token in ESPHome preferences under a fixed key `10000` (`:243-271`; the per-host hash is computed but unused, `:246,259`).
    4. Validate by expecting HTTP 426 on GET `/signalk/v1/stream` (`:220-241`).
  - The bearer token is sent on WS (`signalk_esp_idf.cpp:149-155`) and HTTP GET (`:248-254`). The POST path sends no auth (`:213-217`).
  - **Verified:** the access request returns `{"state":"PENDING",…}` on a security-enabled 2.17.2 dev server.
- **Reconnect:** relies on esp_websocket_client's built-in auto-reconnect.
  - `isconnected_` is set when the client *starts* and never cleared on disconnect (`signalk_esp_idf.cpp:160`; the DISCONNECTED event only calls `on_disconnected()`). So `is_connected()` stays true while the socket is down, and `connect()` isn't called again.
  - That happens to work, but `connect()` would leak the previous client if it ever were called again (no destroy).
- **Host transport:** IXWebSocket (`signalk_x86.cpp`). The token is saved to `./token` in the CWD (`:279-295`). That is the stray `token` file in this repo.

### 3.4 Values and PUT
- **Values** go to typed subscribers (`SignalKSubscriberTemplated<T>::set_value`, `signalk_subscriber.h:235-245`) and are published to ESPHome entities in the polling `update()` (`sensor/signalk_sensor.cpp:12-18`).
  - Text sensors receive `value.as<std::string>()`. For objects that is serialized JSON, hence the lambda re-parse in apps.
  - Matching: every incoming value is compared against **all** subscribers twice, exact then prefix-wildcard (`signalk.cpp:287-321`). That is O(values × subscribers).
- **PUT** goes over the WebSocket as `{"context":"vessels.self","requestId":…,"put":{path,value}}` (`signalk.cpp:330-352`).
  - The PUT response/result isn't tracked, so there's no success or failure feedback for a `switch` widget.
  - **String values didn't compile:** `put_request_to_code` templated `value` as `cg.float_` (`__init__.py:246`). This broke `autopilot.yaml:157-158` and `autopilot2.yaml:226,273`.
    - **Fixed (uncommitted, ESPHomeSignalK):** constants are now typed `DeltaValue` and emitted as an explicit `std::string(...)`, `float` or `bool` (helper `delta_value_templatable`). Lambdas are unchanged.
    - Verified: generated code `-> signalk::DeltaValue { return -10.0f; }`, and `SDL_720` compiles.
- **How a runtime widget would bind:** the runtime registers a listener per unique layout path. It receives `(path, JsonVariant)` on the main loop, converts with the shared unit table, and pushes to each bound widget's `update(value)`. PUT goes through a C++ `put_request(path, variant)` that already exists.

### 3.5 Memory/CPU with many subscriptions
- Per message: a full `std::string` copy (`signalk_esp_idf.cpp:70`), a fresh `JsonDocument` (`signalk.cpp:275`), and a DEBUG log of the whole payload (`:274`, enabled in the local tree).
- **Only `updates[0]` is processed** (`signalk.cpp:278`). Multi-update deltas silently drop data.
- **WebSocket frames are not reassembled.** The handler ignores `payload_offset` / `payload_len` (`signalk_esp_idf.cpp:67-71`), and the IDF client's default buffer is 1 KB (no `buffer_size` set in `connect`). Messages >1 KB (notifications, big metas) are parsed as fragments and fail.
- With 64 paths at 5 Hz: ~320 values/s × 64 × 2 string compares ≈ 40 k compares/s. That's acceptable on P4/S3 but wasteful. A `std::unordered_map<path, listeners>` fixes it.
- No hard limits exist. The subscription message for 64 paths is ~6 KB of JSON (estimate).

### 3.6 Defects to fix before or with Phase 3 (ranked)
1. **Data race:** `on_connected/on_message/on_disconnected` run in the esp_websocket_client task (`signalk_esp_idf.cpp:55-77`) and mutate subscriber state the main loop reads, with no lock. `std::string` text values race for real. A runtime that mutates the listener set from the main loop would turn this into a crash risk.
2. **Stack buffer overflow:** HTTP GET/POST copy the response into a 1024/512 B stack buffer with unbounded `memcpy` (`signalk_esp_idf.cpp:91-95, 199, 234`). Reusing this client for a layout fetch would overflow. The layout fetch must not use it.
3. **Secrets in logs:**
   - The token is logged at INFO/WARN (`signalk.cpp:215, 250, 265`; `signalk_esp_idf.cpp:252`).
   - Password at DEBUG (`signalk.cpp:116`).
4. Fragmented WS frames (§3.5), and `updates[0]` only.
5. **Unit table bugs** (`unit_conversions.cpp`):
   - **Length is not converted in either direction.** No `UNIT_FEET/NAUTICAL_MILES/…` cases, so `unit: nautical_miles` silently shows metres.
   - **Volume base is treated as litres** (`unit_conversions.h:86-89`), but the SignalK SI base is m³.

## 4. Firmware feasibility

### 4.1 Versions
ESPHome **2026.9.1** (`/home/batu/venv/bin/esphome version`; P4 file requires `min_version: 2026.1.1`). LVGL **9.5.0** (`lvgl/__init__.py:160`; as IDF component on ESP32, PlatformIO lib on host, `:332-335`). ArduinoJson **7.4.3** (`json/__init__.py:21`; ESPHomeSignalK pins the same).

### 4.2 Calling `lv_*` from an external component
- Works: `#include "lvgl.h"`. ESPTiles already does this (`ESPTiles/components/esptiles/esptiles.h:9`), as does the spike.
- **Pitfall (verified):** ESPHome generates `lv_conf.h` enabling only features used in YAML. In the spike, `lv_label_create`, `LV_LAYOUT_GRID`, etc. were **undeclared** until enabled.
- Two ways to enable them:
  - **Public:** `-DLV_USE_<X>=1` build flags. These are honored and excluded from the zeroed defines (`lvgl/__init__.py:170-200`); the spike compiled once they were added.
  - **Internal:** `lvgl.defines.add_lv_use(...)` (`defines.py:88`, consumed at `lvgl/__init__.py:499-501`). Cleaner from `__init__.py`, but it is a private API.
- Recommendation: the runtime's `__init__.py` adds the needed `LV_USE_*` for its catalog via `cg.add_build_flag`, with `DEPENDENCIES = ["lvgl"]`.

### 4.3 Runtime create/destroy alongside `lvgl:`
- LVGL is **single-threaded**, driven by `LvglComponent::loop()` → `lv_timer_handler()` (`lvgl_esphome.cpp:881-908`). There is no LVGL mutex in ESPHome, so **every `lv_*` call must happen on the ESPHome main loop** (component `loop()`/`update()`/callbacks). Network work goes in a worker task that hands results over via a queue, which is the ESPTiles pattern (`esptiles_espidf.cpp:42-100`).
- Pages: `add_page` exists but there is **no remove** (`lvgl_esphome.cpp:228-233`), and pages are indexed by the swipe actions. **Safest approach:** YAML declares one (or a few) host page(s) with a full-size container (`id: runtime_host`). The runtime builds all tiles inside it, and does its own multi-page via `lv_tileview` or by swapping child containers. Rebuild = `lv_obj_clean(host)` and build again. Verified on host.
- Lifetimes and memory:
  - Styles: shared `lv_style_t` (theme) must be static/long-lived and only freed after all objects using them are deleted. Prefer one static style set per theme plus `lv_obj_set_style_*` locals; locals die with the object.
  - **Never keep raw `lv_obj_t*` across a rebuild.** Widget instances must be owned by the runtime and invalidated on `lv_obj_clean` (use `LV_EVENT_DELETE`).
  - LVGL allocations already prefer PSRAM (`lvgl_esphome.cpp:1056-1105`).
- Fonts: only fonts compiled in YAML exist. The runtime should reference a **fixed set of semantic font IDs** (like today's Huge…tiny) passed from YAML. The default glyph set `GF_Latin_Kernel` (116 glyphs) contains ASCII and `°` but lacks `äöåµ±` (checked with `esphome_glyphsets`).
  - **Decision: runtime text is ASCII + `°` for now. Fonts are unchanged.**
  - The schema should restrict labels to that charset, so the editor rejects other characters instead of the device rendering blanks.
  - The firmware should replace any glyph a font lacks with `?` as a last line of defence.
- Pause/idle: `lvgl.pause` on backlight-off (P4 hardware file). Updates while paused are fine; invalidations accumulate.

### 4.4 JSON parsing
- ArduinoJson 7 is already present. ESPHome provides `SpiRamAllocator` (`json/json_util.h:123`) so documents can live in PSRAM.
- ArduinoJson 7 always copies strings (deduplicated). Estimate the doc at ~1–2× input, so a 64 KiB layout is ~64 KiB buffer + ~100 KiB doc transiently in PSRAM (estimate, not measured).
- Recommended:
  1. Read the HTTP body into a size-capped PSRAM buffer (reject if `Content-Length` > limit, or on overflow).
  2. `deserializeJson` with `DeserializationOption::NestingLimit(8)` and the PSRAM allocator.
  3. **Validate into compact C++ structs** (fixed-size strings, enums).
  4. Free the doc.
  5. Build LVGL from the structs.

  A streaming parser isn't needed at 64 KiB on PSRAM boards.

### 4.5 Persistence: NVS (ADR-0002)
- The IDF default NVS partition is 448 KiB (`esp32/__init__.py:3069`; the current MFD build has `0x6D000`, `.esphome/build/mfd/partitions.csv`).
- ESPHome explicitly excludes the SPIFFS/LittleFS IDF components (`esp32/__init__.py:270,310`). A filesystem would mean a new component **and a partition-table change, which OTA can't deliver**.
- ESPHome's `preferences` are fixed-size and **deferred** (`flash_write_interval: 5min`, `waveshare-esp32-p4-86.yaml:72`). They're unsuitable for a 64 KiB blob that must survive a reboot right after save.

### 4.6 HTTP client
- `http_request` exposes a C++ API with request headers and **collected response headers** (needed for `ETag`) (`http_request/http_request.h:334-340`). It is blocking on the caller's thread, and has a 1 kB default response buffer for actions (`__init__.py:281`).
- Recommendation: the runtime does its own `esp_http_client` fetch in a worker task, with a bounded PSRAM buffer, `If-None-Match`, `Authorization: Bearer`, timeouts and capped retries/backoff. Implement it behind a small interface with an IXWebSocket/`ix::HttpClient` (or `http_request` host) backend for SDL. Don't reuse ESPHomeSignalK's HTTP helpers (§3.6-2).
- HTTPS: none of today's stack does TLS. LAN-only `http://` matches the "no cloud" rule; document it as a known limitation.

### 4.7 SDL host build and screenshots (spike, verified)
- Prerequisites are present: SDL2 2.30.0 and `/usr/local/lib/libixwebsocket.a`.
- A self-contained probe (`host`, `display: sdl`, one page with an `obj` container, `sdl_screenshot` from this repo) built four tiles at runtime in an LVGL grid, called `take_screenshot()`, then `lv_obj_clean()` and `exit(0)`.
  - Result: compile SUCCESS (60 s), run exit 0, a 480×480 BMP showing the four tiles with formatted values.
  - The probe YAML lives in the session scratchpad, not the repo.
- For tests:
  - Add a `screenshot_and_exit_after: <s>` option (or env var) and a deterministic **fake SignalK feed** (fixture deltas) so golden images are stable.
  - `sdl_screenshot` currently names files by timestamp and writes BMP. Add an explicit path and PNG (stb is already vendored).
  - Needs an X display (`DISPLAY=:0` here). Xvfb isn't installed, so CI needs `xvfb-run` or `SDL_VIDEODRIVER=offscreen` (untested).

### 4.8 Memory budget (estimates; not measured on device)

| Item | P4-86 (720²) | S3 + octal PSRAM (480²) | Derivation |
|---|---|---|---|
| PSRAM | 32 MB (assumed, vendor spec ESP32-P4NRW32) | 8 MB (assumed, N16R8-class modules) | `psram:` present in hardware files |
| LVGL draw buffer | 1,036,800 B (100 %) | 460,800 B at 100 % | w×h×2, `buffer_size: 100%` (P4 file `:147`) |
| Layout JSON (cap) | 64 KiB + ~100 KiB transient | same | §4.4 |
| NVS (cur + LKG) | 2 × ≤64 KiB | same | §4.5 |
| Per `value` tile | ~1–1.5 KiB | same | 1 obj + 3 labels at ~150–250 B each with locals (LVGL 9 obj ≈ 100 B + styles) |
| Per `gauge` | ~3–5 KiB | same | scale + arc + needle + labels + sections |
| 192 tiles worst case | ≤1 MiB | ≤1 MiB | 12 pages × 16 tiles, all live |

- Conclusion: memory isn't a constraint on P4/S3+PSRAM.
- Internal SRAM (S3 ≈ 512 KB minus Wi-Fi/LVGL internals) is the scarce resource. Keep JSON, HTTP and LVGL allocations in PSRAM, and avoid per-message heap churn.
- **C3/C6 (no PSRAM; 400 KB / 512 KB SRAM, single-core RISC-V): in scope (decision 2026-10-24).** These boards set the design floor, so the runtime must be built for internal-RAM-only operation:
  - LVGL partial draw buffer (e.g. 1/10 screen). 240×240×2/10 ≈ 11.5 KB.
  - Layout parse within a small heap. Options: a smaller document read in chunks, or validating and converting page by page so the whole `JsonDocument` never lives at once. ArduinoJson with a bounded doc is OK if the layout is small.
  - Keep both NVS copies, but read them in chunks.
  - Fewer live LVGL objects: build only the visible page plus its neighbours, and destroy the others.
  - No per-message heap churn in the SignalK client: the single core is shared by Wi-Fi, LVGL and parsing.
  - Capacity comes from the device's free heap at boot and is reported in `hello` (§6.2).

  Not measured: there's no C3/C6 display board file in the repo. First step: pick a reference C3/C6 display and compile the runtime spike for it to get real free-heap numbers.

## 5. SignalK plugin side

### 5.1 Plugin API (verified in `@signalk/server-api` 2.10.1 types and server 2.17.2/2.19.0 dist)
- **Lifecycle and schema:** `id`, `name`, `schema`, `start(config)`, `stop()`. RGB565 proxy precedent: `SignalKRGB565Proxy/src/index.ts:26-50`.
- **Routes:**
  - `registerWithRouter(router)` is mounted at **`/plugins/<plugin.id>`** (`interfaces/plugins.js:526-532`).
  - `signalKApiRoutes(router)` is mounted at **`/signalk/v1/api`** (`:533-534`).
  - Plugins may also call `app.get(...)` on the root app. The RGB565 proxy does this (`src/index.ts:65`), and so does charts-plugin.
- **Data and status helpers** (`serverapi.d.ts`):
  - `app.getDataDirPath()` (`:227`)
  - `app.handleMessage(id, delta)` (`:191`)
  - `app.getSelfPath` / `getPath` / `getMetadata` (`:36,61,65`)
  - `app.streambundle.getAvailablePaths()` (`streambundle.d.ts:128`), which gives the path picker its path list. `getMetadata(path)` provides units/displayName.
  - `setPluginStatus` (`:147`)
- **Webapp:** package keyword `signalk-webapp` (or `signalk-embeddable-webapp`) (`interfaces/webapps.js:29-31`). Served statically at `/<package-name>/` from `public/` if present (`:43-47`). One npm package can be both plugin and webapp.

### 5.2 Security (verified)
- With security on, `/plugins/*` sits behind `adminAuthenticationMiddleware` (`tokensecurity.js:271` in 2.19.0, `:213` in 2.17.2). On the dev server, `GET /plugins/` and `/plugins/foo/api/x` returned **401** without a token. Code reading says a read-only device token would also be refused (admin required); that wasn't exercised with a real token.
- `/signalk/v1/api/*` uses `http_authorize` (`tokensecurity.js:275-278`). It accepts any valid token, and **anonymous reads when `allow_readonly`** (`:820-832`). Data reads returned 200 anonymously on the dev server.
- ⇒ **This contradicts CLAUDE.md §3** (`GET /plugins/esphelm/api/devices/:id/layout` for devices). See ADR-0003:
  - Editor/admin CRUD stays at `/plugins/esphelm/api/*` (admin is right for editing).
  - Device endpoints (`hello`, `layout`) move to a read-authorized mount, preferably `signalKApiRoutes` → `/signalk/v1/api/esphelm/devices/:id/...`. Whether a plugin router there takes precedence over the server's own data handler is **unverified** and is the first Phase 2 spike. The fallback is a root route.
  - The plugin itself checks `req.skPrincipal.identifier === deviceId` (the access-request `clientId`) when security is on.
- **Device token provisioning:** reuse ESPHomeSignalK's access request. It appears in the SignalK admin UI ("Access Requests"), where the admin approves read-only, or read/write if `switch`/autopilot PUTs are wanted. No new secrets on the device, no token in YAML.

### 5.3 Tooling recommendation (boring)
- npm workspaces. Node 22 is installed; pnpm isn't, and npm avoids a new tool.
- TypeScript 5 strict; `tsc` for plugin/schema; Vite + React for the editor.
- **vitest** for all TS packages. The RGB565 proxy uses mocha/chai; vitest is simpler with Vite.
- ESLint 9 flat config + typescript-eslint; Prettier.
- Conventions to match from `signalk-rgb565-proxy` (`package.json`):
  - keyword `signalk-node-server-plugin`
  - `@signalk/server-api` dependency
  - `tsc` build into a published dir
  - `strict: true`
- Differences: ESPHelm is MIT (the proxy is Apache-2.0), and ESLint/Prettier versions should be modernised.

## 6. Schema groundwork

### 6.1 Library: TypeBox (ADR-0001)
- The contract artifact shared with firmware and docs is **JSON Schema**. TypeBox schemas *are* JSON Schema (limits such as `maxLength`/`maxItems` are first-class and lossless), with `Static<>` types and Ajv validation in the plugin.
- zod 4 now has `z.toJSONSchema()`, so the gap is smaller than it used to be. Conversion fidelity and an extra layer are still the cost.
- Verify the current TypeBox package name and version at Phase 1 start (assumed `@sinclair/typebox` 0.34.x).

### 6.2 Limits: none fixed in the schema yet (decision 2026-10-24)
The v1 schema defines **no hard limits** on layout size, pages, tiles, paths or string lengths. Golden rule 2 still applies on the device: untrusted JSON must never crash or boot-loop the display. That means:

- **Device-side capacity guards** are derived from the device's own memory, not from the schema. Examples: refuse a body bigger than what can be buffered from the largest free block, refuse building past a free-heap watermark, cap JSON nesting depth, truncate strings to a fixed buffer. Any refusal falls back to the last-known-good layout or the default page.
- The device **reports** its capacity in `hello` (`limits`, §6.3), so the plugin and editor can warn ("this layout is too large for the C3 display") without the schema hard-coding numbers.
- The structural rules the schema does enforce: types, enums, required fields, ids, the ASCII + `°` label charset (§4.3), and grid cell placement inside the grid.

Reference numbers kept for later, when limits are defined (they were the earlier proposal for P4/S3 with PSRAM): 64 KiB layout, 12 pages, 24 tiles/page, 64 unique paths, 128-char paths, 32-char labels, nesting depth 8. C3/C6 values will come from the measurement in §4.8.

### 6.3 Minimum `hello` fields

| Field | Why |
|---|---|
| `deviceId` | Stable identity. Use the same MAC-derived UUID as the SignalK access-request `clientId` (`utils.h:368-383`) so auth and device bind 1:1. |
| `fw.version`, `fw.build` | support / compatibility |
| `schema.supported` (`{major, maxMinor}`) | plugin must not send layouts the device can't parse |
| `widgets` (type → version list) | editor offers only renderable tiles; plugin validates per device |
| `board` / `model` | default layout templates, diagnostics |
| `display` `{width, height, orientation, colorDepth}` | editor preview aspect, grid defaults |
| `fonts` (semantic sizes available) | editor size choices |
| `limits` / capacity (device-reported, §6.2) | plugin/editor warn before sending a layout the device can't hold |
| `layout.etag` (currently cached) | plugin can tell if device is stale |
| `capabilities` (`touch`, `put`, `psram`) | adapt editor (e.g. no PSRAM means smaller layouts) |

### 6.4 Unit conversion table
- Paths in today's apps, with SI base units:
  - wind speed (m/s) and angles (rad)
  - heading (rad), SOG/STW (m/s)
  - position (object, deg)
  - anchor maxRadius (m)
  - autopilot target (rad) and state (string)
  - battery current/voltage (A/V), SoC (ratio), solar current (A)
  - engine revolutions (Hz) and temperature (K)
  - `notifications.*` (object)
- All needed conversions are **affine** (`display = si × factor + offset`). Define them as data:
  - m/s → kn, km/h, mph
  - rad → deg (plus an angle mode, signed −180..180 or 0..360)
  - K → °C, °F
  - ratio → %
  - Hz → rpm
  - m → nm, km, ft, fathom
  - m³ → L, gal
  - m³/s → L/h, gal/h
  - Pa → hPa, bar, psi
  - C → Ah
  - J → kWh
  - s → min, h
  - V, A, W unchanged
- Location: `packages/schema/units.json`, the single source of truth. A generator emits `units.ts` and a C++ `constexpr` table header for `esphelm_runtime`. `packages/schema/fixtures/units.cases.json` holds `(si, unit, expected)` cases run by both vitest and a host C++ test.
- Don't reuse ESPHomeSignalK's `unit_conversions.*` (bugs in §3.6-5). Leave it untouched for the legacy YAML apps.

## 7. Commands

| Purpose | Command | Result here |
|---|---|---|
| ESPHome CLI | `/home/batu/venv/bin/esphome` (not on PATH; VS Code task uses the Python interpreter, `.vscode/tasks.json`) | v2026.9.1 |
| Validate | `~/venv/bin/esphome config {SDL_720,SDL_480,MFD}.yaml` | **ran: all valid** after the fixes below. Before: MFD failed on the empty `substitutions:`; SDL_480 failed on negative `pivot_x`. |
| Host build | `~/venv/bin/esphome compile SDL_720.yaml` / `SDL_480.yaml` | **ran: SUCCESS** (both). Before: string PUT codegen error, ESPTiles LVGL 8 API, LVGL 8 msgbox in `notification.yaml`. Both SDL configs build into the same `.esphome/build/sdl2/` dir (name `sdl2` from `sdl.yaml`), so compiling one overwrites the other's binary. |
| Device build | `~/venv/bin/esphome compile MFD.yaml` | **ran: SUCCESS**. ESP-IDF 5.5.5, RAM 18.1 % (104,452 / 576,464 B static), Flash 38.4 % (6.3 MB / 16.5 MB app partition). Before: ESPTiles `CORE.using_esp_idf`, duplicate ArduinoJson IDF dependency. |
| Host run | `.esphome/build/<name>/.pioenvs/<name>/program` (F11 = screenshot → `screenshot_YYYYMMDD_HHMMSS.bmp` in CWD) | spike: ran OK |
| Runtime-LVGL spike | scratchpad `sdl_probe.yaml` + `-DLV_USE_LABEL=1 -DLV_USE_GRID=1` | **ran: compile OK, screenshot OK** |
| Flash | `~/venv/bin/esphome run MFD.yaml` | not run (hardware) |
| Dev SignalK | `PORT=3999 signalk-server -c <scratch-dir> --sample-nmea0183-data` (add `--securityenabled` to test auth) | **ran**. Live demo values (`navigation.speedOverGround` m/s, wind rad). Use a scratch `-c` dir, **not** `~/.signalk`. |
| SignalK versions | PATH: `~/.npm-global/bin/signalk-server` **2.17.2**; also `/usr/local/lib/node_modules/signalk-server` 2.19.0 | |

Fixes applied for the three builds (2026-10-24), all caused by ESPHome 2026.9.1 / LVGL 9.5:

| Where | Fix |
|---|---|
| `MFD.yaml` | Replaced the empty `substitutions:` with `screen_width/height: 720` (app substitutions derive from them; the hardware package alone wasn't resolved early enough). |
| `modules/applications/wind.yaml`, `energy.yaml` | Negative meter-image `pivot_x` is now rejected. Needles are positioned and pivoted in a page `on_load` lambda instead. `energy.yaml` now uses its own `energy_size` instead of `wind.yaml`'s `size`. Removed a `tick_style` on a scale with no ticks (newly rejected; it had no visible effect). |
| `modules/components/notification.yaml` | Message box ported to the LVGL 9 API (`lv_msgbox_add_title/text/footer_button`). Same size, colours, fonts and Mute/Ack-close behaviour. Not exercised at runtime. |
| `modules/hardware/sdl.yaml` | `byte_order: little_endian`. With big_endian, SDL showed false colours (verified by screenshot before/after). |
| ESPHomeSignalK `__init__.py` (uncommitted, on `main`) | String/bool/float constants for `put_request`/`publish_delta` emitted as typed `DeltaValue`. |
| ESPTiles (uncommitted) | `not CORE.using_arduino` / `USE_ESP32_FRAMEWORK_ESP_IDF` guards (as in ESPHomeSignalK upstream). `esp_http_client` as an IDF builtin. Dropped its own ArduinoJson (unused; clashed with the `json` component). Removed the stale `lvgl_hal.h` include. LVGL 9 image header (`magic`, `LV_COLOR_FORMAT_RGB565`, `stride`). |

Visual check (SDL 480, scratch copy of `SDL_480.yaml`): wind and energy-SoC needles sit on the dial rim at their initial values. **Not fixed / found:**
- Both battery-voltage needles on the energy page point at the 15 V end regardless of value. Likely the reversed scale (150→100) in ESPHome's meter emulation; the rotation code is independent of the pivot fix.
- `engine.yaml` has the same negative `pivot_x` (it is in none of the three builds).
- Chart, autopilot and notification were compiled but not exercised against live data.
- Nothing was checked on hardware.

Notes:
- Running `signalk-server` with no `-c` uses the real `~/.signalk` (charts, node-red, NMEA2000 plugins). It ran once by mistake for ~2 minutes during this recon and was stopped.
- With two dev servers running, the second one's NMEA0183 (10110) and SignalK TCP (8375) ports clash. That's harmless for HTTP/WS tests.
- TS tooling commands (`npm test`, `npm run typecheck`, `npm run lint`) don't exist yet. They'll be defined in Phase 1.

## 8. Risks and recommendations

| # | Risk | Likelihood | Impact | Cheap spike to retire it |
|---|---|---|---|---|
| R1 | Thread-safety in ESPHomeSignalK makes dynamic bindings crash | **High** (bug exists) | High | Add a mutex + per-path latest-value mailbox drained in `loop()`; stress with 64 paths at 10 Hz on SDL plus 1000 rebuilds |
| R2 | Device route placement/auth (plugin routes admin-only) | **Certain** (verified) | High | Phase 2 first task: a plugin with a `signalKApiRoutes` GET; call it with anon, readonly token and admin token on a security-enabled dev server |
| R3 | Runtime LVGL on device (P4 PPA/rotation, S3 timing, memory) differs from host | Medium | High | Flash the spike container plus 24 `value` tiles on the P4-86; rebuild every 2 s for 1 h; log `heap_caps` free/min |
| R4 | LVGL feature gating (`lv_conf.h`) and ESPHome internal API churn | Medium | Medium | Pin ESPHome in docs; CI `esphome compile` of SDL with the runtime; prefer build flags over `add_lv_use` |
| R5 | Fonts/glyphs: runtime labels need glyphs not compiled in | **High** | Medium | Add `GF_Latin_Core` to semantic fonts; measure flash delta; fallback to replacement-glyph rendering |
| R6 | WS fragmentation / `updates[0]` drops data | High | Medium | Feed a 4 KB notification and a 2-update delta in an SDL test |
| R7 | NVS write time/wear for 64 KiB blobs | Low | Medium | Write 64 KiB ×100 on the P4; time it and check `nvs_get_stats` |
| R8 | Upstream ESPHomeSignalK changes (shared with other users) | Medium | Medium | Land changes behind a new API, keep existing YAML behavior; ask the maintainer (you) before pushing |
| R9 | Legacy apps already broken on ESPHome 2026.9.1 | **Certain** | Low/Medium | Fix the `MFD.yaml` substitutions, wind `pivot_x`, and string PUT before relying on legacy screenshots as references |

**Verdict.** The architecture **holds**. Needed adjustments:
- (a) Device endpoints aren't under `/plugins/esphelm` (ADR-0003).
- (b) ESPHomeSignalK gets a runtime listener API plus thread-safety fixes, with dynamic subscriptions done as unsubscribe-all + resubscribe (ADR-0004).
- (c) `esphelm_runtime` owns a YAML-declared host container rather than ESPHome pages, and force-enables its LVGL features.
- (d) Layout persists in NVS (ADR-0002).

**Phase 1 scope (contract).**
- In:
  - TypeBox schema v1: layout → pages → grid → tiles, for `value`, `gauge`, `bar`, `switch`.
  - Theme: `day`/`night`, a small named palette.
  - Units table + generator.
  - Limits (§6.2).
  - `hello`/device schema.
  - Fixtures: valid (480/720, 1 and 3 pages), invalid (each limit exceeded, unknown type, bad path, wrong types, oversize strings).
  - Contract tests (vitest + Ajv).
  - Generated `layout-schema.md`.
- Out: plugin, editor, firmware, wind_rose and friends, alarms.

**Phase 3 scope (firmware slice).**
- In:
  - `esphelm_runtime` external component: host container id, font map, NVS store (cur + LKG), worker-task HTTP fetch with ETag, bounded parse + validation into structs.
  - **Built-in default page** on any error.
  - One page of `value` tiles with stale indicator (`meta.timeout` or a per-tile age).
  - Dynamic subscription through the new ESPHomeSignalK API.
  - The `version` delta triggers a refetch.
  - SDL golden-image test with a fake feed.
- Out: multi-page swipe, `gauge`/`bar`/`switch` rendering (beyond the parsing already validated in Phase 1), PUT, alarms, orientation change, HTTPS.

## Verified vs assumed

| Claim | Status | How |
|---|---|---|
| Subscriptions only sent in `on_connected` | Verified | code read |
| Per-path unsubscribe closes the WS | **Verified** | WS probe vs signalk-server 2.17.2 |
| Unsubscribe-all + resubscribe works, cache replayed | **Verified** | WS probe; code `subscriptionmanager.js:151-154` |
| `/plugins/*` 401 without token when secure | **Verified** | curl vs `--securityenabled` dev server |
| Read-only token also refused on `/plugins/*` | Assumed (code read) | `adminAuthenticationMiddleware` |
| `signalKApiRoutes` route reachable before server data handler | **Unverified** | Phase 2 spike |
| Access request returns PENDING | Verified | curl |
| Runtime LVGL build/destroy in YAML container | **Verified (host only)** | SDL spike + screenshot |
| Same works on P4/S3 hardware | Assumed | needs hardware |
| `lv_conf.h` gates widgets; build flags fix it | Verified | spike compile fail → pass |
| LVGL 9.5.0 / ESPHome 2026.9.1 / ArduinoJson 7.4.3 | Verified | CLI + source |
| NVS 448 KiB default; FS components excluded | Verified (source) | `esp32/__init__.py` |
| NVS handles 64 KiB blobs fine | Assumed (IDF docs) | spike R7 |
| PSRAM sizes 32 MB / 8 MB | Assumed (vendor specs) | not measured |
| Per-tile memory numbers | Estimate | LVGL struct sizes, not measured |
| ArduinoJson doc ≈ 1–2× input | Estimate | not measured |
| GF_Latin_Kernel lacks `äöå` | Verified | `esphome_glyphsets` |
| WS frames >1 KB fragment and break parsing | Assumed (code read + IDF default) | spike R6 |
| ESPTiles license | Assumed MIT (README only) | no LICENSE file |
| MFD/SDL_480 config failures, SDL_720 compile failure | Verified | ran commands |

## Open items before Phase 1

The answers to the original questions are under "Decisions recorded 2026-10-24" at the top. Still open:

1. **CLAUDE.md update** (blocks Phase 1). Apply the revised diff, including the limits rewording. §6 currently says "enforce max layout size … (limits defined in the schema doc)". Proposed: no fixed schema limits in v1; the device enforces memory-derived capacity guards, falls back to LKG, and reports capacity in `hello`.
2. **Commit/push** of the uncommitted work in ESPHelm (build fixes + docs; several files also carry earlier uncommitted edits), ESPHomeSignalK (`main`, string PUT fix) and ESPTiles (LVGL 9 port).
3. **Reference C3/C6 display board.** Needed to measure the low-memory capacity floor. Doesn't block the schema shape.
4. Phase 2/3 spikes, unchanged: `signalKApiRoutes` reachability; ESPHomeSignalK runtime API + thread safety + `permissions: readwrite`; WS fragmentation; NVS write timing; runtime LVGL on P4 hardware.
5. Weather/HA source (open questions #2/#3). Not blocking.
