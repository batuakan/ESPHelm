# ADR-0038: Alarms panel tile

Status: **Accepted** (2026-11-15)

## Context
- **One alarm at a time:** the alarm banner (ADR-0014) shows the worst unacknowledged notification with "+N", and a tap cycles through the others. With several alarms on at once (bilge, high water, engine, anchor) you can't see them together, nor how long each has been on.
- **The table is already there:** the runtime keeps every active notification from one `notifications.*` subscription, with its state, message, sound and acknowledgement, and acknowledges through the plugin.

## Decision
**A new `alarms` tile** lists the active notifications. You chose to keep the banner, and to do the colour displays first.
- **No paths of its own:** the tile reads the banner's table through `WidgetEnv`, as chart tiles read their shared store (ADR-0030). It adds no subscription and no second table.
- **Rows, worst first:** unacknowledged rows come before acknowledged ones, then they are ordered by state, then newest first. Each row has:
  - a bar in the state's colour (red shades at night);
  - the message, or the end of the path;
  - the age, in shared text (`alarmAge()` in `packages/schema/src/alarms.ts`, mirrored in `esphelm_alarm_age.h`);
  - an ACK while unacknowledged.

  Acknowledged rows are dimmed, or left out with `showAcknowledged: false`.
- **ACK per row:** the banner's acknowledge, generalised to any path (`AlarmBanner::ack()`), with one acknowledge in flight at a time. While it is in flight the button shows "...". ACK is disabled offline, where the title says "(offline)".
- **Size:** `ALARMS_FIT` sets rows at least 48 px tall (a touch target), as many as fit, with "+N more" when they don't. ACK buttons show from 220 px of content width; narrower panels list only, and the banner's ACK still works.
- **`prefix`:** lists only one branch, for example `notifications.electrical` on an engine-room panel. It matches whole segments.
- **The banner stays,** on every page: the same alarm can show in both on the panel's page, and the banner behaves the same everywhere.

**For the tile, the banner gains** a read-only view of its table, a version counter (so tiles redraw only when it changes, or every 30 s for the ages), the time each state began, and the per-path ACK. The banner itself behaves as before.

## Consequences
- **Flash:** about 7–8 KB (CYD 1,543,891 B, 84.1 %; C3 check 90.9 %, which leaves about 167 KB there).
- **Memory:** about 3 KB of LVGL objects per tile (up to 8 rows), made once. The table is the banner's: 16 entries with PSRAM, 8 without, so a panel never lists more than that.
- **Ages:** they count from when the display saw the state begin. After a restart, an alarm that was already on starts at "now".
- **Black and white:** not in the mono tile set yet, so the RLCD doesn't list `alarms` and the plugin refuses the tile for it.
- **Checked:** schema fixtures, the age and prefix cases in TS and C++, editor tests, and SDL goldens `91-alarms-panel`, `92-alarms-acked`, `93-alarms-night` and `94-alarms-none`.
