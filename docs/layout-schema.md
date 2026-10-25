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
- Within a major, changes are **additive only**: new optional fields, new tile types, new full-page widgets.
  - The plugin and editor validate strictly (`additionalProperties: false`).
  - **Firmware ignores unknown fields** but validates every field it knows. That lets older firmware accept a layout written for newer firmware of the same major. Verified by `firmware/test/parser.cpp.test.ts`: the C++ parser reports exactly the TS codes and pointers on every fixture and extra mutations, except `UNKNOWN_FIELD`.
  - Slot names are part of a widget's contract, so an unknown slot is still `UNKNOWN_SLOT` on the device.
  - The plugin doesn't send a device a tile type or widget it didn't list in `hello.widgets`.
- Removing or changing the meaning of a field requires a new major (CLAUDE.md golden rule 7: ask first).

## 2. Structure

```
Layout
├─ version: 1
├─ id: Id
├─ name?: Label
├─ theme: "day" | "night"
└─ pages: Page[]            (at least 1)

Page = GridPage | WidgetPage          (discriminator: kind)

GridPage                              kind: "grid"
├─ id: Id, title?: Label
├─ grid: { cols ≥ 1, rows ≥ 1 }
└─ tiles: Tile[]            (at least 1)

WidgetPage                            kind: "widget", discriminator: widget
└─ wind_rose: { id, title?, config?, slots }

Tile = value | gauge | bar | switch   (discriminator: type)
  common: id, x ≥ 0, y ≥ 0, w ≥ 1, h ≥ 1   (grid cells, 0-based)
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
A value bound to one SignalK path. It is used by `value`/`gauge`/`bar` tiles and by full-page widget slots.

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
| `value` | DataItem fields | big number + label + unit |
| `gauge` | DataItem + `min`, `max`, `zones?` | round gauge with needle |
| `bar` | DataItem + `min`, `max`, `zones?`, `orientation?` (`horizontal` / `vertical`) | tank level, SoC |
| `switch` | `path`, `label?` | boolean path: shows state, sends a PUT to the same path when tapped. Takes no `unit`. |

`min`, `max` and zones are in **display units**. A `Zone` is `{ from, to, state }` with `state` one of `normal`, `warn`, `alarm`, `emergency` (the SignalK alarm states). The theme supplies the colours; layouts never carry hex colours.

### Full-page widgets
A full-page widget draws a fixed design and exposes **named slots at predetermined positions**. Each slot shows a DataItem you choose. Slots are optional; an empty slot shows nothing.

| `widget` | Slots | `config` (all optional) |
|---|---|---|
| `wind_rose` | `center1`, `center2`, `center3` (stacked in the centre of the rose) | `apparentAngle` (default `environment.wind.angleApparent`), `trueDirection` (default `environment.wind.directionTrue`), `heading` (default `navigation.headingTrue`), `showTrueWind` (default `true`) |

An unknown slot name gives `UNKNOWN_SLOT`. Defaults are exported as `WIND_ROSE_DEFAULTS`. The `wind_rose` renderer lands in Phase 5; until then, firmware that can't render it doesn't list it in `hello.widgets`.

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
| `UNKNOWN_PAGE_KIND` / `UNKNOWN_WIDGET` / `UNKNOWN_TILE_TYPE` | structure | discriminator not in the catalog |
| `UNKNOWN_SLOT` | structure | slot name not defined by the widget |
| `DUPLICATE_ID` | semantic | page ids unique; tile ids unique **across the whole layout** (pointer = the second use) |
| `TILE_OUT_OF_GRID` | semantic | `x + w > cols` or `y + h > rows` |
| `TILE_OVERLAP` | semantic | tile shares a cell with an earlier tile (pointer = the later tile) |
| `INVALID_RANGE` | semantic | gauge/bar `min` is not below `max` |
| `INVALID_ZONE` | semantic | zone `from` is not below `to` |
| `ZONE_OUT_OF_RANGE` | semantic | zone outside `[min, max]` |

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

v1 doesn't check that a tile's unit matches the path's quantity (e.g. `kn` on a temperature path). That needs the path's SignalK `meta.units`, which the editor will check in Phase 4 using the server's metadata.

## 5. Device `hello`
Sent by the device on boot and reconnect. Schema: `hello.schema.json`, validator `validateHello()`.

| Field | Notes |
|---|---|
| `deviceId` | hex + dashes; the same MAC-derived UUID used as the SignalK access-request `clientId` (ADR-0003) |
| `fw.version` | firmware version string |
| `schema.major` | highest layout major the firmware parses |
| `board` | board/model name |
| `display` | `width`, `height` (px), `rotation` (0/90/180/270) |
| `widgets` | tile types and full-page widgets this firmware renders |
| `fonts?` | semantic font sizes available |
| `capacity` | `psram` (bool, required), `maxLayoutBytes?`, `freeHeapBytes?`; measured by the device |
| `capabilities` | `touch`, `put` (the token allows PUT) |
| `layoutEtag?` | ETag of the cached layout |

## 6. Examples
See `packages/schema/fixtures/valid/`:
- `minimal.json`: one tile.
- `grid-2x2-values-480.json`: four speeds on a 480² screen.
- `mixed-720.json`: gauge, bar, value and switch, with multi-cell tiles.
- `three-pages-wind-rose.json`: wind rose with three slots, a grid page, and a wind rose with empty slots.
- `legacy-port.json`: today's wind, grid, energy and engine apps, using their real SignalK paths.

The invalid examples in `fixtures/invalid/` each break one rule and list the expected `{ code, pointer }`.
