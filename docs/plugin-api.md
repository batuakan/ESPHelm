# signalk-esphelm plugin API

Package `packages/plugin` (npm name `signalk-esphelm`, plugin id `esphelm`). Data is stored under the plugin data dir (`app.getDataDirPath()`):

| File | Content |
|---|---|
| `layouts/<layoutId>.json` | one layout, validated with `validateLayout` on save **and** on load. Invalid files are reported in the plugin status and never served. A file with the pre-5b wind-rose page kind is migrated on load (`migrateLayout`: a 1x1 grid page with a `wind_rose` tile) and rewritten once. |
| `devices.json` | device registry: `{ [deviceId]: { id, state: "pending" \| "adopted", name?, layoutId?, hello, firstSeen, lastSeen } }` |

Writes are atomic (temp file + rename).

## Authentication

| API | Mount | Who |
|---|---|---|
| Editor | `/plugins/esphelm/api/*` (`registerWithRouter`) | **admin**. signalk-server enforces this for every `/plugins/*` route when security is on. Device tokens get 401. |
| Device | `/signalk/v1/api/esphelm/*` (`signalKApiRoutes`) | an approved **device token with read/write permission** whose `clientId` is the device id. The plugin checks this itself (see below). |

The server lets every request through to `/signalk/v1/api/*`, including anonymous ones (as principal `AUTO`/readonly when `allow_readonly` is on). The device API therefore rejects:

| Request | Status | `error` |
|---|---|---|
| no token, or the anonymous `AUTO` principal | 401 | `DEVICE_TOKEN_REQUIRED` |
| token without read/write (e.g. readonly) | 403 | `READWRITE_REQUIRED` |
| token of a different device | 403 | `DEVICE_MISMATCH` |

An admin token may act for any device. When SignalK security is **disabled** there are no principals: the device API accepts every request, reports `"security": "disabled"` in hello responses, and says so in the plugin status.

Devices get their token from the SignalK access-request flow (ESPHomeSignalK implements it). Approve the request in the SignalK admin UI under *Security → Access Requests* with **read/write** permission.

## Device API

### `POST /signalk/v1/api/esphelm/devices/hello`
Body: a `Hello` (`packages/schema`, `docs/layout-schema.md` §5). First contact registers the device as `pending`; later hellos refresh `hello` and `lastSeen` and keep the state.

| Status | Body |
|---|---|
| 200 | `{ state, versionPath, layoutEtag, security }`. `layoutEtag` is the ETag of the layout the device should show, or `null`. |
| 400 | `{ error: "INVALID_HELLO", errors: [{ pointer, code, message }] }` |
| 401/403 | see Authentication |
| 503 | `{ error: "NOT_STARTED" }`: plugin installed but not running |

### `GET /signalk/v1/api/esphelm/devices/:id/layout`

| Status | Meaning |
|---|---|
| 200 | layout JSON (compact bytes), with headers `ETag: "<16 hex>"` and `Cache-Control: no-cache` |
| 304 | `If-None-Match` matches the current ETag (weak comparison, `*` allowed); empty body, `ETag` repeated |
| 404 | `error` is `NOT_REGISTERED` (send hello first), `NOT_ADOPTED` (adopt in the editor) or `NO_LAYOUT` (nothing assigned) |
| 401/403/503 | as above |

The ETag is the first 16 hex characters of the SHA-256 of the exact bytes served, so it changes exactly when the layout bytes do.

### `GET /signalk/v1/api/esphelm/tiles/:chart/:z/:x/:y`
A chart tile for chart pages (ADR-0012). Needs a device token like the other device routes.

The plugin looks `:chart` up in the SignalK resources API and fetches its tile from the chart's tile URL: `url` of a v2 `tilelayer` chart (`format`, `type`, `url`, as signalk-charts-provider-simple publishes them), or the v1 `tilemapUrl`. Relative URLs are fetched from this server over HTTP (port as signalk-server works it out: `PORT`, else `settings.port`, else 3000) with the request's `Authorization`; absolute URLs (online chart sources) never get the token. The tile is decoded (PNG with pngjs, JPEG with jpeg-js).

| Status | Meaning |
|---|---|
| 200 | 131,072 bytes `application/octet-stream`: 256×256 RGB565 little-endian, row by row; `ETag`, `Cache-Control: max-age=3600` |
| 304 | `If-None-Match` matches |
| 400 | `BAD_TILE`: z/x/y not a tile |
| 404 | `UNKNOWN_CHART`, or `NO_TILE` (the chart has none there) |
| 415 | `UNSUPPORTED_CHART`: not a raster PNG/JPEG `tilelayer` chart with a {z}/{x}/{y} URL (e.g. WMS, WMTS, S-57, `webp` tiles) |
| 502 | `CHART_SERVER`, `BAD_TILE_IMAGE`, `BAD_TILE_SIZE` (tiles must be 256×256) |

Converted tiles are kept in a 64-tile LRU (about 8 MB).

### `POST /signalk/v1/api/esphelm/notifications/ack`
Acknowledges an alarm from a display (ADR-0014). Body `{ "path": "notifications.…" }`. Needs a read/write device token.

signalk-server before 2.26 has no acknowledge API (2.26.0 adds `POST /signalk/v2/api/notifications/:id/acknowledge` and `/silence`, not used yet; see ADR-0014), so the plugin silences the notification itself, under the notification's own `$source` so no silenced copy stays beside it:
1. It republishes the current value with `"sound"` removed from `method`. The state and message stay, so the alarm stays visible everywhere.
2. Its delta input handler (`registerDeltaInputHandler`) removes `"sound"` from later deltas of that path for this vessel, while the state stays the acknowledged one. A source that resends the alarm every few seconds therefore stays silent.
3. Any other state (escalation, or `normal`) ends the acknowledgement, so an escalation sounds again.

| Status | Meaning |
|---|---|
| 200 | `{ path, state }`: acknowledged |
| 400 | `INVALID_PATH`: not a `notifications.*` path (no wildcards) |
| 404 | `NO_ALARM`: no notification there, or its state isn't `alert`, `warn`, `alarm` or `emergency` |

Acknowledgements are kept in memory; a plugin or server restart forgets them. Clients that ignore `method` (and sound for every alarm state) aren't affected.

### Change notification
On every change that alters what a device would download (layout saved with different bytes, assignment changed, adopted or un-adopted, device deleted), and once for every device on plugin start, the plugin emits:

```
context: vessels.self
path:    plugins.esphelm.<deviceId>.version
value:   "<ETag>"   or null when nothing is served
```

The device subscribes to that path over its existing SignalK WebSocket. The server replays the last value on subscribe (verified). When the value differs from the device's cached ETag, the device fetches the layout with `If-None-Match`.

## Editor API (admin)

| Method and path | Body | Result |
|---|---|---|
| `GET /plugins/esphelm/api/widgets` | | `{ tiles, tileSlots: { wind_rose: [slot names] }, units, quantities }` |
| `GET /plugins/esphelm/api/charts` | | `[{ identifier, name, format, tilemapUrl?, bounds?, supported, reason? }]` from the resources API (v1 or v2 shape); `supported` = raster PNG/JPEG `tilelayer` with a tile URL, otherwise `reason` says why (e.g. `WMS charts`, `webp tiles`) |
| `GET /plugins/esphelm/api/paths` | | `[{ path, units, description, value, timestamp }]`: the server's self paths (`streambundle.getAvailablePaths()`), SignalK `meta.units`/description (`getMetadata`), and the latest value (`getSelfPath`), for the editor's path picker |
| `GET /plugins/esphelm/api/layouts` | | `[{ id, name, pages, bytes, etag, devices }]` |
| `GET /plugins/esphelm/api/layouts/:id` | | the layout (`ETag` header) |
| `PUT /plugins/esphelm/api/layouts/:id` | Layout | 200 `{ id, etag, bytes, warnings }`. 400 `INVALID_LAYOUT` (validator codes) or `ID_MISMATCH`. 409 `INCOMPATIBLE` if a device using it can't render the new version (nothing is saved). |
| `DELETE /plugins/esphelm/api/layouts/:id` | | 204. 404 `UNKNOWN_LAYOUT`. 409 `LAYOUT_IN_USE` with `devices`. |
| `GET /plugins/esphelm/api/devices` | | device records plus `servedEtag` |
| `PUT /plugins/esphelm/api/devices/:id` | `{ state?: "pending" \| "adopted", name?: Label \| null, layoutId?: string \| null }` | 200 `{ device, warnings }`. 400 `INVALID_DEVICE_UPDATE`. 404 `UNKNOWN_DEVICE` / `UNKNOWN_LAYOUT`. 409 `INCOMPATIBLE`. |
| `DELETE /plugins/esphelm/api/devices/:id` | | 204 (a `null` version is published). 404. |

**Compatibility.** These are checked against the device's last `hello`:

| Check | Result |
|---|---|
| layout major above `schema.major` | `UNSUPPORTED_SCHEMA`, refused (409) |
| layout uses a tile type the device doesn't list in `widgets` | `UNSUPPORTED_WIDGET`, refused (409) |
| layout bytes above `capacity.maxLayoutBytes` | `LAYOUT_TOO_LARGE`, a **warning** only (no hard limits in v1) |

## Editor webapp
The package is also a `signalk-webapp`: signalk-server serves `public/` (the editor, built by `npm run build`) at `/signalk-esphelm/`. It uses the editor API above with the browser's SignalK login (docs/editor.md).

## Development install
- **Unit and route tests:** `npm test`.
- **End to end:** `npm run build && npm run e2e -w signalk-esphelm`. This starts a real signalk-server with security on, in a throwaway config dir, with real admin and device tokens. Set `SIGNALK_SERVER=/path/to/bin/signalk-server` to pick an install.
- **Into your own server** (manual, when you want to try it): `npm run build`, then symlink `packages/plugin` into the server config dir's `node_modules/signalk-esphelm`, add `"signalk-esphelm": "*"` to that dir's `package.json` dependencies, restart, and enable *ESPHelm* under *Server → Plugin Config*. Packaging for npm/App Store comes later: the plugin currently resolves `@esphelm/schema` from the workspace.
