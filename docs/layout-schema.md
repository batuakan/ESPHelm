# ESPHelm layout schema, v1

The layout is the contract between the SignalK plugin, the editor and the display firmware. The source of truth is `packages/schema` (TypeBox). This document explains it; when the two disagree, the code and its fixtures win, and this document must be fixed.

| Artifact | Path |
|---|---|
| TypeBox source | `packages/schema/src/{primitives,tiles,pages,layout,hello}.ts` |
| Published JSON Schema | `packages/schema/schema/layout.schema.json`, `hello.schema.json` (generated) |
| Validator | `validateLayout()`, `validateHello()` in `packages/schema/src/validate.ts` |
| Unit table | `packages/schema/units.json`, with generated TS (`src/generated/units.ts`) and C++ (`generated/esphelm_units.h`) twins |
| Fixtures | `packages/schema/fixtures/` (valid, invalid with expected errors, hello, unit cases) |

Regenerate after any change with `npm run generate`. `npm test` fails while generated files are stale.

## 1. Versioning and compatibility
- `version` is the **major** version (`1`). A device rejects any layout whose major it doesn't support (`hello.schema.major`), keeps its last-known-good layout, and logs `UNSUPPORTED_VERSION`.
- Within a major, changes are **additive only**: new optional fields, new tile types, new page kinds.
  - Two exceptions, approved before any release, both pages that became tiles: Phase 5b removed the `kind: "widget"` wind-rose page in favour of the `wind_rose` tile (ADR-0010), and ADR-0030 removed the `kind: "chart"` page in favour of the `chart` tile. The plugin migrates stored layouts on load and the editor imported ones (`migrateLayout`: a 1x1 grid page with the tile); the validator rejects the old shapes with `UNKNOWN_PAGE_KIND`. A display with new firmware refuses an old cached chart layout for the same reason, and shows its built-in page until the plugin serves the migrated one.
  - The plugin and editor validate strictly (`additionalProperties: false`).
  - **Firmware ignores unknown fields** but validates every field it knows. That lets older firmware accept a layout written for newer firmware of the same major. Verified by `firmware/test/parser.cpp.test.ts`: the C++ parser reports exactly the TS codes and pointers on every fixture and extra mutations, except `UNKNOWN_FIELD`.
  - Slot names are part of a tile type's contract, so an unknown slot is still `UNKNOWN_SLOT` on the device.
  - The plugin doesn't send a device a tile type it didn't list in `hello.widgets`.
- Removing or changing the meaning of a field requires a new major (CLAUDE.md golden rule 7: ask first).

## 2. Structure

```
Layout
├─ version: 1
├─ id: Id
├─ name?: Label
├─ theme: "day" | "dark" | "night"
├─ pages: Page[]            (at least 1)
└─ settings?: Settings      display settings (Phase 6, see below)

Page = GridPage                       (discriminator: kind; the only kind)

GridPage                              kind: "grid"
├─ id: Id, title?: Label
├─ grid: { cols ≥ 1, rows ≥ 1 }
└─ tiles: Tile[]            (at least 1)

Tile = value | gauge | bar | switch | position | wind_rose | autopilot | graph | heading_tape
     | clock | chart                         (discriminator: type)
  common: id, x ≥ 0, y ≥ 0, w ≥ 1, h ≥ 1   (grid cells, 0-based)

A full-screen wind rose or chart is a 1x1 grid page with one such tile.
```

### Primitives

| Name | Rule | Error code |
|---|---|---|
| `Id` | `^[a-z0-9][a-z0-9_-]*$` | `INVALID_ID` |
| `Label` | printable ASCII + `°` (`^[\x20-\x7E°]*$`, exported as `LABEL_PATTERN`). The firmware fonts contain only these glyphs. | `INVALID_LABEL` |
| `SkPath` | dot-separated segments of `[A-Za-z0-9_-]`, relative to `vessels.self`; **no wildcards** in v1 | `INVALID_PATH` |
| `UnitId` | an id from `units.json` (§4) | `UNKNOWN_UNIT` |
| `Decimals` | integer 0..6 | `OUT_OF_RANGE` |

There are **no size or count limits** in the v1 schema (no max pages, tiles, string length). Each device protects itself with memory-derived capacity guards and reports its capacity in `hello.capacity` (§5). The editor uses that to warn before sending a layout that won't fit.

### DataItem
A value bound to one SignalK path. It is used by `value`/`gauge`/`bar` tiles and by wind rose slots.

| Field | Type | Notes |
|---|---|---|
| `path` | SkPath | required |
| `unit` | UnitId | display unit; omitted = show the SI value as received |
| `decimals` | 0..6 | fixed decimals |
| `label` | Label | caption, e.g. `"SOG"` |
| `staleAfter` | number > 0 | seconds without an update before the value is shown as stale |

### Grid tiles

| `type` | Extra fields | Notes |
|---|---|---|
| `value` | DataItem + `color?`, `zones?` (value zones), `history?` | big number + label + unit; the number coloured by a fixed colour or by value (below); a tap opens its history graph |
| `gauge` | DataItem + `min`, `max`, `zones?`, `centerZero?`, `sides?` | round gauge with needle; centre zero below |
| `bar` | DataItem + `min`, `max`, `zones?`, `orientation?` (`horizontal` / `vertical`), `centerZero?`, `sides?` | tank level, SoC; centre zero below |
| `switch` | `path`, `label?` | boolean path: shows state, sends a PUT to the same path when tapped. Takes no `unit`. |
| `wind_rose` | `config?`, `slots`, `history?` | see below |
| `autopilot` | `label?`, `modes?`, `config?` | see below |
| `graph` | DataItem + `window?`, `min?`, `max?`, `zones?` (value zones) | line graph of the value's recent history, see below |
| `heading_tape` | `label?`, `span?`, `markers?`, `config?`, `staleAfter?` | compass strip that scrolls with the heading, see below |
| `clock` | `label?`, `show?`, `hour12?`, `seconds?`, `dateFormat?`, `utc?` | the display's time and/or date, see below |
| `engine` | DataItem + `min`, `max`, `zones?`, `slots` | a large RPM arc with three small gauges inside it, see below |

`min`, `max` and zones are in **display units**. A `Zone` is `{ from, to, state }` with `state` one of `normal`, `warn`, `alarm`, `emergency` (the SignalK alarm states). The theme supplies the colours; layouts never carry hex colours.

**Zones on the server (ADR-0020):** when the SignalK server has usable zones in a path's metadata (`meta.zones`), they replace the `zones` of every `value`, `gauge`, `bar` and `graph` tile on that path, and of an `engine` tile's RPM (not its slots), on the display and in the editor's preview. A tile's own `zones` apply when the server has none. The layout itself doesn't change.

### Centre-zero gauges and bars (ADR-0023)
For values either side of zero: rudder angle, heel, rate of turn, battery current, trim.
- `centerZero` (optional boolean): the scale is centred on zero and fills from zero to the value. It needs `min < 0 < max` (`INVALID_RANGE` on `/min`).
- **Symmetric scale:** it is drawn from −M to M, with M the larger of |min| and |max| (`centerZeroSpan()`). `min` and `max` still clamp the value and bound the zones.
- `sides` (optional): `portStarboard` (default) or `plusMinus`. Without `centerZero` it has no effect.
  - **portStarboard:** the magnitude and P or S ("12 ° P"), filled red to port and green to starboard.
  - **plusMinus:** signed ("+8.2 A"), one colour. A vertical bar has positive up.
- **Text:** `centerZeroText()` and `centerZeroTick()` in `centerZero.ts`, mirrored by the firmware's `esphelm_center_zero.h`, with shared cases in `fixtures/center-zero.cases.json`. A value that rounds to zero has no side or sign.
- **Angles:** use `deg180` (−180…180), not `deg`, which wraps to 0–360.
- Older firmware ignores both fields and draws a plain gauge or bar.

```json
{ "type": "gauge", "id": "rudder", "x": 0, "y": 0, "w": 1, "h": 1,
  "path": "steering.rudderAngle", "unit": "deg180", "decimals": 0, "label": "Rudder",
  "min": -35, "max": 35, "centerZero": true }
```

### Value tile colours (ADR-0016)
- `color` (optional): `blue`, `green`, `yellow`, `orange`, `red` or `purple`. By day, each is its own colour; at night all are the night text red (night vision).
- `zones` (optional): `{ from?, to?, state }`, in display units. A value tile has no `min`/`max`, so a missing end is open: `{ "to": 2, "state": "alarm" }` means "2 or less". At least one end is required, and `from` must be below `to` when both are given (`INVALID_ZONE`). Both ends are included, and the last matching zone wins (`valueZoneState`).
- The number is coloured, in this order: muted when stale; a matching zone's colour (at night a `normal` zone uses the text colour; the dark theme keeps its green); the fixed `color`; the theme's text colour. Older firmware ignores both fields and shows the value uncoloured.
- `history` (optional boolean, ADR-0018, ADR-0019): `true` makes the display record the value from boot, and a tap on the tile opens a graph of it (10 min, 1 h and, on displays with PSRAM, 6 h). Absent or `false`: nothing records. Older firmware ignores it. Angles (units with a wrap range) average on the circle.

```json
{ "type": "value", "id": "depth", "x": 0, "y": 0, "w": 1, "h": 1,
  "path": "environment.depth.belowTransducer", "unit": "m", "color": "blue",
  "zones": [{ "to": 3, "state": "warn" }, { "to": 2, "state": "alarm" }] }
```

### Wind rose tiles
A `wind_rose` tile draws a fixed design and exposes **named slots at predetermined positions**. Each slot shows a DataItem you choose. Slots are optional; an empty slot shows nothing. It can sit next to other tiles and several can share a page.

| Slots | `config` (all optional) |
|---|---|
| `center1`, `center2`, `center3` (stacked in the centre of the rose); `topLeft`, `topRight`, `bottomLeft`, `bottomRight` (in the tile's corners, outside the ring) | `apparentAngle` (default `environment.wind.angleApparent`), `trueDirection` (default `environment.wind.directionTrue`), `heading` (default `navigation.headingTrue`), `showTrueWind` (default `true`) |

An unknown slot name gives `UNKNOWN_SLOT`. Defaults are exported as `WIND_ROSE_DEFAULTS`, slot names as `TILE_SLOTS.wind_rose`.

**Performance graphics** (optional `config` keys, ADR-0029). Each is off unless turned on and drawn only while its values are fresh:

| Key | Draws | Reads |
|---|---|---|
| `showLaylines` | the heading on each tack: green for starboard tack (TWA − angle), red for port tack (TWA + angle); the beat angle while \|TWA\| < 90, else the gybe angle | `beatAngle` (default `performance.beatAngle`), `gybeAngle` (default `performance.gybeAngle`); used while fresh and within `WIND_ROSE_TACK` (beat 20–80°, gybe 100–175°, any sign), else `fixedBeat` (integer 20–80, absent 45) / `fixedGybe` (integer 100–175, absent 150) |
| `showWaypoint` | a W triangle on the ring at the bearing | `waypointBearing` (default `navigation.course.calcValues.bearingTrue`) |
| `showTarget` | a bar across the ring at the target true wind angle, on the side the wind comes from | `targetAngle` (default `performance.targetAngle`); no fallback |

A `fixedBeat`/`fixedGybe` outside its range gives `OUT_OF_RANGE`, a fraction `INVALID_TYPE`; a switch that isn't a boolean gives `INVALID_TYPE`. The geometry is `roseLaylines()`/`roseTarget()` in `src/windRose.ts`, mirrored by the firmware's `esphelm_wind_rose.h` (`fixtures/wind-rose.cases.json`).

**History** (optional, ADR-0019): the values the rose records, e.g. `"history": ["center1", "apparentAngle"]`.
- Names (`ROSE_HISTORY_KEYS`): the seven slots, then `apparentAngle`, `trueDirection`, `heading`.
- An unknown or repeated name gives `INVALID_VALUE`; a name whose slot is empty records nothing.
- A tap on the rose opens a graph with one button per recorded value. The angles record in degrees.
- Every recorded value counts against the display's limit (`HISTORY.maxValuesPsram` 48, `maxValuesNoPsram` 6); `historyCount(layout)` counts them.

**Size is the device's business.** The layout has no minimum span, because cell size depends on the grid and the screen. The device measures the cell it got (shorter side, in pixels) and draws one of three tiers, `WIND_ROSE_FIT` (generated into the firmware's `esphelm_sizes.h`):

| Tier | Shorter side | Drawn |
|---|---|---|
| full | ≥ 260 px | compass card, heading, centre slots (the biggest font at which all fit); corner slots where they fit outside the ring |
| compact | ≥ 150 px | ring, sectors, pointers, as many slots as fit |
| pointers | < 150 px | ring, sectors and pointers only |

The editor shows the expected tier for the selected display.

### Chart tiles
A map (ADR-0012; a tile since ADR-0030, a page before): tiles of a SignalK chart centred on the vessel, north up, with the vessel, and the anchor position, alarm radius and alarm when `anchor` is on. Only displays with PSRAM render it; they list `chart` in `hello.widgets`, so the plugin refuses chart layouts for others. Several chart tiles can share a page or a layout: the display keeps one store of map tiles for all of them, so charts of the same chart and zoom cost no extra memory.

`ChartTile`: `type: "chart"`, the common placement, `chart` (ChartId: `[A-Za-z0-9][A-Za-z0-9._-]*`, a SignalK chart identifier), `zoom?` (1–20), `anchor?` (boolean) and `config?` with the paths below. Defaults are exported as `CHART_DEFAULTS`:

| Field | Default |
|---|---|
| `zoom` | 15 |
| `anchor` | true |
| `config.positionPath` | `navigation.position` |
| `config.headingPath` | `navigation.headingTrue` |
| `config.anchorPositionPath` | `navigation.anchor.position` (null when the anchor is up) |
| `config.anchorRadiusPath` | `navigation.anchor.maxRadius` (metres) |
| `config.anchorAlarmPath` | `notifications.navigation.anchor` (alarm when `state` is not `normal`/`nominal`) |

A bad or missing `chart` is `INVALID_ID` / `MISSING_FIELD` at `/pages/i/tiles/j/chart`; `zoom` outside 1–20 is `OUT_OF_RANGE`.

**Size is the device's business** (`CHART_FIT`, generated into `esphelm_sizes.h`): the zoom buttons show from 200 px on the cell's shorter side and the position line from 260 px; below 200 px an anchor alarm frames the tile in red instead of the banner (the alarm banner above the page names it).

### Position tiles
GPS position as text: latitude over longitude. The display picks the largest font that fits the tile.

| Field | Notes |
|---|---|
| `path` | default `navigation.position` (an object with `latitude` and `longitude` in degrees) |
| `label` | optional caption |
| `format` | `ddm` (default), `dms`, `dd` or `decimal`, see below |
| `decimals` | 0–6, of the last part (minutes, seconds or degrees); default per format |
| `staleAfter` | seconds, as for other tiles |

| `format` | Example | Default decimals |
|---|---|---|
| `ddm` | `60° 09.000' N` / `024° 57.000' E` | 3 |
| `dms` | `60° 09' 00.0" N` / `024° 57' 00.0" E` | 1 |
| `dd` | `60.15000° N` / `24.95000° E` | 5 |
| `decimal` | `60.150000` / `24.950000` (negative south and west) | 6 |

- In `ddm` and `dms`, latitude degrees have 2 digits and longitude 3, as on charts.
- Rounding carries into the next unit: `59° 59.9999'` at 3 decimals is `60° 00.000'`.
- A value that isn't a position (latitude outside −90…90, longitude outside −180…180, or not numbers) shows `--`.
- `formatPosition()` in `@esphelm/schema` defines the text. The firmware's `esphelm_position.h` mirrors it, and both are checked against `fixtures/position.cases.json`.

There's no `unit` (`UNKNOWN_FIELD`); `POSITION_DEFAULTS` has the defaults.

### Graph tiles
A line graph of a value's recent history (ADR-0021): the caption and live value on top, the window's points below, the newest on the right. The display records the value itself from boot, as for a value tile with `history: true`, and a tap opens the history popup on it.

| Field | Notes |
|---|---|
| DataItem | `path`, `unit`, `decimals`, `label`, `staleAfter`, as for a value tile |
| `window` | `10m` (default), `1h` or `6h` (`GRAPH_WINDOWS`). A display without PSRAM keeps only 10 min and 1 h, so `6h` shows 1 h there (`graphWindowIndex()`) |
| `min`, `max` | optional, both or neither (`INVALID_RANGE`): a fixed y axis in display units, `min` below `max`. Absent: the axis follows the points (their extent plus 10 % each side). A fixed axis clips the line at its edges |
| `zones` | optional value zones, `{ from?, to?, state }` as on a value tile: faint bands behind the line, and they colour the live value. The server's zones replace them (ADR-0020) |

- **It always records:** there's no `history` field (`UNKNOWN_FIELD`). Every graph counts against the display's limit (`HISTORY.maxValuesPsram` 48, `maxValuesNoPsram` 6) in `historySeries()` order. A graph over the limit shows "No history on this display".
- **Axis labels:** from `GRAPH_FIT.axisHeight` (120 px) of content height, the tile also shows its y range and the window's start ("-10 m") and "now". Smaller tiles draw the line only. The editor's size hint says which.
- **Angles** (units with a wrap range) are drawn around their circular mean, so a line across north doesn't jump, unless the axis is fixed: then they stay in the unit's range. Zone bands aren't drawn for angles around their mean.
- Older firmware doesn't list `graph` in its hello `widgets`, so the plugin refuses to assign such a layout to it (`UNSUPPORTED_WIDGET`).

```json
{ "type": "graph", "id": "depth", "x": 0, "y": 0, "w": 2, "h": 1,
  "path": "environment.depth.belowTransducer", "unit": "m", "label": "Depth",
  "window": "1h", "zones": [{ "to": 3, "state": "alarm" }] }
```

### Heading tape tiles
A compass strip that scrolls with the heading under a fixed centre line, with the heading as a number above it (ADR-0022). Whole degrees: there's no `unit` or `decimals` (`UNKNOWN_FIELD`). The number gets "T" or "M" from the heading path, as on the wind rose.

| Field | Notes |
|---|---|
| `label` | optional caption |
| `span` | degrees across the tape, an integer 30–180 (`OUT_OF_RANGE`); default 90 |
| `markers` | which markers to draw: `cog`, `bearing`, `target`, each at most once (`INVALID_VALUE`). Absent: all three; `[]`: none |
| `config` | the paths, all optional: `headingPath` (default `navigation.headingTrue`), `cogPath` (`navigation.courseOverGroundTrue`), `bearingPath` (`navigation.course.calcValues.bearingTrue`, the next waypoint), `targetPath` (`steering.autopilot.target`) |
| `staleAfter` | seconds, as for other tiles |

- **Markers:** COG is a triangle under the tape ("C"), the waypoint bearing a diamond ("W"), the autopilot target a notch above it ("A"). A marker shows only while its value is fresh, so without a route or an autopilot those just don't appear. A marker beyond the tape's edge is drawn as an arrow at that edge, on the side of the shorter turn.
- **Ticks** (`tapeMarks()` in `headingTape.ts`, mirrored by the firmware's `esphelm_heading_tape.h`, shared cases in `fixtures/heading-tape.cases.json`): every 30° major and labelled (N, E, S, W at the cardinal points), every 10° medium, every 5° minor where they're at least `HEADING_TAPE_FIT.minorTickPx` apart; every 10° labelled where 10° is at least `HEADING_TAPE_FIT.label10Px` wide.
- **True and magnetic aren't converted.** Each marker is drawn at its own value, so a magnetic heading with true markers puts them off by the magnetic variation. Keep the paths alike; the editor warns when they differ.
- Defaults are exported as `HEADING_TAPE_DEFAULTS`, marker names as `HEADING_TAPE_MARKERS`.

```json
{ "type": "heading_tape", "id": "hdg", "x": 0, "y": 0, "w": 2, "h": 1,
  "label": "Heading", "span": 60, "markers": ["cog", "target"],
  "config": { "headingPath": "navigation.headingMagnetic" } }
```

### Engine tiles
A large RPM arc, like the legacy engine screen, with three small gauges inside it and up to four values in the tile's corners (ADR-0032). The RPM is the tile's own DataItem, `min`, `max` and `zones`, as on a gauge, so the server's zones apply to it; there's no `centerZero` (`UNKNOWN_FIELD`).

| Field | Notes |
|---|---|
| DataItem | the RPM: `path`, `unit` (usually `rpm`), `decimals`, `label` (shown in the centre, else the unit's label), `staleAfter` |
| `min`, `max`, `zones` | the RPM scale, `min` below `max` (`INVALID_RANGE`), zones inside it (`ZONE_OUT_OF_RANGE`) |
| `slots` | required, may be `{}`: the gauges `left`, `right` and `bottom`, each an `EngineSlot`, and the corner values `topLeft`, `topRight`, `bottomLeft` and `bottomRight`, each a plain DataItem as a wind rose's corners (`UNKNOWN_SLOT` for other names; a range or icon on a corner is `UNKNOWN_FIELD`) |

An `EngineSlot` is a DataItem plus `min`, `max` (required, `MISSING_FIELD`), `zones?` and `icon?`: `oil`, `fuel`, `temperature`, `battery` or `none` (`INVALID_VALUE`). Without an icon the slot shows its `label` in small text. Each slot's range and zones are checked like the RPM's, with pointers such as `/pages/0/tiles/0/slots/left/max`.

- **Icons:** the oil, fuel, temperature and battery icons are SVG path data in `engine.ts` (Material Design Icons, Apache-2.0), flattened to polygons by `svgPath.ts` and filled with the nonzero rule by the firmware and the editor alike.
- **Geometry** (`engine.ts`; the arcs, radii and icon polygons are generated into the firmware's `esphelm_engine_shapes.h`, `engineScale()` and `engineAngle()` mirrored by `esphelm_engine.h`, shared cases in `fixtures/engine.cases.json`): the RPM arc sweeps 240° from lower left over the top to lower right, open at the bottom. `left` and `right` are 90° arcs inside it, both rising upward; `bottom` is an 80° arc in the opening, rising left to right.
- **RPM ticks:** the smallest step of 1, 2 or 5 times a power of ten with at most 8 intervals, labelled; medium ticks halfway, minor ticks every tenth where they're at least `ENGINE_FIT.minorTickPx` apart. A scale reaching 1000 or more is labelled in hundreds, with "x100" under the title. Zones colour a band outside the ticks; ticks in an alarm or emergency zone are red. Slots have 5 ticks.
- **Size tiers** (`ENGINE_FIT`, by the shorter side in display pixels): the slots from `slots` (260), the labels and title from `labels` (160), below that the RPM arc alone.
- **Corner values** show with the slots, each a value over its caption (label and unit) in the label font, else the small one, as on a wind rose, and only where its box clears the RPM arc: outside the circle of radius R, or for a bottom corner, below the arc's ends (`ENGINE_GEOMETRY.corners.openBelow`, 0.52 R under the centre) and outside the bottom gauge (`bottomRadius`, 0.9 R). A wider or taller tile than square has the most room.
- A value that goes stale mutes its needle and icon. Defaults for a new tile are exported as `ENGINE_DEFAULTS`, slot names as `TILE_SLOTS.engine`, icon names as `ENGINE_ICON_NAMES`.

```json
{ "type": "engine", "id": "port", "x": 0, "y": 0, "w": 2, "h": 2,
  "path": "propulsion.port.revolutions", "unit": "rpm", "label": "RPM", "min": 0, "max": 4000,
  "zones": [{ "from": 3200, "to": 4000, "state": "alarm" }],
  "slots": {
    "left": { "path": "propulsion.port.oilPressure", "unit": "bar", "min": 0, "max": 6, "icon": "oil" },
    "bottom": { "path": "propulsion.port.temperature", "unit": "degC", "min": 40, "max": 120,
                "zones": [{ "from": 95, "to": 120, "state": "alarm" }], "icon": "temperature" },
    "topLeft": { "path": "propulsion.port.runTime", "unit": "h", "decimals": 0, "label": "Hours" }
  } }
```

### Clock tiles
The display's own time and/or date, in the layout's time zone (`settings.timeZone`) or in UTC (ADR-0024). A clock has no `path` (`UNKNOWN_FIELD`): the display sets its clock from `settings.clockPath` (GPS time) or from its board's time source, and keeps it running offline. It shows `--`, muted, until it has a time.

| Field | Notes |
|---|---|
| `label` | optional caption |
| `show` | `time` (default), `date` or `both` |
| `hour12` | 12-hour time with AM/PM; default 24-hour |
| `seconds` | show seconds; default off |
| `dateFormat` | `ymd` (2026-11-04, the default), `dmy` (04.11.2026), `mdy` (11/04/2026) or `weekday` (Wed 4 Nov) |
| `utc` | UTC instead of the layout's time zone; the caption says "UTC" |

- **Text** (`clockTime()`, `clockDate()` in `clock.ts`, mirrored by the firmware's `esphelm_clock.h`, shared cases in `fixtures/clock.cases.json`): 24-hour time zero-padded ("09:05"), 12-hour without ("9:05" and "AM"). Defaults are exported as `CLOCK_DEFAULTS`, formats as `CLOCK_DATE_FORMATS`.

```json
{ "type": "clock", "id": "local", "x": 0, "y": 0, "w": 2, "h": 1,
  "show": "both", "hour12": true, "dateFormat": "weekday" }
```

### Autopilot tiles
Shows the autopilot state, target and heading, with course and mode buttons that send PUTs (classic SignalK autopilot paths, as the legacy app). Safety rules: ADR-0011.

| Field | Notes |
|---|---|
| `label` | optional caption |
| `modes` | unique, from `auto`, `wind`, `route` (shown as AUTO, WIND, TRACK), in button order; default all three. STANDBY is always offered. A duplicate or unknown entry gives `INVALID_VALUE` (at `/modes` or at the entry). |
| `config.statePath` | default `steering.autopilot.state` (string; the mode buttons PUT their mode here, STANDBY puts `standby`) |
| `config.targetPath` | default `steering.autopilot.target` (radians, shown in degrees) |
| `config.adjustPath` | default `steering.autopilot.actions.adjustHeading` (PUT ±1 / ±10, degrees) |
| `config.headingPath` | default `navigation.headingMagnetic` (shown as HDG) |

Defaults are exported as `AUTOPILOT_DEFAULTS`. The device shows the buttons only when the tile's content box is at least `AUTOPILOT_FIT` (260×220 px, generated into `esphelm_sizes.h`); smaller tiles show status only.

### Settings
Display settings travel with the layout (one layout per display), so they're validated, cached and applied offline like the rest (ADR-0015). All fields are optional; defaults are exported as `SETTINGS_DEFAULTS`.

| Field | Default | Notes |
|---|---|---|
| `brightness.day` | 100 | backlight in %, 5–100, while the day or dark theme is shown |
| `brightness.night` | 30 | backlight in %, 1–100, while the night theme is shown |
| `startPage` | first page | page id shown at boot; must be a page of this layout (`UNKNOWN_PAGE`) |
| `autoTheme` | `off` | `sun`: the night theme while `autoThemePath` is `dusk` or `night` (`NIGHT_SUN_STATES`), else the day-side theme: day or dark as last picked on the display, or the layout's `theme` (day when that is `night`; ADR-0034). Without a value the layout's `theme` stays. |
| `autoThemePath` | `environment.sun` | set by the derived-data plugin (`dawn`, `sunrise`, `day`, `sunset`, `dusk`, `night`) |
| `screenTimeout` | 0 | seconds without a touch before the screen turns off, 0–3600; 0 = never. Displays apply at least 10 s. |
| `screenSaver` | `off` | what the screen shows after `screenTimeout` instead of turning off: `time`, `date` or `both`, faintly, on black (ADR-0024). Written like the layout's first clock tile (else 24-hour, weekday date). Until the display knows the time it goes dark as with `off`. |
| `screenSaverBrightness` | 30 | backlight in %, 1–100, while the screen saver shows. Some panels (the P4-86) are dark below about 30 %. |
| `rotation` | 0 | how the display is mounted: 0, 90, 180 or 270 degrees clockwise (ADR-0028). The display turns its picture and touch before it builds the page, and the layout is designed for the turned screen. Displays that can't turn (`capabilities.rotation` false or absent) ignore it. |
| `sound.volume` | 60 | speaker volume in %, 10–100, for touch clicks and alarm tones (ADR-0033). At least 10 %, so alarms stay audible. |
| `sound.touch` | true | a click when a button or tile is touched. Alarms sound when their notification's `method` contains `"sound"`, whatever this says. Displays without a speaker (`capabilities.sound` false or absent) ignore `sound`. |
| `timeZone` | UTC | `{ name, posix }`: the IANA zone (`name`, `^[A-Za-z0-9_+/-]{1,64}$`) and its POSIX TZ rule (`posix`, `POSIX_TZ_PATTERN`, `INVALID_FORMAT` otherwise), see below |
| `clockPath` | `navigation.datetime` | where the display's clock comes from: an ISO 8601 date-time with a zone (a GPS gives it) |

Brightness needs a backlight the firmware can dim (`capabilities.backlight` in the hello); other displays ignore it.

**Time zones (ADR-0024).** SignalK has no time zone, and a display has no zone database, so the layout carries the zone as a POSIX TZ rule, which includes summer time, and the display follows it offline. The editor builds the rule from the browser's zone data (`posixTz()` in `clock.ts`) in the restricted form `localOffset()` reads:

```text
<+01>-1<+02>,M3.5.0,M10.5.0/3     standard name and offset (west positive), summer name, start and end rules
<+0530>-5:30                      a zone without summer time
```

Names are numeric in `<...>` (as the tz database writes them) or three or more letters. A rule `Mm.w.d[/time]` is the month, the week 1–5 (5: the last), the weekday 0–6 (Sunday 0) and the local time of the change (default 2:00). It matches the browser's zone for every IANA zone in 2026, and for every zone whose rules stay the same in later years. Morocco's summer time pauses for Ramadan, which a rule can't express, so it is right only for the year the editor built it in.

```json
"settings": { "timeZone": { "name": "Europe/Stockholm", "posix": "<+01>-1<+02>,M3.5.0,M10.5.0/3" },
              "screenTimeout": 300, "screenSaver": "both" }
```

## 3. Validation and error codes
`validateLayout(input)` returns `{ ok, value?, errors[] }`, with each error `{ pointer, code, message }`. `pointer` is an RFC 6901 JSON Pointer into the input. It works in two stages, and the **firmware mirrors both and logs the same codes**:

1. **Structure (JSON Schema).** Dispatches on `kind` / `widget` / `type`, so each problem is reported once, at the field that is wrong.
2. **Semantics** (only if the structure is valid). These are rules JSON Schema can't express.

| Code | Stage | Meaning |
|---|---|---|
| `INVALID_TYPE` | structure | wrong JSON type (e.g. layout is not an object) |
| `MISSING_FIELD` | structure | required field missing (pointer = the missing field) |
| `UNKNOWN_FIELD` | structure | field not allowed here (pointer = the extra field) |
| `INVALID_VALUE` | structure | not one of the allowed values (theme, zone state, rotation, …) |
| `OUT_OF_RANGE` | structure | number below/above its bound (x < 0, decimals > 6, …) |
| `INVALID_FORMAT` | structure | string doesn't match its format (fields without a more specific code) |
| `TOO_FEW` | structure | array shorter than allowed (fields without a more specific code) |
| `UNSUPPORTED_VERSION` | structure | `version` isn't 1; validation stops here |
| `NO_PAGES` | structure | `pages` is empty |
| `EMPTY_PAGE` | structure | grid page without tiles |
| `INVALID_ID` / `INVALID_LABEL` / `INVALID_PATH` | structure | primitive rule failed (§2) |
| `UNKNOWN_UNIT` | structure | unit not in `units.json` |
| `UNKNOWN_PAGE_KIND` / `UNKNOWN_TILE_TYPE` | structure | discriminator not in the catalog (`kind: "widget"` included, ADR-0010) |
| `UNKNOWN_SLOT` | structure | slot name not defined by the tile type |
| `DUPLICATE_ID` | semantic | page ids unique; tile ids unique **across the whole layout** (pointer = the second use) |
| `TILE_OUT_OF_GRID` | semantic | `x + w > cols` or `y + h > rows` |
| `TILE_OVERLAP` | semantic | tile shares a cell with an earlier tile (pointer = the later tile) |
| `INVALID_RANGE` | semantic | gauge/bar/engine (or an engine slot's) `min` is not below `max`; a centre-zero gauge/bar whose range doesn't cross zero; a graph with only one of `min`/`max`, or `min` not below `max` |
| `INVALID_ZONE` | semantic | zone `from` is not below `to`; a value or graph zone with neither `from` nor `to` |
| `ZONE_OUT_OF_RANGE` | semantic | zone outside `[min, max]` |
| `UNKNOWN_PAGE` | semantic | `settings.startPage` isn't a page of the layout |

**Device-only codes** (firmware parser, never produced by `validateLayout`):

| Code | Meaning |
|---|---|
| `INVALID_JSON` | the body isn't valid JSON (truncated, garbage, empty) |
| `CAPACITY_EXCEEDED` | the body, a string or the nesting depth exceeds the device's capacity guard, or memory ran out while building. See `docs/firmware-runtime.md`. |

The published JSON Schema carries an annotation keyword `errorCode` with the code for each constraint. It never affects validity, but a strict validator must be told about it: in Ajv, `ajv.addKeyword({ keyword: 'errorCode', schemaType: 'string' })`.

## 4. Units
SignalK values are SI. A tile's `unit` picks a display unit:

```
display = si × factor + offset, then wrapped into [min, max) if the unit has a wrap
```

A value within `1e-9 × span` below the upper wrap bound snaps to the lower bound, so 2π rad shows as 0°, not 359.999…°. Both implementations (`toDisplay` in TS, `esphelm::units::to_display` in C++) are generated from `units.json`, and both are checked against the same 59 cases in `fixtures/units.cases.json` on every `npm test`.

Angles have two display units: **`deg` wraps to 0..360** (headings, true wind direction) and **`deg180` wraps to −180..180** (apparent wind angle, negative to port).

| Quantity | SI | Display units (label) |
|---|---|---|
| speed | `mps` | `mps` (m/s), `kn` (kn), `kmh` (km/h), `mph` (mph) |
| angle | `rad` | `rad` (rad), `deg` (°, wrap 0..360), `deg180` (°, wrap −180..180) |
| angularVelocity | `radps` | `radps` (rad/s), `degps` (°/s), `degpm` (°/min) |
| temperature | `K` | `K` (K), `degC` (°C), `degF` (°F) |
| ratio | `ratio` | `ratio` (no label), `pct` (%) |
| frequency | `Hz` | `Hz` (Hz), `rpm` (rpm) |
| length | `m` | `m` (m), `km` (km), `nmi` (nm), `ft` (ft), `fathom` (fa) |
| volume | `m3` | `m3` (m3), `L` (L), `gal` (gal, US) |
| flow | `m3ps` | `m3ps` (m3/s), `Lpm` (L/min), `Lph` (L/h), `galph` (gal/h) |
| pressure | `Pa` | `Pa`, `hPa`, `mbar`, `bar`, `psi` |
| charge | `coulomb` | `coulomb` (C), `Ah` (Ah) |
| energy | `J` | `J`, `kWh` |
| power | `W` | `W`, `kW` |
| voltage | `V` | `V` |
| current | `A` | `A`, `mA` |
| time | `s` | `s`, `min`, `h` |

Each quantity in `units.json` also names the SignalK `meta.units` string it corresponds to (`signalk`: `m/s`, `rad`, `K`, `ratio`, `Hz`, `m`, `m3`, `m3/s`, `Pa`, `C`, `J`, `W`, `V`, `A`, `s`, `rad/s`). `quantityForSignalKUnits()` and `unitsForSignalKUnits()` use it, so the editor offers only the display units that fit a path.

v1 doesn't check that a tile's unit matches the path's quantity (e.g. `kn` on a temperature path). That needs the path's SignalK `meta.units`. The editor (Phase 4) only offers fitting units, but the validator itself doesn't enforce it.

## 5. Device `hello`
Sent by the device on boot and reconnect. Schema: `hello.schema.json`, validator `validateHello()`.

| Field | Notes |
|---|---|
| `deviceId` | hex + dashes; the same MAC-derived UUID used as the SignalK access-request `clientId` (ADR-0003) |
| `fw.version` | firmware version string |
| `fw.build?` | id of the running build, 64 lowercase hex characters (ADR-0036): the app descriptor's `app_elf_sha256` on ESP32, the sha256 of the program on the host build. An update is done when the display reports the target build |
| `schema.major` | highest layout major the firmware parses |
| `board` | board/model name |
| `display` | `width`, `height` (px), `rotation` (0/90/180/270), `kind?`: `color` or `mono` (black and white only, e.g. a reflective LCD; from the firmware's tile set, ADR-0035). Missing means `color`; colour firmware leaves it out, so plugins from before the field accept its hello |
| `widgets` | tile types this firmware renders |
| `fonts?` | semantic font sizes available |
| `fontLineHeights?` | line heights (px) of the fonts tile text can use, smallest first; the editor sizes its preview text from them (ADR-0017). Integers ≥ 1 |
| `digitFontLineHeights?` | the same for the digits-only fonts (glyphs `0123456789.-`), which only a value tile's number uses, while its text is numeric |
| `capacity` | `psram` (bool, required), `maxLayoutBytes?`, `freeHeapBytes?`; measured by the device |
| `capabilities` | `touch`, `put` (the token allows PUT), `backlight?` (the firmware can dim the backlight), `rotation?` (the firmware can turn the picture for `settings.rotation`; `display.width`/`height` are then as turned, and `display.rotation` says by how much), `sound?` (the display has a speaker: touch clicks and alarm tones, `settings.sound`), `ota?` (the firmware takes firmware updates from the plugin, ADR-0036; the editor offers *Update* only then) |
| `layoutEtag?` | ETag of the cached layout |
| `recovery?` | `skippedLayoutEtag`: a layout that crashed the display; refused until a changed one is sent (ADR-0013) |

## 6. Examples
See `packages/schema/fixtures/valid/`:
- `minimal.json`: one tile.
- `grid-2x2-values-480.json`: four speeds on a 480² screen.
- `mixed-720.json`: gauge, bar, value and switch, with multi-cell tiles.
- `three-pages-wind-rose.json`: a full-screen wind rose with three slots, a grid page, and a rose with empty slots.
- `rose-performance.json`: a full-screen rose with laylines (fixed angles 42/155), the waypoint and the target angle, and AWS and VMG in the centre.
- `legacy-port.json`: today's wind, grid, energy and engine apps, using their real SignalK paths.
- `multi-page-widgets-480.json`: every tile type over four pages, including a 2x2 and a 1x1 rose next to engine tiles.
- `rose-and-engine-720.json`, `two-roses.json`: roses sharing pages with other tiles and with each other.
- `autopilot.json`: a full-screen autopilot, one next to a rose, and a status-only one with custom modes and paths.
- `chart-page.json`: a page with a default chart tile filling it, an anchor page with every path set, and a value page.
- `chart-tiles.json`: a 2x2 chart beside a wind rose and a 1x1 chart of the same chart (they share their map tiles), and a value page.
- `settings.json`: every display setting, with the second page as start page.
- `position.json`: the four position formats, one with custom decimals.

Starter layouts are in `packages/schema/templates/` (exported as `TEMPLATES`). Ids ending in `-720` are denser layouts for larger displays. *Passage* uses only the tiles a black-and-white display renders (value, bar, position, clock), on a 400×300 screen.

The invalid examples in `fixtures/invalid/` each break one rule and list the expected `{ code, pointer }`.
