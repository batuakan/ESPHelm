# Phase 6 notes: boot guard, alarms, display settings

Status: **done on SDL, pending your review and the P4 hardware check** · 2026-10-26

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
- `npm run e2e -w signalk-esphelm` against **signalk-server 2.17.2 and 2.26.0**:
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
- **Hardware:** backlight dimming, the touch-to-wake behaviour on the P4 (via the board YAML's resume), and the banner on 720×720 hardware. These are hardware check steps 12 and 13 in `docs/firmware-runtime.md`.
- **Boot guard on hardware:** the ESP32 reset-reason path (panic/watchdog) only compiles. Only the host path was run.
- **Real alarm sources:** the derived-data plugin's `environment.sun` and real alarm plugins weren't tried; only notifications I published myself.
- **Acknowledgements live in the plugin's memory:** a server restart forgets them. Clients that ignore `method` keep sounding.
- **The editor has no list of active alarms** (the optional part of the plan; I left it out).
- **No day-theme 720 render of the banner.** The 720 e2e steps run offline, where there are no alarms.
- **Your SignalK server on :3000 wasn't running** when I checked during this phase. I didn't stop it: I only stopped three throwaway test servers of mine (`/tmp/esphelm-e2e-*`) that a failed script had left on port 3993.

## Repository note
Your untracked `.gitattributes` routes `*.png` and `*.svg` through Git LFS. The goldens committed in 5d and now are LFS pointers, which work on this machine. A clone without that file, or without the LFS objects, gets pointer text instead of images. Commit `.gitattributes` (and push the LFS objects) or drop it, whichever you intended.
