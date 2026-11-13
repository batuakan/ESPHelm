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

## Mounting rotation (ADR-0028, branch `feat/mount-rotation`)

- **Why this shape:** a first attempt (per-shape arrangements in every page, rotation as an everyday setting on the display; closed PR #14) was dropped. A display stays the way it was installed, so a layout only ever needs to fit one shape, and the rotation is decided when the layout is designed.
- **What:**
  - **Schema:** `settings.rotation` (0, 90, 180, 270; absent 0) and `hello.capabilities.rotation`. Fixtures: `valid/rotation.json` (a portrait helm), `invalid/settings-unknown-rotation.json`, `invalid/settings-rotation-not-a-number.json`; the firmware parser reports the same codes.
  - **Firmware:** the layout's rotation is applied with ESPHome's `LvglComponent::set_rotation()` just before its page is built, so a cached layout boots turned; a new `hello` reports the turned size. On for the P4, the Guition and the SDL builds (`lvgl: rotation: 0`); the C3 and the CYD ignore it (logged once).
  - **Editor:** *Display settings → Mounted*; the preview turns at once (the panel's size from `hello`, turned by the layout's rotation), keeps its proportions and fits the window; the displays are reloaded every 5 s; linking displays of different shapes warns and suggests *Copy*.
  - **Fixes on the way:** the settings panel kept pointers to the previous tab's deleted objects until it closed (a brightness change while another tab showed could touch the deleted slider); every tab build forgets them now. The alarm banner cuts its text again when the screen's width changes.
- **Tests:**
  - **SDL e2e:** online at 480, a rotation layout turns the display, `hello` reports it, a restart boots turned, a layout without it turns it back. A new 1280×800 build (`esphelm_sdl_wide.yaml`) with four new goldens (a square layout stretched, the panel, the rotation layout's page and panel at 800×1280), reviewed by eye.
  - **Editor:** unit tests for the turned size and shapes; e2e for following a new size without a reload, *Mounted → 90°*, the portrait preview inside the window, the stored `settings.rotation` and the link warning.
- **Build sizes:** P4 flash 3,443,280 B (20.8 %), static RAM 99,482 B; C3 (no rotation) flash 1,606,468 B (87.5 %).
- **Checked on the P4** (2026-11-08, hardware step 26). **Not verified:** the Guition 4848S040 (compile only).

## Wind rose performance (ADR-0029, branch `feat/rose-laylines`)
- **What:** optional laylines (both tacks, upwind at the beat angle and downwind at the gybe angle, switching at the beam), a waypoint W marker and a target angle bar on the `wind_rose` tile. All three are off unless the layout turns them on; the *Wind* and *Sailing* starters have laylines and the waypoint on.
- **Angles:** SignalK's `performance.beatAngle` / `gybeAngle` while fresh and plausible (beat 20–80°, gybe 100–175°), else the tile's `fixedBeat` / `fixedGybe` (45° / 150°), so laylines work without a polar plugin. The target bar uses `performance.targetAngle` only.
- **Safety:** each graphic needs all its values fresh; with a stale true wind or heading the laylines and the bar disappear rather than showing old guidance.
- **Shared geometry:** `packages/schema/src/windRose.ts` and `esphelm_wind_rose.h`, 19 cases in `fixtures/wind-rose.cases.json` checked by vitest and by g++.
- **Tests:**
  - **Schema and parser:** new valid and invalid fixtures; the C++ parser agrees on all of them.
  - **SDL e2e:** four new goldens at 480 (fixed angle with W, SignalK's beat angle with the target bar, downwind, true wind stale), reviewed by eye. The first version drew the laylines only across the card band, which read as ticks, and the test's target angles sat under the A/T triangles; the laylines now cross the ring at `d/60` wide and the test angles were moved.
  - **Editor:** the drawer's *Performance* section, the preview's two laylines from a live true wind, and the stored config, in the editor e2e; the share/import path list knows the new paths (only while their graphic is on).
  - **Not done:** a 720 render: the 720 build runs offline in the e2e, and offline the graphics are (correctly) hidden.
- **Build sizes:** P4 flash 3,446,310 B (20.9 %, +2.4 KB), static RAM 99,594 B; Guition flash 1,803,063 B; C3 flash 1,609,482 B (87.7 %).
- **Not checked on hardware yet** (hardware step 27).

## Chart tile (ADR-0030, branch `feat/chart-tile`)
- **What:** the chart is a tile instead of a page kind, so it can sit beside a wind rose or depth. Stored chart pages are migrated to a 1x1 grid page with a chart tile (`migrateLayout`, by the plugin on load and the editor on import); the validator and the firmware refuse the old page kind (`UNKNOWN_PAGE_KIND`). "+ → Chart page" makes the 1x1 page; the library has a Chart tile (2x2 where it fits) with a size hint.
- **Shared map tiles:** one `ChartTileStore` for every chart on the display, with a budget of 16–48 tiles from free PSRAM instead of a 3.2 MB picture per chart. Charts say which tiles cover their view; the store fetches each once, keeps tiles any chart showed in the last second, evicts the least recently wanted, and keeps everything across page changes while the layout has charts. Charts draw tiles straight from the store; the old buffer shifting is gone.
- **Size tiers:** zoom buttons from 200 px, the position line from 260 px, and a red frame instead of the anchor alarm banner below 200 px (`CHART_FIT`).
- **Tests:**
  - **Schema:** converted fixtures, `valid/chart-tiles.json`, `invalid/old-chart-page.json`, migration tests; the C++ parser agrees on all of them.
  - **SDL e2e:** goldens 16–20 re-recorded (the chart now sits in a tile: rounded corners, page padding; the map, overlay and alarm unchanged, compared by eye with the old ones), and two new: a 2x2 chart beside a rose and a 1x1 chart. The log shows each map tile fetched once for both charts (6), zooming the big one fetching only its new zoom (6 at z16, none again at z15), and leaving the page and coming back fetching nothing.
  - **Plugin:** an old chart page on disk is migrated on load. **Editor:** unit tests and the e2e (chart page, a value added beside the chart, the stored tiles).
- **Plugin fix found on the P4:** tiles of a chart from the charts plugin came back 404 when another provider (`@signalk/resources-provider`) was the server's default for charts: `getResource('charts', id)` asks only the default provider, while the editor's list (`listResources`) merges all. The plugin now looks the chart up in the merged list when `getResource` has nothing. This predates the chart tile; the old chart page had it too.
- **Build sizes:** P4 flash 3,447,548 B (20.9 %), static RAM 99,682 B; Guition flash 1,803,835 B; C3 flash 1,610,780 B (87.8 %; no chart).
- **Not checked on hardware yet** (hardware step 28): drawing up to 16 tiles per refresh instead of one picture is the thing to watch on the P4.

## Wind rose values under the alarm banner (branch `fix/rose-font-under-banner`)
- **Found on the P4:** with an alarm banner showing, the rose's three centre values shrank from the value font (96 px) to the label font (42 px), and grew back when the alarm cleared. The banner pushes the page down (by design), the rose gets a little smaller, three values no longer fit at 96 px by a few pixels, and the rose's ladder had only value → label → small.
- **Fix:** the rose picks from every full font of the ladder (ADR-0017) up to the value font, so it steps down one size (64 px on the P4). Digits-only fonts are left out, since a slot can show text.
- **Tests:** `fixtures/valid/rose-performance.json` gets a third centre value; a new golden (`76-rose-under-banner`) of it under a depth alarm. Goldens 70–73 re-recorded for the third value, and four goldens where a rose used the label font before now use the next size up (`06-multi-wind`, `39-history-rose-page`, `720-02-small-roses`, `wide-01-landscape`), reviewed by eye.


## Engine tile (ADR-0032, branch `feat/engine-tile`)
- **What:** a new `engine` tile like the legacy engine screen: a 240° RPM arc (the tile's own path, range and zones, as on a gauge, so the server's zones apply) with three free slot gauges inside it (`left`, `right`, `bottom`), each with its own path, unit, range, zones and an icon (oil can, fuel pump, thermometer, battery, or the label). A new tile starts with oil, fuel and coolant. The `engine` template is now one engine tile.
- **Icons:** the ESPHelmv1 SVGs (Material Design Icons, Apache-2.0). Their path data is flattened to polygons by `svgPath.ts`; the firmware fills them into an antialiased A8 mask at layout time (`esphelm_icon_raster.h`) and the editor draws the same polygons. The g++ test checks the mask covers each icon's area at 24, 61 and 120 px.
- **One source:** the geometry and icons are in `packages/schema/src/engine.ts`; the arcs, radii and icon polygons are generated into `esphelm_engine_shapes.h`, the tick scale and angles mirrored by `esphelm_engine.h` and checked against `fixtures/engine.cases.json` by g++. The editor's preview draws the same shapes in SVG at the display's pixel size.
- **Text only where it fits:** tick labels, the title and slot labels use the largest compiled font within their limit (`labelLine`, `slotLabelLine`), and are left out when even the smallest font is too big (the 480 build's 2x2 cells, the 720 build's 2x2 cells), rather than crowding the ticks. Found while reviewing the first goldens.
- **Corner values:** four plain values in the tile's corners (`topLeft` … `bottomRight`), as on a wind rose. The wind rose's corner code became `CornerValues` (`corner_values.cpp`) for both tiles; the rose's goldens are unchanged. Bottom corners may use the RPM arc's open bottom (below 0.52 R, outside the bottom gauge's 0.9 R), so on a full 480 page three of the e2e's four fit ("Fuel rate L/h" is too wide beside the bottom gauge) and at 720 all four.
- **Found by the compiles:** `EPS` is a macro in Xtensa's `specreg.h` (S3 and ESP32 builds), so the C++ constant is `kEpsilon`.
- **Tests:** schema fixtures (valid and 9 invalid), shared cases in TS and C++, parser mutations; editor unit tests and an App test (add, live needles, slot icon and range, empty a slot, save); SDL e2e goldens 77–81 (live, alarm zones, night, a stale slot, small tiles) and 720-16/17 offline, reviewed by eye; the 89 existing goldens unchanged.
- **Build sizes** (with the SVG icons and corner values): P4 flash 3,471,772 B (21.0 %), static RAM 99,682 B; Guition flash 1,824,299 B, RAM 121,847 B; CYD flash 1,515,875 B (82.6 %), RAM 55,724 B; C3 flash 1,635,038 B (89.1 %), RAM 113,654 B. The icons cost about 7.5 KB of flash over the drawn ones, the corner values about 2 KB; no static RAM.
- **Checked on the P4** (2026-11-10, hardware step 29), with the SVG icons and corner values.

## Sound: alarm tones and touch clicks (ADR-0033, branch `feat/sound`)
- **Hardware:** the P4-86's ES8311 codec, I2S speaker and amplifier (GPIO53) through ESPHome's `i2s_audio`, `es8311`, `speaker` and `rtttl` in `hardware/waveshare-esp32-p4-86.yaml`. The pins come from Waveshare's wiki and a community config, not yet checked on the board.
- **Runtime:**
  - `esphelm_runtime: sound:` names the `rtttl` (and its speaker, for the volume); `SoundPlayer` (`sound.cpp`) plays the tunes.
  - **Alarm tones:** when to play is `esphelm_sound.h`, shared with `packages/schema/src/sound.ts` and checked against `fixtures/sound.cases.json` in TS and g++. Alarms sound when their `method` contains `"sound"` and they aren't acknowledged; `AlarmBanner` gained `sound_level()` and `sound_generation()`.
  - **Clicks:** one LVGL input-device callback on `LV_EVENT_PRESSED`, for objects with an event handler, not on a wake touch, never over an alarm tone.
  - Without `sound:` nothing is compiled.
- **Settings:**
  - `settings.sound { volume 10–100, touch }` in the schema, the editor's *Display settings → Sound*, and the display's *Settings* tab (*Volume*, *Touch sounds*).
  - The display's choices record moved to `v=2` (volume and touch overrides); `v=1` still reads.
  - `hello.capabilities.sound`.
- **Tests:**
  - schema fixtures (valid `settings-sound`, two invalid), the shared sound cases;
  - parser mutations (three), the prefs host test (v2 round trip, v1 still read, volume/touch reconcile);
  - editor unit and App tests (sending volume and touch; the no-speaker note).
- **Build sizes** (against `main` with the engine tile):
  - P4 flash 3,527,230 B (21.4 %, +55 KB: ESPHome's I2S speaker, ES8311 and rtttl), static RAM 103,210 B (+3.5 KB).
  - Guition 1,826,067 B, CYD 1,517,607 B (82.7 %), C3 1,636,822 B (89.2 %): +1.8 KB each and +48 B RAM, for the settings, the saved choices and the panel code, which every board compiles.
- **Boot loop on the P4, fixed:** the first sound build boot-looped before ESPHome started: `assert failed: spi_flash_disable_interrupts_caches_and_other_cpu (esp_task_stack_is_sane_cache_disabled())` from `nvs_flash_init` in `setup_preferences`.
  - **Cause:** on a P4 rev < 3 only about 138 KB of internal heap is free before the main task starts; the larger block is the startup stack, freed later. `esp_hosted_init()` runs as a static constructor and takes most of it (its Wi-Fi tasks' stacks, about 20 KB, among it). The audio build's 3.5 KB more static RAM (`CONFIG_I2S_ISR_IRAM_SAFE` puts I2S and GDMA code in IRAM) left too little for the main task's 3.5 KB stack, so it went to the 8 KB SPM, which the flash driver refuses with the cache off.
  - **Main was within those 3.5 KB too:** any growth of IRAM or static RAM would have hit the same loop.
  - **Fix:** `CONFIG_ESP_HOSTED_DFLT_TASK_FROM_SPIRAM: y` in `hardware/waveshare-esp32-p4-86.yaml` moves the hosted tasks' stacks to PSRAM (Espressif's P4 examples do the same). Those tasks move Wi-Fi packets and never touch flash.
  - **Checked on the P4:** without the audio the build booted (confirming the cause); with the audio and the option it boots, starts the codec, speaker and sound, and connects to Wi-Fi and SignalK.
- **Pop before a sound, fixed:** the ES8311 popped whenever its I2S clock started, at the first sound and again after a few idle seconds, because `rtttl` stops its speaker after every tune.
  - `rtttl` now plays into a `mixer` source (`board_speaker`; a mixer needs a second, unused source).
  - The I2S speaker behind the mixer (`board_i2s_speaker`) has `timeout: never` and runs at `rtttl`'s 16 kHz, so it never stops once started.
  - `esphome: on_boot` plays a silent tune with the amplifier off, then turns the amplifier on (`restore_mode: ALWAYS_OFF`).
  - Cost: +760 B static RAM, +11 KB flash, and I2S writing silence all the time.
  - Checked on the P4: no pop; the I2S speaker starts once at boot and never stops.
- **Alarm over a playing tune, fixed:** `rtttl.play()` ignores a call while a tune plays, so an alarm that came during a click (or an escalation during a milder alarm's tune) was dropped, and `alert`/`warn` never retry. `SoundPlayer` now stops the playing tune first.
- **The desktop builds have no speaker:** the SDL e2e runs without `sound:`, so it checks that the feature compiles out without changing a screen.
- **Not checked on hardware yet** (hardware step 30): the pins, the loudness, hiss with the amplifier always on, and that the clicks feel right.
- **Editor test timing:** `App.test.tsx`'s "edits the display settings" can miss its 1 s wait for the layout on a loaded machine (on `main` too); with a longer wait it passes, and it passes in the full run.


## Dark theme (ADR-0034, branch `feat/dark-theme`)
- **What:** a third display theme, `dark`, that looks like the editor's dark theme: a `#0E141A` page, `#17202A` tiles, light text, and the zone, value and wind rose colours in lighter shades. Day and Night are unchanged.
- **Night vs dark:** "night" had meant both "red only" and "dark page". `red_only()` (night: zones by brightness, red charts) and `dark_page()` (night or dark: stronger zone bands) in `layout_model.h` now say which. In Dark the alarm banner's text is the page colour (its bands are light), QR codes are black on white, and charts are drawn as by day.
- **Auto:** swaps between Night and the day-side theme: the last Day or Dark picked on the display, else the layout's (Day when that is Night). The footer toggle goes Night and back to the day side. The panel's Theme row is Day / Dark / Night / Auto; it falls back to two rows where four don't fit, which none of the current screens need (checked at 480, 720, the turned 1280×800 and the CYD's 320×240).
- **Saved:** the day side is `ds=` in the `v=3` prefs record; `v=1` and `v=2` records still read.
- **Brightness:** unchanged; Dark uses the day value and floor.
- **Older firmware:** it refuses a `dark` layout and keeps its last good one. `hello` now reports `capabilities.darkTheme`, and the editor greys out *Dark* for displays without it.
- **Behaviour change:** a layout whose theme is Night with automatic day/night now shows Day by day (it used to stay Night all day).
- **Found by the e2e:** two `environment.sun` updates sent back to back reach the display as one; SignalK drops an update sooner than the subscription's `minPeriod`. The test now waits between dusk and sunrise.
- **Tests:**
  - **Unit:** a schema fixture; parser mutations; the prefs test for v3, the day side and its reconcile; editor tests for the button, its gating and the preview; a plugin test storing and serving a dark layout.
  - **SDL e2e:** the dark flow (panel pick, day brightness kept, dusk to night, sunrise back to dark, the footer toggle) and new goldens 82–86 and 720-18, reviewed by eye. The five settings-panel goldens changed for the fourth button and were reviewed; the other 91 are unchanged.
- **Build sizes:** P4 flash 3,541,886 B (+1.3 KB), static RAM 104,106 B (unchanged); Guition flash 1,828,451 B, RAM 122,031 B; CYD flash 1,520,035 B (82.8 %), RAM 55,908 B; C3 flash 1,639,488 B (89.3 %), RAM 113,854 B.
- **Checked on the P4** (2026-11-10).

## Firmware updates from the editor (ADR-0036, branch `feat/ota`)
- **What:** an admin uploads an update image in the editor (or presses *Check GitHub for updates*) and presses *Update* on a display; the display downloads it from the plugin with its device token, flashes it and restarts. The first install stays over USB.
- **Why not ESPHome's HTTP OTA:** basic auth only (the device routes take a bearer token), `flash()` on the main loop (LVGL would freeze), and `update: http_request` has a compile-time URL while the server is found with mDNS. ESPHome's OTA core is used: an `OTAComponent` platform (`ota: - platform: esphelm_runtime`), its backends (MD5 checked in `end()`), `safe_mode` with ESP-IDF rollback, and the host backend that replaces the SDL program.
- **Identity:** a marker compiled into every image (`ESPHELM-IMAGE/1 fw=… board=… kind=…`) and the build id (`app_elf_sha256` on ESP32, matching esptool's *ELF file SHA256*; the program's sha256 on the host) in `hello.fw.build`.
- **One-shot requests:** each request is served once (409 after), so a display that keeps crashing can't loop on an update. Success is the next hello's build; a hello with the old build after the download means it didn't start or rolled back.
- **Found by the e2e:** signalk-server's compression gzips the download for clients that accept it and drops `Content-Length`, which the display checks; the route sends `Cache-Control: no-transform`.
- **Schema:** `hello.fw.build?` and `capabilities.ota?`, both optional (schema 1.x stays compatible; `@esphelm/schema` needs a minor release before the plugin is published).
- **Release:** `release.yml` writes `manifest.json` from each `.ota.bin`'s marker (checked against the tag) and the notes describe updating from the editor.
- **Build sizes with OTA:** P4 flash 3,549,258 B (+6.5 KB); Guition 1,834,687 B; CYD 1,526,171 B (83.2 %); RLCD 1,441,039 B; C3 1,647,088 B (89.8 %).
