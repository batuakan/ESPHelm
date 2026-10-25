# ADR-0011: Autopilot tile and its safety rules

Status: **Accepted** (Phase 5c, 2026-10-25)

## Context
The legacy autopilot app sends classic SignalK change requests (PUTs over the WebSocket) to:
- `steering.autopilot.state` (`auto` / `wind` / `route` / `standby`)
- `steering.autopilot.actions.adjustHeading` (±1 / ±10 degrees)

It shows the state and `steering.autopilot.target`. A single tap engaged the pilot, and the course buttons worked in any state.

Commanding an autopilot from a touch screen on a moving, wet boat needs stricter rules than a switch does. Like the wind rose (ADR-0010), the autopilot should be a tile, usable full-screen or next to other tiles.

Your decisions:
- Engaging takes a tap and then a confirming tap.
- STANDBY is always one tap.
- The course buttons work only while the pilot is engaged.
- Commands use the classic change requests, as the legacy app does.

## Decision
- **`autopilot` tile type** (additive within v1):
  - optional `label`
  - `modes` (unique, from `auto`, `wind`, `route`; default all three)
  - `config` paths (`statePath`, `targetPath`, `adjustPath`, `headingPath`), with defaults in `AUTOPILOT_DEFAULTS`
- **Safety rules on the device:**
  1. **Engage** (a mode button): the first tap arms the button ("AUTO?", highlighted). A second tap on it within 3 s sends the PUT. The arm expires after 3 s, and any other button cancels it. The display then shows the request as pending until the state value matches; after 5 s without a match it shows "no response".
  2. **STANDBY** sends at once on one tap.
  3. **Course buttons** (−10/−1/+1/+10) are enabled only while the state is fresh and not `standby`, `off` or `disabled`.
  4. **Offline** (no SignalK connection): every button is disabled, and the tile says "offline".
  5. **Too small** (content box below `AUTOPILOT_FIT`, 260×220 px): the tile shows status only, with no buttons, so nothing can be commanded from a cell too small to hit reliably.
  6. **The test hook** (`esphelm_tap_request <tile> <button>`) goes through the same checks as a finger, so tests prove the rules rather than bypass them.
- **Disabled styling:** disabled buttons use the theme's dark palette. LVGL's default grey recolour is switched off; it was far too bright at night (this also fixes the footer).
- **The editor** shows the tile, its size tier and settings, but never sends commands.

## Consequences
- **Engaging needs two deliberate taps; disengaging needs one.** This is the asymmetry you'd want if spray or a sleeve brushes the screen.
- **Providers that only implement SignalK's v2 Autopilot API** (REST) don't receive these change requests. A bridge in the ESPHelm plugin (change request → v2 API call) would make them work; it's not built yet.
- **The PUT response isn't read.** The display trusts the value stream; a rejected request shows up as "no response" after 5 s.
- **Tack, dodge and setting an absolute course aren't offered yet.** The legacy app only had them commented out.
