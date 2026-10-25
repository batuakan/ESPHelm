# Phase 5c notes: autopilot tile

Status: **done, pending your review and the hardware check** · 2026-10-25

Ports the legacy autopilot app to a tile. It can be full-screen (a 1×1 grid) or sit next to other tiles. Design and safety rules: ADR-0011.

## What changed
- **Schema** (additive within v1):
  - `autopilot` tile: `label?`, `modes?` (unique, from auto / wind / route), and `config?` paths with `AUTOPILOT_DEFAULTS` (the classic `steering.autopilot.*` paths the legacy app uses).
  - `AUTOPILOT_FIT` (controls from 260×220 px of content, else status only), generated into `esphelm_sizes.h`.
  - Fixtures, plus the *Autopilot* and *Helm (large display)* starter layouts.
- **Firmware 0.4.0:**
  - `AutopilotWidget` enforces your rules:
    - tap, then confirm, to engage (3 s window)
    - one-tap STANDBY
    - course buttons only while engaged and fresh
    - everything disabled offline
    - status only when the tile is too small
  - PUTs carry numbers, strings or booleans.
  - The SDL tap hook can name a button.
  - Disabled buttons, the footer's included, no longer get LVGL's bright grey recolour.
- **Test harness:** `startSignalK({ autopilotSim: true })` adds an autopilot stand-in with the classic PUT interface.
- **Editor:**
  - Autopilot in the tile library and as "+ Autopilot page"
  - preview at the display's tier, with drawn-only buttons
  - drawer with modes, label, paths and a size hint
  - starter pages in the add menu are labelled "Starter: …"

## Verified
- `npm test`: 14 files, 419 tests. Type-check, lint and build are clean.
- `npm run e2e:sdl`: all checks, 22 goldens reviewed by eye, stable on a second run. Autopilot, against the stand-in:
  - +10 in standby does nothing
  - one AUTO tap only arms (no PUT); the second engages, and the server state is `auto`
  - +10 moves the target by exactly 10°
  - an armed WIND expires after 3 s without sending
  - STANDBY is one tap
  - offline, even STANDBY is refused
  - a status-only autopilot at 480, and Helm at 720
- `npm run e2e:editor` (Chrome): all checks. On the Helm layout the autopilot gets its buttons; WIND is unticked, and the display downloads exactly that.
- `npm run e2e -w signalk-esphelm`: passes.
- Compiles: P4 (RAM 94,276 B, flash 2.65 MB) and C3 (RAM 108,320 B; flash 66.8 %).

## Not verified / gaps
- **No real autopilot.** I tested only against the stand-in. Hardware check: `docs/firmware-runtime.md`, step 10; do it at the dock or with the drive disconnected.
- **Classic change requests only.** A provider that implements only SignalK's v2 Autopilot API (REST) won't respond. A bridge in the ESPHelm plugin would fix that; tell me if your pilot needs it.
- **The PUT response isn't read.** A rejected request shows "no response from the autopilot" after 5 s.
- **No tack, dodge or absolute course yet.** The legacy app had them only as comments.
- At 480, a 2×2 autopilot on a 4×2 grid is status only (≈208 px wide). A full-screen one, or 2×2 at 720, gets its buttons.

## Next
5d: chart/anchor (ESPTiles), as a full page.
