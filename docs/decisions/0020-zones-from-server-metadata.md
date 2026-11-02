# ADR-0020: Tiles follow the zones in SignalK metadata

Status: **Accepted** (2026-10-31)

## Context
You asked for value, gauge and bar tiles to use the zones in the server's metadata (`meta.zones`), and to follow them when they change on the server.

ESPHomeSignalK's metadata support only went from device to server. `on_message` ignored `updates[].meta`.

Measured on signalk-server 2.17.2, 2.19.0 and 2.26.0:
- A meta delta reaches a subscribed path, but through the same `minPeriod` throttle as values. At the library's default 200 ms, 25–40 % were dropped while values were arriving; at 0, none were.
- A meta delta may hold only some keys (the library's own `publish_meta_delta` does this), so a delta without `zones` doesn't mean they were removed.
- An emptied `zones` list is stored as `null`. A path the server doesn't know answers 404.

## Decision
- **The display reads the metadata itself**, over HTTP: `GET /signalk/v1/api/vessels/self/<path>/meta`, one request at a time, on the HTTP worker.
- **The server wins:** if a path has usable zones on the server, every value, gauge and bar tile on that path uses them. Otherwise the tile's own zones apply. No new layout field: the schema doesn't change.
- **When it reads:** the visible page's paths, when a layout or page is shown, on (re)connect, and every 60 s. A meta delta is only a hint (`add_meta_listener` in ESPHomeSignalK) that reads that path after 1 s. A change usually shows within seconds, and within about a minute if the delta was dropped.
- **Applying:** `tile.zones` holds the effective zones, `tile.own_zones` the layout's. When the visible page's zones really change, the page is rebuilt once. The rebuild waits while the history popup is open or the screen is off.
- **In RAM only.** The layout, its ETag and the flash are untouched. Values come from the same server as the metadata, so without a server there are no live values to colour.
- **Conversion** (`serverZonesToDisplay` in `packages/schema/src/serverZones.ts`, mirrored in `esphelm_server_zones.h`; shared cases in `fixtures/server-zones.cases.json`):
  - **Units:** SI to the tile's display unit, linear, without wrapping. No unit: SI.
  - **States:** `nominal` and `normal` are `normal`; `alert` is `warn`; `warn`, `alarm` and `emergency` stay.
  - **Value tiles:** a missing or null end stays open.
  - **Gauges and bars:** a missing end is the scale's end, zones are clipped to the scale, one outside it is dropped.
  - **Dropped:** an unknown state, an end that isn't a number, no ends at all, lower not below upper.
  - **Limit:** the first 16 usable zones of a path (`SERVER_ZONES.maxPerPath`).
- **Untrusted input:** a 4 KB body limit, and only `zones` is kept while parsing. A body that is too long or unreadable, a transport error, 401 or 5xx keeps the zones already known and tries again at the next read. A 404 or no usable zones means the tile's own.
- **Editor:** `/api/paths` carries `zones`. Previews use the effective zones. The drawer lists the server's zones as read-only, above the tile's own, which stay editable as the fallback.

## Consequences
- **Alarm banner too:** signalk-server raises its own notification for a value in a zone, on `notifications.<path>`. So a tile's colour and the display's alarm banner (ADR-0014) now come from one definition.
- **Boot with no server:** a gauge or bar draws its own zones until the server's arrive, then the page rebuilds.
- **A rebuild resets** an autopilot's armed state and a switch's pending state. That is the safe direction, and zones rarely change.
- **Traffic:** one small GET per path of the visible page, per minute.
- **Editing zones in the editor** has no effect on a path whose zones come from the server. The drawer says so.
- **Limit:** an angle zone across north (350° to 10°) doesn't match, since the value wraps and the zone doesn't.
- **Dependency:** the firmware needs ESPHomeSignalK with `add_meta_listener`.
