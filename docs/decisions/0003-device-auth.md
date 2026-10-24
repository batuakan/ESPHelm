# ADR-0003: Device auth via SignalK access requests; device routes outside `/plugins`

Status: **Accepted** (Phase 2, 2026-10-24) · Resolves CLAUDE.md open question #5 · CLAUDE.md §3 updated

## Context
- With security enabled, signalk-server protects every `/plugins/*` path with **admin** authentication (`tokensecurity.js:271` in 2.19.0). A dev server returned 401 for `/plugins/...` without a token. Plugin `registerWithRouter` routes are mounted exactly there (`interfaces/plugins.js:526-532`).
- A display holding a read-only token therefore can't reach `GET /plugins/esphelm/api/devices/:id/layout` as CLAUDE.md §3 specifies.
- `/signalk/v1/api/*` accepts any valid token, and anonymous reads when `allow_readonly` is on (`tokensecurity.js:275-278, 820-832`). Plugins can mount routes there with `signalKApiRoutes` (`plugins.js:533-534`).
- ESPHomeSignalK already implements the access-request flow:
  - It sends a MAC-derived `clientId` (`ESPHomeSignalK/.../signalk.cpp:138-218`, `utils.h:368-383`).
  - It stores the token in NVS (`:243-271`).
  - It sends `Authorization: Bearer` (`signalk_esp_idf.cpp:149-155, 248-254`).
  - Verified: the dev server answers `PENDING`.

## Decision
1. **Token provisioning:** the device's existing SignalK access request is its only credential. The device **must** hold an approved token, and that token must have **read/write** permission (decision 2026-10-24), so PUTs for `switch`/autopilot and deltas published by the device always work. The access request asks for `readwrite`, and the user approves it in the SignalK admin UI. No tokens in YAML or the repo.
2. **Device endpoints** (`POST hello`, `GET layout`) are served via `signalKApiRoutes` at `/signalk/v1/api/esphelm/devices/...` (confirmed by the spike below).
3. The plugin **binds device to principal**: it accepts `:id` only if `req.skPrincipal` is a real principal (not the anonymous `AUTO` one, which arrives with `skIsAuthenticated === true`) with `identifier === id`, and the principal has read/write permission. Unauthenticated requests are rejected with 401 **even when `allow_readonly` is on**; anonymous device access is not allowed. Until approved, the device shows a "waiting for approval in SignalK" screen. When SignalK security is disabled entirely, there is no principal to check. The plugin then accepts devices but shows a warning in the editor.
4. **Editor/admin CRUD** stays at `/plugins/esphelm/api/*` (admin), with the editor webapp served at `/signalk-esphelm/`.
5. The `esphelm_runtime` layout fetch reuses the token ESPHomeSignalK holds, through a new getter. It does not run a second auth flow.

## Consequences
- CLAUDE.md §3 route table updated.
- **Spike** (Phase 2): a throwaway plugin on signalk-server 2.17.2 with security on, called with real tokens from the login and access-request flows:

  | Mount | anon | readonly device | readwrite device | admin |
  |---|---|---|---|---|
  | `/plugins/<id>/…` | 401 | 401 | 401 | 200 |
  | `signalKApiRoutes` → `/signalk/v1/api/esphelm/…` | 200, principal `AUTO`/readonly | 200, own clientId | 200, own clientId/readwrite | 200 |
  | root `app.get(…)` | 200, no principal | 200 | 200 | 200 |

  The data API (`/signalk/v1/api/vessels/self/…`) keeps working next to the plugin route. The implemented plugin passes the same matrix end to end (`npm run e2e -w signalk-esphelm`) on signalk-server 2.17.2, 2.19.0 and 2.26.0.
- ESPHomeSignalK's access request currently sends only `clientId` and `description` (`signalk.cpp:150-152`), so SignalK defaults it to read-only and the admin must pick read/write when approving. Add `"permissions": "readwrite"` to the request as part of the ESPHomeSignalK changes (ADR-0004).
- The device id equals the SignalK `clientId`. Replacing the board means a new device (re-adopt in the editor), which is acceptable.
- LAN-only `http://` with bearer tokens is a known limitation (no TLS anywhere in the stack today).
