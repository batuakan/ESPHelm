# Phase 3 notes: firmware vertical slice

Status: **done, pending your review and a hardware check** · 2026-10-25

## What exists now
- **`legacy/`:** the static MFD configs, `modules/`, `server.py` (commit `7e4ffda`). `sdl_screenshot` moved to `firmware/components/`. The P4 hardware file takes `esp32_hosted_firmware` as a substitution, so configs outside `legacy/` can point at the coprocessor image.
- **ESPHomeSignalK** (local commits `62be31f`, `cb76fc3`):
  - main-loop processing behind a bounded inbox, and message reassembly on ESP-IDF
  - all `updates[]` processed
  - runtime listeners with unsubscribe-all + resubscribe
  - accessors for other components
  - read/write access requests
  - no secrets in logs
  - a polling-interval fix (see below)
- **`firmware/components/esphelm_runtime`:**
  - parser/validator for the full v1 contract
  - NVS / file store with `cur` + `lkg`
  - HTTP worker
  - renderer (first grid page, `value` tiles)
  - the state machine and status pages
- **Configs:** `firmware/esphelm_sdl.yaml`, `esphelm_p4.yaml`, `esphelm_c3_compile_check.yaml`, `fonts.yaml`.
- **Tests:** `firmware/test/parser.cpp.test.ts` (in `npm test`); `firmware/test/e2e_sdl.ts` (`npm run e2e:sdl`) with six golden screenshots.
- **Shared e2e harness:** `packages/plugin/scripts/sk-harness.ts`, used by the plugin e2e and the firmware e2e.
- **Docs:** `docs/firmware-runtime.md`, ADR-0007, and `docs/layout-schema.md` updated (device-only codes, unknown fields).

## Found on the way
- **The legacy SignalK displays couldn't connect on ESPHome 2026.x.** With no `update_interval`, `PollingComponent` defaults to "never", so ESPHomeSignalK's state machine (login, access request, connect) never ran. It's fixed in ESPHomeSignalK `cb76fc3` with a 1 s default. Legacy configs pick this up too. This was found only by the SDL e2e run.
- The firmware/TS comparison test caught one parser difference: a non-string `unit` gives both `INVALID_TYPE` and `UNKNOWN_UNIT` in Ajv. The parser now matches.

## Verified
- `npm test`: 9 files, 302 tests. `npm run typecheck` and `npm run lint` are clean.
- `npm run e2e:sdl` (signalk-server 2.17.2): all checks pass on three consecutive runs (one recording the goldens, two comparing against them). The six screenshots were reviewed by eye.
- `npm run e2e -w signalk-esphelm` still passes on the shared harness.
- Compiles:
  - `firmware/esphelm_sdl.yaml`, `firmware/esphelm_p4.yaml` (ESP32-P4, IDF 5.5.5), `firmware/esphelm_c3_compile_check.yaml` (ESP32-C3)
  - `legacy/SDL_720.yaml`, `legacy/MFD.yaml`, both before and after the ESPHomeSignalK changes
- `tools/test_cpp.sh` in ESPHomeSignalK (SubscriptionSet).
- A cached layout record written by an independent Python encoder is accepted, so the store format is pinned from both sides.

## Not verified
- **No hardware run** (P4, S3, C3). NVS writes, Wi-Fi reconnects and the ESP-IDF chunked-frame reassembly have only been compiled, never executed. The checklist is in `docs/firmware-runtime.md`.
- The Arduino transport of ESPHomeSignalK was edited but not compiled (no Arduino config here).
- ESPHomeSignalK's own `tools/lint.sh` wasn't run (it installs a venv with pip).
- C3 runtime heap is unmeasured; only static RAM is known.
- The legacy apps with live SignalK data after the polling fix: compiled, not run against a server.

## Deviations from the Phase 3 plan
- The screenshot overload writes BMP (`SDL_SaveBMP`), and the test converts to PNG with Pillow. No stb implementation unit was added.
- The day theme is a dark slate palette (night is red on black). A light day palette was out of scope.
- The ESPHomeSignalK unit tests run from that repo (`tools/test_cpp.sh`), not from ESPHelm's `npm test`.

## Next (Phase 4)
The editor MVP against the plugin's editor API: device list, one grid page, drag tiles, path picker, Save & send.
