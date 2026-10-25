# ADR-0014: Alarm banner and acknowledging alarms through the plugin

Status: **Accepted** (Phase 6, 2026-10-25)

## Context
SignalK alarms are notifications under `notifications.*`, with a value `{ state, method, message }`. The states are `normal`, `nominal`, `alert`, `warn`, `alarm` and `emergency`; `method` lists `visual` and/or `sound`. They come from many sources: the anchor alarm plugin, depth and engine limits, and so on. Until now a display showed an alarm only if a tile watched its path. Only the chart page's anchor alarm did.

You wanted alarms shown as a banner, with an acknowledge that reaches SignalK.

signalk-server has no acknowledge or silence API: in 2.26 the notifications API only has GET routes.

## Decision
- **Firmware:** the runtime itself listens to `notifications.*` (one wildcard subscription). This is independent of the layout, so it works on every page and on the status page.
  - It keeps a fixed table of active notifications: 16 entries with PSRAM, 8 without. When the table is full, a worse alarm replaces the least severe one. Paths and messages are cut to fixed lengths, and messages are filtered to the font's characters.
  - It shows the worst unacknowledged alarm in a banner at the top of the screen, with "+N" for the others. Tapping the banner shows the next one.
- **The banner pushes the page down instead of covering it**, so no control (zoom buttons, autopilot STANDBY) is ever hidden under it. The page is laid out again rather than rebuilt: the grid gets less height and the widgets re-run `layout_done()`. This happens only when the banner appears, changes height or goes away, never on value changes.
- **ACK** sends `POST /signalk/v1/api/esphelm/notifications/ack` with the path.
  - The plugin republishes the notification with `sound` removed from `method`. Its delta input handler keeps the notification silent while the source keeps sending it in the same state.
  - The state and message are unchanged, so every app still shows the alarm.
  - A new state (escalation, or `normal`) ends the acknowledgement.
- **Acknowledged** means either of two things:
  - the plugin confirmed this display's ACK
  - the notification lost `sound` while its state stayed the same, meaning another display or app acknowledged it

  Acknowledged alarms shrink to a thin strip in the alarm's colour until they clear. An escalation shows the full banner again.
- **Night:** a dark band with red text (no bright red area). By day the band is filled with the state's colour.
- **Offline:** the banner stays with "(offline)", since the display can't know whether the alarm cleared. ACK is disabled while the plugin can't be reached, and while an acknowledge is in flight.

## Consequences
- Only clients that honour `method` stop sounding. The acknowledgement lives in the plugin's memory, so a server restart forgets it, and a source still sending the alarm makes it sound again.
- The banner takes 50–60 px at the top while an alarm is unacknowledged, and about 25 px once acknowledged. Tiles get smaller meanwhile: a small gauge may lose its tick labels until the banner goes away.
- The chart page keeps its own ANCHOR ALARM label, so an anchor alarm shows twice there.
- Memory: under 200 bytes per table entry, and six LVGL objects created on the first alarm and kept.
- Test hook: `esphelm_tap_request` with `@alarm` (next alarm) or `@alarm ack`. `@` can't occur in tile ids.
