# ADR-0046: Battery tile

Status: **Accepted** (2026-11-22)

## Context
- **Before:** a battery took three tiles. The energy starter layout had a gauge for the state of charge, a bar for the voltage and a value for the current. Nothing showed how long the charge lasts or whether the battery was charging.
- **SignalK's paths:** a battery lives under `electrical.batteries.<id>`:
  - `capacity.stateOfCharge` (ratio);
  - `voltage`, `current`;
  - `capacity.timeRemaining` (s).
  - Chargers publish `electrical.chargers.<id>.chargingMode` as text (bulk, absorption, float...), and solar chargers their panel power, e.g. Victron's `electrical.solar.<id>.panelPower`.
- **The current's sign is not settled.** The spec reads as "positive flows out". But Victron (signalk-venus-plugin) and most BMS plugins publish positive while charging.

## Decision
- **One `battery` tile:**
  - a battery outline filled to the state of charge, the % beside it;
  - above it, the label and the voltage;
  - below it, the current and power, a state line ("14 h 20 left", "Charging: Bulk", "Idle") and solar.
- **The tile's own DataItem is the state of charge.** Zones, the server's zones (ADR-0020) and history (ADR-0018) work as on a value tile.
  - The fill uses the SignalK ratio, whatever the display unit.
  - The other values are optional DataItems (`voltage`, `current`, `power`, `timeRemaining`, `solar`) plus a text path, `chargingModePath`.
- **Explicit paths, filled by the editor.** The editor lists the batteries the server has (`electrical.batteries.<id>`) and fills SignalK's standard paths for the one picked; each stays editable, for a BMS that publishes elsewhere. The firmware never derives paths from an id.
- **Positive current means charging**, with `invertCurrent` per tile for the other convention. The display always shows current and power with positive meaning charging.
- **Power:** without a `power` path, the display shows voltage times current (W) while both are fresh.
- **Text and rows defined once:**
  - `battery.ts` holds the time left, the state, the charging mode text and the rows that fit (`batteryRows()`, `BATTERY_FIT`).
  - `esphelm_battery.h` mirrors them; `fixtures/battery.cases.json` proves they agree.
  - The two tile sets share `battery_values.h` (bindings, stale handling, the texts) and the battery's geometry (`battery_box()`); each only draws.
- **Black and white** (ADR-0035): the same layout in the ink, the fill solid.
  - Warn shows as a heavy frame, alarm as an inverted tile, as on the mono value tile.
  - No history popup, as on every mono tile.

## Consequences
- **Memory:** 13 LVGL objects per colour tile (12 mono), ≈7 KB on the 64-bit host build, no allocation per update. Value changes resize the fill and set texts; nothing is laid out again.
- **Older firmware** refuses a layout with a battery tile (`UNKNOWN_TILE_TYPE`), and the plugin doesn't send one to a display that doesn't list `battery` in `hello.widgets`.
- **Not covered:**
  - several batteries in one tile (two tiles do it);
  - charger, inverter and alternator details beyond the charging mode;
  - a time to full while charging (SignalK has no standard path for it).
