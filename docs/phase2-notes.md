# Phase 2 notes: plugin skeleton

Status: **done, pending your review** · 2026-10-24

## What exists now
- `packages/plugin` (`signalk-esphelm`, plugin id `esphelm`, ESM). Signalk-server loads ESM plugins via `importOrRequire` (`dist/modules.js:244-250`).
  - `src/index.ts` (factory), `service.ts` (store + version notifier), `store.ts` (atomic JSON files, validated on load), `etag.ts`, `auth.ts` (device guard), `compat.ts`, `deviceApi.ts`, `editorApi.ts`, `host.ts`.
  - Reference: `docs/plugin-api.md`.
- Tests: `packages/plugin/test/` (store, device API auth matrix, ETag/304, editor CRUD, compatibility, deltas, restart persistence).
- `packages/plugin/scripts/e2e.ts`: a real signalk-server with security on, in a throwaway config dir, with real tokens and a WebSocket subscription.
- Schema change (additive): `LABEL_PATTERN` exported from `@esphelm/schema`, so the plugin and the future editor share the label rule.
- ADR-0003: **Accepted**, with the route spike table.

## Verified
- `npm test`: 8 files, 242 tests pass (schema 200 + plugin 42).
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm run e2e -w signalk-esphelm`: 17/17 checks pass on **signalk-server 2.17.2, 2.19.0 and 2.26.0**. The checks:
  - anonymous and readonly tokens are rejected
  - hello gives pending
  - the editor API is refused to device tokens
  - layout save, plus rejection with error codes
  - adopt and assign
  - 200 + ETag
  - the subscription replays the version
  - 304
  - the edit is pushed as a version delta, and gives 200 with a new ETag
  - the data API still works
- The route spike before implementation confirmed ADR-0003 (see the table there).

## Not verified / known gaps
- No ESP32 client yet (Phase 3); the device side of this API is exercised only by the scripts.
- The plugin isn't packaged for npm/App Store: it resolves `@esphelm/schema` through the workspace. It needs bundling or publishing the schema package (later phase).
- Plugin config schema is empty, so there's nothing to configure yet.
- The editor API trusts signalk-server's admin gate on `/plugins/*`. With security **disabled** on the server, anyone on the LAN can edit layouts (same as every other SignalK plugin).
- Three signalk-server installs exist on this machine: `~/.npm-global` (2.17.2, on your PATH), `/usr/local` (2.19.0), and `~/node_modules` (2.26.0, picked up by `npm run` because npm adds ancestor `node_modules/.bin` to PATH).

## Next (Phase 3)
The firmware vertical slice. Start with the ESPHomeSignalK changes (ADR-0004: listener API, thread safety, `permissions: readwrite`), then `esphelm_runtime`: fetch with ETag, NVS cache, render one page of `value` tiles, and dynamic subscriptions, on SDL first.
