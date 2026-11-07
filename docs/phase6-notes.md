# Phase 6 notes: boot guard, alarms, display settings

Status: **done, checked on the P4** · 2026-11-05

Your scope for this round:
- the boot-loop fix
- alarms as a banner with acknowledge through SignalK
- display settings: brightness, start page, auto day/night, screen timeout

Not done this round: landscape and other sizes, auth and recovery tooling. Design: ADR-0013 (boot guard), ADR-0014 (alarms), ADR-0015 (display settings).

## What changed
- **Boot guard** (firmware, ADR-0013):
  - A `boot` store record counts crashes while a layout is shown; it's cleared after 30 s on screen.
  - A fetched layout that crashes before it's cached is skipped after one crash; a cached one after two. Only panic and watchdog resets count; power cuts and OTA don't.
  - A skipped layout is refused, also when fetched again, until a changed one arrives.
  - The hello reports it as `recovery.skippedLayoutEtag`, and the editor flags the display.
- **Alarms** (ADR-0014):
  - **Plugin:** `POST /signalk/v1/api/esphelm/notifications/ack`. signalk-server has no acknowledge API, so the plugin republishes the notification without `sound`. A delta input handler keeps it silent while the source resends the same state; an escalation sounds again.
  - **Firmware:** one `notifications.*` subscription and a fixed alarm table (16 entries, or 8 without PSRAM).
    - A banner on the top layer shows the worst alarm, "+N" and ACK. Tapping it shows the next alarm.
    - Once acknowledged (here, or anywhere else that removed `sound`), it shrinks to a strip; it's dark with red text at night.
    - **The banner pushes the page down instead of covering it.** Widgets re-run `layout_done()`; the page isn't rebuilt. The gauge and autopilot now handle being laid out again.
- **Display settings** (ADR-0015):
  - **Schema:** an optional `settings` block in the layout (`brightness.day/night`, `startPage`, `autoTheme`, `autoThemePath`, `screenTimeout`), a new semantic code `UNKNOWN_PAGE`, and the hello's `capabilities.backlight`.
  - **Firmware:**
    - `backlight:` YAML option.
    - The start page.
    - The night theme by `environment.sun`, rebuilding the page on a switch.
    - Brightness per theme.
    - The screen timeout: backlight off, plus a black cover that swallows the waking touch.
    - Alarms wake the screen.
  - **P4 config:** passes `display_backlight` to the runtime and removes the hardware package's fixed 45 s `on_idle`.
  - **Editor:** a *Display settings* drawer. Removing the start page, or applying a starter layout, resets it.

## Verified
- `npm test`: 495 tests. Type-check, lint and build are clean.
  - **Schema:** settings and hello fixtures, plus mutations, through both the TS validator and the C++ parser.
  - **Plugin:** the ack route (silencing, the re-strip on resend, escalation, other vessels, 400/403/404, restart).
  - **Editor:** `updateSettings` and the start-page reset; component tests of the drawer.
- `npm run e2e -w signalk-esphelm` (corrected 2026-10-26: the runs here were both on **2.26.0**, as the harness picks it by default; 2.17.2 was run explicitly later, alarm checks pass there, and a chart check fails, see below):
  - a real alarm from another WebSocket source is silenced by a device token
  - it stays silent when resent
  - it sounds again on escalation
  - a read-only token gets 403
- `npm run e2e:sdl`: all checks, 34 goldens. New:
  - **Boot guard:** a fetched crash and a cached crash. A test hook (`ESPHELM_TEST_CRASH_ON`) aborts the host build while it builds a tile.
  - **Alarms:** banner, next, ACK through the plugin (checked on the server), strip, escalation, clear.
  - **Settings:** start page, dusk → night with the night brightness, screen off after 10 s, woken by an alarm and by a touch.
  - Reviewed by eye: 21–27 (new), and 19/20 (the chart now with the banner above it, so the zoom buttons stay visible).
  - **Golden 14 changed twice** as steps were added before it: the autopilot's target/heading are past their stale time at the screenshot. That's the intended offline look.
- `npm run e2e:editor` (Chrome): settings set in the drawer reach the display's layout.
- Compiles: P4 (RAM 95,262 B, flash 2.69 MB) and C3 (RAM 109,208 B, flash 68.8 %).

## Not verified / gaps
- **Hardware:** checked on the P4 (2026-11-05), hardware check steps 12 and 13.
- **Boot guard on hardware:** the ESP32 reset-reason path (panic/watchdog) only compiles. Only the host path was run.
- **Real alarm sources:** the derived-data plugin's `environment.sun` and real alarm plugins weren't tried; only notifications I published myself.
- **Acknowledgements live in the plugin's memory:** a server restart forgets them. Clients that ignore `method` keep sounding.
- **The editor has no list of active alarms** (the optional part of the plan; I left it out).
- **No day-theme 720 render of the banner.** The 720 e2e steps run offline, where there are no alarms.
- **Your SignalK server on :3000 wasn't running** when I checked during this phase. I didn't stop it: I only stopped three throwaway test servers of mine (`/tmp/esphelm-e2e-*`) that a failed script had left on port 3993.

## Corrections (2026-10-26)
- **signalk-server 2.26.0 does have a notifications acknowledge/silence API** (v2, `/signalk/v2/api/notifications/:id/acknowledge` and `/silence`); 2.17.2 and 2.19.0 don't. ADR-0014 has the details. Using it where available is an open follow-up.
- **Bug fixed:** the plugin's silenced copy of an acknowledged alarm stayed in SignalK under the plugin's source. When the same alarm came back, a resubscribing display could be replayed that copy and show the new alarm as acknowledged. It now republishes under the notification's own `$source`. The plugin e2e checks the replay, and fails without the fix.
- **Not fixed:** on 2.17.2 the plugin answers a tile of an unknown chart with 415 instead of 404 (the 5d chart check). Charts were only verified on 2.26.0.

## Repository note
Your untracked `.gitattributes` routes `*.png` and `*.svg` through Git LFS. The goldens committed in 5d and now are LFS pointers, which work on this machine. A clone without that file, or without the LFS objects, gets pointer text instead of images. Commit `.gitattributes` (and push the LFS objects) or drop it, whichever you intended.

## Value history popup (2026-10-28, branch `feat/value-history`)
A tap on a value tile opens a graph of its recent values; only the close button closes it (ADR-0018). The display records the history itself, from boot, on every page, so it works offline.
- **Schema:** optional `history` on value tiles (absent = on), and `HISTORY` (windows, points, limits per board) generated into `esphelm_sizes.h`.
- **Firmware:**
  - `value_history.cpp`: rings of 120 points for 10 min / 1 h / 6 h, carry-forward while fresh, kept across layout updates, unit-tested with g++.
  - `history_popup.cpp`: the popup on the top layer, below the alarm banner.
  - The sparkline mark on tappable tiles.
- **Editor:** a *Tap for history* checkbox, the mark in the preview, and *Preview graph* (a mock of the popup).
- **Tests:**
  - SDL e2e: seven new goldens (480 day/night, 1 h window, collecting, under an alarm, the page after closing, 720), plus a live recording check through the log. Every golden with value tiles was re-recorded for the 66-pixel mark, and each diff was checked to be the mark only.
  - Editor e2e: the mock popup, history off, and `history: false` in the served layout.
- **Checked on the P4** (2026-11-05, hardware step 18). **Not verified:** the C3's internal-RAM guard on a real chip (it only compiles), and a full 6 h recording (the windows were tested with the unit test and a seeded curve).

## History per value, the wind rose, angles (2026-10-28, branch `feat/history-per-value`)
Each value is switched on in the editor, so only chosen values take memory; the wind rose's values can record too (ADR-0019).
- **Schema:** value tiles record with `history: true` only (absent is now off); the wind rose's `history` lists its recorded values; the limits count values (`HISTORY.maxValues*`). `historySeries`/`historyCount`, and `circularMean`/`unwrapAround` with shared cases (`fixtures/history.cases.json`). A few template values record.
- **Firmware:**
  - **Angles:** angles average on the circle (this fixed a jump at north on heading tiles too).
  - **Rose values:** they record as `<tile>/<name>`. A tap on the rose opens the popup, which has value buttons; the mark goes in a free bottom corner.
  - **Test hook:** `ESPHELM_TEST_HISTORY` takes a list of keys.
- **Editor:** checkboxes per value (the rose's slots and angles), a memory counter, and value buttons in the preview.
- **Tests:**
  - **Units:** shared circular cases in TS and C++, circular points in the C++ history test, rose ops in the editor.
  - **SDL e2e:**
    - Five new goldens: the rose page, its popup, AWA across north, a heading across north, and the rose popup at 720.
    - Sixteen goldens back to their pre-ADR-0018 images (0 changed pixels); `720-03` and `34` re-recorded (fewer marks; "1/3" in the footer).
    - A live check that a rose value records.
  - **Editor e2e:** off by default, the counter, the rose checkboxes, the preview's buttons, and the served `history` list.
- **Checked on the P4** (2026-11-05, hardware step 18, extended).

## Zones from the server's metadata (ADR-0020)

- **What:** value, gauge and bar tiles use the zones in a path's SignalK metadata, in place of their own, and follow them when they change on the server.
- **ESPHomeSignalK:** `add_meta_listener` reports paths from `updates[].meta`.
- **Firmware:** reads the visible page's metadata on the HTTP worker: on a layout or page change, on (re)connect, every 60 s, and 1 s after a meta delta. The page rebuilds once when its zones change. RAM only.
- **Why also 60 s:** the server's `minPeriod` throttle dropped 25–40 % of meta deltas at the library's 200 ms default (2.17.2, 2.19.0, 2.26.0).
- **Schema:** no layout change. `serverZonesToDisplay` with shared cases in TS and C++.
- **Editor:** previews use the effective zones; the drawer lists the server's.
- **Tests:** shared cases in TS and C++; `withServerZones`; `/api/paths` in the plugin e2e; preview and drawer in the editor e2e; SDL e2e with two new goldens (`49`, taken again after the zones are removed, and `50`).
- **Checked on the P4** (2026-11-05, hardware step 19).


## Graph tile (ADR-0021, branch `feat/graph-tile`)

- **What:** a `graph` tile draws one window (10 min, 1 h or 6 h) of a value's recorded history on the page, with an optional fixed y range and zone bands. A tap opens the history popup.
- **Schema:** the `graph` tile type (`window`, `min`/`max` both or neither, value zones), `GRAPH_WINDOWS`, `GRAPH_FIT`, `graphWindowIndex()`. `historySeries()` includes graph tiles, which always record.
- **Firmware:**
  - **Widget:** `widget_graph.cpp`. It reads `ValueHistory` through `WidgetEnv::history` and redraws when a point of its window closes (`ValueHistory::appended()`).
  - **Shared code:** the popup's range and unwrap logic moved to `prepare_graph()`.
  - **Server zones:** they apply with the value tile rules.
  - **Hello:** it lists `graph`.
- **Editor:** a *Graph* library item (2x1), drawer fields (window, fixed range, zones, history counter, preview), a size hint for the axis labels, and an SVG preview.
- **Tests:**
  - **Schema and parser:** schema fixtures; C++ parser cases.
  - **Firmware history:** `prepare_graph()` and `appended()` in the g++ history test.
  - **Plugin:** the catalog and the compat refusal.
  - **Editor:** an App test and a browser e2e step.
  - **SDL e2e:** a live depth line, and three new goldens (`51`, `52`, `720-07`). All 50 existing goldens are unchanged, including every popup image.
- **Checked on the P4** (2026-11-05, hardware step 20). **Not verified:** the C3's internal-RAM limit with graphs on a real chip.

## Heading tape (ADR-0022, branch `feat/heading-tape`, on top of `feat/graph-tile`)

- **What:** a `heading_tape` tile, a compass strip that scrolls with the heading. It has markers for COG, the bearing to the next waypoint and the autopilot target (an arrow at the edge when off the tape).
- **Schema:** the tile type (`span`, `markers`, `config` paths, `staleAfter`), `HEADING_TAPE_DEFAULTS`, `HEADING_TAPE_FIT`, and the shared geometry `tapeMarks()`/`tapeX()` with `heading-tape.cases.json` (TS and g++).
- **Firmware:** `widget_heading_tape.cpp` draws the tape in a draw callback (four LVGL objects) and redraws on half a degree, at most every 250 ms.
- **Editor:**
  - **Library:** a *Heading tape* item (2x1).
  - **Drawer:** the span, the markers with their paths, and a true/magnetic warning.
  - **Preview:** an SVG drawn from the shared geometry for the tile's width on the display.
- **Fixed on the way:** the ArduinoJson fetch for the C++ tests raced between parallel workers (PR #4's CI failure). Each worker now clones into its own directory.
- **P4:** checked on the hardware on 2026-11-03 (hardware step 21): it looks right. True/magnetic conversion is left out by design.

## Centre-zero gauges and bars (ADR-0023, branch `feat/center-zero`)

- **What:** `centerZero` and `sides` on gauges and bars, for values either side of zero.
  - **Scale:** symmetric −M…M; `min`/`max` still clamp the value.
  - **Fill:** from zero, red/green by side, or one colour for plus/minus.
  - **Labels:** P/S or −/+ at the ends.
- **Schema:** the two fields, `INVALID_RANGE` when the range doesn't cross zero, and the shared text (`centerZero.ts` / `esphelm_center_zero.h`, `center-zero.cases.json`, halves rounded up on both sides).
- **Firmware:**
  - **Gauge:** an `lv_arc` fill (LVGL `arc` enabled).
  - **Bar:** LVGL's symmetrical bar mode.
- **Editor:**
  - **Drawer:** the *Centre zero* checkbox (it makes the range cross zero, and `deg` becomes `deg180`) and *Sides*.
  - **Preview:** draws the same.
  - **Problems list:** now words range problems by tile.
- **Changed from the plan:** `sides` without `centerZero` is ignored rather than refused, since a cross-field `INVALID_VALUE` would split the JSON Schema from the validator.
- **Hardware:** checked on the P4 (step 22, 2026-11-04).

## Clock tile and clock screen saver (ADR-0024, branch `feat/clock`)

- **What:**
  - **Tile:** a `clock` tile (time, date or both; 12/24 h, seconds, four date formats, UTC).
  - **Saver:** `settings.screenSaver`, which shows the time and/or date faintly after the screen timeout instead of a black screen.
- **Time:**
  - **Clock:** the display keeps its own, set from `navigation.datetime` (GPS), or from an optional ESPHome `time_id` (NTP, HomeAssistant) when SignalK has none. It runs on `millis()` in between.
  - **Time zone:** `settings.timeZone` carries the zone as a POSIX rule built in the editor from the browser's zone data, so summer time works offline.
- **Shared contract:** `clock.ts` / `esphelm_clock.h`, `clock.cases.json`, with offsets taken from `Intl`. The TS test also checks the generated rules against `Intl` for two years.
- **Fonts:** the digits fonts gain `:` (`DIGIT_GLYPHS` too). A font without it is skipped for clock times.
- **Editor:**
  - **Tile:** *Clock* in the library and a drawer with examples. The first clock gives the layout the browser's time zone.
  - **Display settings:** the time zone, the time path, the screen saver and its brightness.
- **Build size against `main`:** P4 flash +14.8 KB (3,353,082 B), C3 +11.7 KB (1,465,140 B, 79.8 %); static RAM +224 B.
- **Checked on the P4** (hardware step 23): the clocks, the dimmed saver and the touch through it. The first try showed a black screen: the saver's 5 % backlight is dark on the P4-86, so the range became 1–100 % with a default of 30 %.
- **Not verified:** NTP via `time_id` (no board YAML sets it yet).

## Settings and information panel (ADR-0025, branch `feat/display-panel`)

- **What:**
  - **Footer:** every layout has one now, with a menu button (three bars) next to the page buttons. A one-page layout shows its title and the button.
  - **Panel:** the button opens it, in two tabs.
  - **Settings tab:** *Brightness* (a slider for the theme shown), *Day* / *Night* / *Auto*, and *Screen off* (with a screen timeout).
  - **Info tab:** the display, the network (Wi-Fi, signal, IP), SignalK (server, stream, deltas, dropped, last delta, paths), the layout and the clock.
  - **Long-press:** the old one on the page title is gone.
- **Saved on the display:** `display_prefs.cpp`, `Slot::PREFS`.
  - **Kept:** across reboots, until the layout brings a different value for what was overridden. A day/night choice also goes when the sun changes; the first sun value after a boot doesn't count.
  - **Checked:** by a g++ test (`prefs.cpp.test.ts`).
- **ESPHomeSignalK:** `deltas_received()`, `messages_dropped()`, `last_delta_ms()`, `subscribed_paths()` (PR #12 there, merged).
- **Editor:** the footer preview on every layout, with the menu button; size hints reserve the footer on one-page layouts too.
- **Tests:**
  - **Goldens:** 56 re-recorded for the footer and reviewed by eye. Five new: the *Settings* tab by day and at night, *Info* by day, and both tabs at 720.
  - **Value sizes check:** "2400" now fits a single cell, so the check uses a 500 °C temperature.
- **Build size against `main`:** P4 flash +15.5 KB (3,368,618 B), C3 +15.7 KB (1,480,876 B, 80.7 %); static RAM +216 B on both.
- **Checked on the P4** (hardware step 24), before the tabs: the panel works.
- **Tabs:** added afterwards, at your request. *Settings* and *Info*, with only the shown tab built. Checked on the P4 (2026-11-05).

## Setup without configuration (ADR-0026, branch `feat/zero-config`)

- **What:**
  - **No secrets:** the P4 and C3 builds compile in no Wi-Fi network and no SignalK host. Names get the MAC suffix.
  - **Setup network:** ESPHome's access point and captive portal, with a password made per display (`esphelm_wifi_setup.h`, `Slot::AP`) and shown with a QR code. It opens only after a power-up without Wi-Fi (2 min, closing 10 min after power-up), or at once with no saved network, and never once connected.
  - **Setup screens:** *Set up Wi-Fi*, *Joining Wi-Fi*, *Looking for a SignalK server*. The status page has the menu button too.
  - **Network tab** in the settings panel: Wi-Fi rows, the setup network, *Forget Wi-Fi*; the server's rows, *Change server* (mDNS list), *Forget server*. Forgets ask *Yes* first.
- **ESPHomeSignalK** (branch `feat/server-identity`): the server is saved next to the token and is the only one accepted after a restart; `scan_servers()`, `servers_found()`, `choose_server()`, `forget_server()`, `disconnect()` on each transport; an HTTP request without a response searches for the server again. Tests: `saved_server_test.cpp` (the record and the checks behind choosing).
- **Tests:**
  - **Unit:** the password and QR text (`wifi_setup.cpp.test.ts`, g++).
  - **SDL e2e:** 212 checks. Seven goldens re-recorded and reviewed by eye (the three tabs, and the status page's menu button); six new: the Network tab at 480 and 720, the server list, the *Forget server* question, the setup screen and the Network tab with the setup network.
- **Build size against `main`:** P4 flash +74.3 KB (3,442,920 B, 20.8 %), C3 +125.8 KB (1,606,628 B, 87.6 %); RAM +724 / +694 B. Mostly the captive portal with its web server and web OTA.
- **Checked on the P4** (2026-11-05, hardware step 25): the setup network, the portal, the QR code, *Forget Wi-Fi*, and choosing, forgetting and the restart behaviour of the server binding.

## Screen shapes and rotation (ADR-0028, branch `feat/screen-shapes`)

- **What:**
  - **Arrangements per shape:** a grid page may carry `arrangements.square|landscape|portrait`, each with its own grid and the page's tiles placed again by id (positions only; a tile left out is hidden on that shape). A shape without one shows the default, so existing layouts are unchanged and older firmware ignores the field.
  - **Shapes:** landscape when width ≥ 1.25 × height, portrait the other way, else square, from the screen after rotation. `displayShape()` (TS) and `display_shape()` (`esphelm_shape.h`) share `SHAPE_RATIO_PERCENT` through the generated `esphelm_sizes.h`, and `fixtures/shape.cases.json`.
  - **Firmware:** the parser checks arrangements like the validator (new code `UNKNOWN_TILE`); the renderer builds only the tiles placed for its shape.
  - **Rotation:** a *Rotation* row in the panel's *Settings* tab (below *Screen off*), using ESPHome's LVGL rotation (`lvgl: rotation: 0` in the board YAML). Saved as an ESPHome preference of its own, applied at boot before the first page, reported in `hello`. A change rebuilds the page and panel and says hello at once. On for the P4 (PPA) and the SDL builds, off for the C3 (a second draw buffer).
  - **Editor:** the page as the selected display's shape arranges it; *Arrange for landscape* (copy, or turned), edits that stay in the arrangement, *Hide on landscape* and the hidden tiles to show again, *Use the default again*. Problems in an arrangement name the shape.
- **Tests:**
  - **Schema:** valid `arrangements.json`, eight invalid fixtures (unknown tile, a tile twice, out of grid, overlap, empty, unknown shape, a setting in a placement, no grid); the shape cases in TS and g++.
  - **Parser:** C++ and TS agree on every fixture and nine new mutations (176 cases).
  - **Editor unit:** `arrangements.test.ts` (12 tests: edits stay in the arrangement, hiding and showing, a tile added in an arrangement, deleting everywhere, dropping, template renames, problem pointers).
  - **SDL e2e:** 230 checks. New `firmware/esphelm_sdl_wide.yaml` (1280×800): the landscape arrangement, a default page stretched, the panel wide; *Rotation* 90° → 800×1280 with the portrait arrangement (a tile hidden), the panel and *Info* turned, the rotation kept after a restart. At 480 online: 90° and back reach the plugin in the hello. Six new goldens; three re-recorded for the Rotation row (the *Settings* tab by day, at night and at 720). All reviewed by eye.
  - **Editor e2e:** the display says hello as 1280×800; *Arrange for landscape* → *Copy turned*, a wider grid, a hidden tile, *Save & send* stores the arrangement with the default untouched; shown again; *Use the default again* removes it.
- **Build size:** P4 flash 3,447,210 B (20.9 %), RAM 99,514 B (17.3 %); C3 flash 1,609,994 B (87.7 %), RAM 113,494 B (35.3 %). Not measured against `main` separately. Rotation's buffer is allocated at boot, not static.
- **Checked on the P4** (2026-11-07, hardware step 26 in `docs/firmware-runtime.md`): rotation, touch and keeping it after a power cycle.
- **Not verified:** a real landscape or portrait display.
