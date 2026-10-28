# CLAUDE.md: ESPHelm

Guidance for Claude Code when working in this repository. Read this fully before making changes. If something here conflicts with what you find in the code, **stop and flag it** rather than silently picking one.

## 1. What this project is

ESPHelm is an open-source ESP32 multifunction display (MFD) for sailing and boating, built on ESPHome with native SignalK support.

**Today:** the display is static. Its screens are defined in ESPHome YAML and compiled into the firmware. It subscribes to SignalK paths and renders them.

**This initiative:** make the display **configurable at runtime** without recompiling firmware. A user designs screens in a web editor hosted by a **SignalK server plugin (TypeScript)**. The ESP32 fetches that layout over the network, caches it, and renders it.

The editor should **look and feel like Tessera** (https://github.com/MaxGramser/homeassistant_espscreen): pick a device, see its pages side by side with live values, drag tiles from a searchable library onto a grid, open a tile drawer for settings, and press *Save & send*. No YAML for the end user.

## 2. Core design decision (do not re-litigate without asking)

ESPHome LVGL YAML is compiled in, so it can't be swapped at runtime. Therefore:

- **Firmware** contains a fixed **catalog of widget renderers** (C++ ESPHome external component, `esphelm_runtime`). At runtime it parses a JSON layout and builds LVGL objects through the LVGL C API.
- **Plugin** stores layouts, serves them to devices, notifies devices of changes, and hosts the editor.
- New *widget types* require a firmware build. New *layouts, pages, tile placement, SignalK paths, units, labels, thresholds, themes* must **not**.

If you believe this design is wrong, say so with evidence and a proposed alternative. Do not quietly build a different one.

## 3. Architecture

```
SignalK server
 └─ signalk-esphelm plugin (TypeScript)
     ├─ Config store      JSON files under app.getDataDirPath()
     ├─ Editor API        /plugins/esphelm/api/...    (admin-only when SignalK security is on)
     │    CRUD /layouts, /devices ; GET /widgets (catalog)
     ├─ Device API        /signalk/v1/api/esphelm/... (approved read/write device token; ADR-0003)
     │    POST /devices/hello          device announces id/board/resolution/orientation/fw/capacity
     │    GET  /devices/:id/layout     ETag / If-None-Match, 304 when unchanged
     ├─ Editor web UI     React + Vite, served as a signalk-webapp
     └─ Change notifier   SignalK delta on plugins.esphelm.<deviceId>.version

ESP32 display (ESPHome)
 ├─ esphelm_runtime (new)   layout client + cache (NVS) + layout engine + widget catalog
 ├─ EspHomeSignalK          existing external component; subscriptions + PUT.
 │                          Needs a runtime listener API + thread-safety fixes (ADR-0004).
 │                          Built from the local checkout ../ESPHomeSignalK (modules/base/signalk.yaml).
 └─ ESPTiles                existing; used by chart/anchor page (local checkout ../ESPTiles)
```

Devices authenticate with the token from ESPHomeSignalK's SignalK access request (approved in the SignalK admin UI with read/write permission). No anonymous device access.

### Delivery flow
1. Boot, then load the cached layout from flash and render it immediately (must work offline).
2. Call `hello` (first contact registers the device as *pending* in the editor; the user adopts it).
3. `GET` layout with `If-None-Match`; on change, validate, persist, rebuild UI.
4. Listen for the `version` delta over the existing SignalK WebSocket to refetch quickly after an editor save.
5. Derive the subscription set **from the layout**. Additions = incremental subscribe; any removal = `{"context":"*","unsubscribe":[{"path":"*"}]}` followed by a full resubscribe. A per-path unsubscribe makes signalk-server close the socket (verified in Phase 0).

### Units
SignalK values are SI (m/s, rad, K, ratio, Pa). Each tile declares a display unit. The firmware applies a small conversion table (e.g. m/s to kn, rad to deg, K to °C). Keep that table identical in `packages/schema` (TS) and in firmware, with shared fixtures proving they agree.

## 4. Target repository layout

```
ESPHelm/
├─ CLAUDE.md
├─ docs/
│   ├─ layout-schema.md
│   ├─ phase0-findings.md
│   └─ decisions/            # short ADRs, one file per decision
├─ packages/
│   ├─ schema/               # TS types + JSON Schema + example fixtures (the contract)
│   ├─ plugin/               # signalk-esphelm
│   └─ editor/               # React + Vite UI
├─ firmware/
│   ├─ components/esphelm_runtime/
│   ├─ components/sdl_screenshot/   # existing
│   └─ esphelm.yaml          # base package using the runtime
└─ legacy/                   # current static YAML apps, kept for reference and porting
```

This is the *target*. Do not move existing files until Phase 0 findings are reviewed and the person approves a migration step.

## 5. The golden rules

1. **The schema is the contract.** Change `packages/schema` and its fixtures *first*; update plugin, editor and firmware in the same change. Never let the three drift.
2. **Layout JSON is untrusted input on the device.** The firmware must validate every field, enforce size and count limits, and fall back to the **last known good** layout (or a built-in default page) on any error. A malformed layout must never boot-loop or crash the display. Safety-relevant displays on a boat must degrade gracefully.
3. **Offline first.** The display must work with no server reachable, using the cached layout and showing stale-data indicators, not blank or frozen screens.
4. **Vertical slices.** Each phase ends in something demonstrable end to end. Do not build the editor before the firmware can render one tile from live data.
5. **No big-bang rewrites.** Existing static apps keep working until their widget equivalents are verified. Keep them under `legacy/` for reference.
6. **Resolution agnostic.** Layouts are grid-based. The firmware measures its own canvas at boot and must work at least on 480x480 and 720x720 (existing design goal). Never hard-code pixel positions in a layout.
7. **Ask before irreversible or wide changes**: deleting/moving files, changing the schema's major version, adding heavyweight dependencies, changing license headers.

## 6. Conventions

### General
- Small, reviewable commits. Conventional-commit style messages (`feat(plugin): ...`, `fix(firmware): ...`, `docs: ...`).
- Every non-trivial decision gets a short ADR in `docs/decisions/` (context, decision, consequences).
- Update `docs/layout-schema.md` whenever the schema changes.

### TypeScript (plugin, schema, editor)
- `strict` mode on. No `any` without a comment explaining why.
- Schema defined once (zod or TypeBox, whichever Phase 0 recommends), exporting both TS types and JSON Schema.
- Plugin follows the SignalK plugin API (`plugin.id`, `plugin.schema`, `plugin.start/stop`, `registerWithRouter`). Persist data under `app.getDataDirPath()`. Do not write elsewhere.
- Plugin REST must respect SignalK security. Device endpoints need a documented auth story (read token for devices).
- Editor: React + Vite, mobile-friendly (people will edit from a phone on the boat), light and dark/night themes from day one.

### Firmware (C++ / ESPHome)
- Implement as a proper ESPHome external component (`__init__.py` config schema + C++ class), not as giant lambdas in YAML.
- Be conscious of heap and PSRAM. Avoid per-update allocations in hot paths. Document memory cost of each widget.
- Parse JSON with a bounded, streaming-friendly approach where possible. The schema defines **no fixed size/count limits in v1**; instead the device enforces capacity guards derived from its own memory (max body it can buffer, free-heap watermark while building, nesting depth, fixed string buffers), falls back to the last-known-good layout on any refusal, and reports its capacity in `hello`.
- Targets: ESP32-P4 and ESP32-S3 with PSRAM, **and ESP32-C3/C6 without PSRAM** (design floor: internal RAM only, partial LVGL buffer, build only the visible page and its neighbours).
- Runtime text is limited to **ASCII + `°`** (the compiled font glyph set). The schema enforces this charset for labels.
- The runtime owns a YAML-declared host container; it never adds/removes ESPHome LVGL pages. All `lv_*` calls on the ESPHome main loop only; network I/O in a worker task.
- ESPHome generates `lv_conf.h` from YAML usage: the runtime must enable the LVGL features its catalog needs (`-DLV_USE_LABEL=1`, `-DLV_USE_GRID=1`, …).
- Widgets must be pure functions of (config, current value, theme). No widget may depend on another widget.
- Throttle redraws. Value updates from SignalK can be frequent; do not re-layout on value change.
- Keep log output useful but not spammy at default level.

## 7. Widget catalog

Rendered by the firmware: tiles `value` (optionally coloured: a named colour or zones by value, ADR-0016; text sized to the tile from a ladder of compiled fonts, ADR-0017; a tap opens a graph of its recent values, recorded on the display, ADR-0018), `gauge`, `bar`, `switch`, `position` (GPS position as text in four formats, defined once in `packages/schema/src/position.ts` and mirrored in `esphelm_position.h`), `wind_rose` (a tile since 5b, ADR-0010; sized by the device in pixel tiers) and `autopilot` (5c; safety rules in ADR-0011: confirm to engage, one-tap standby, course changes only while engaged, status only when small or offline). Starter layouts porting the legacy apps, plus denser `-720` layouts for large displays, are in `packages/schema/templates/`.
Every display also shows SignalK alarms (`notifications.*`) in a banner above the page (ADR-0014).
Page kinds: `grid` and `chart` (5d, ADR-0012: SignalK chart tiles converted to RGB565 by the plugin, vessel and anchor watch, north up, PSRAM displays only).
Later: maybe `compass` and `graph`; possibly a plugin bridge to SignalK's v2 Autopilot API; chart tiles cached on flash.
Weather/clock currently come from HomeAssistant; their future source is an open question (see section 11).

## 8. Verification (you must be able to check your own work)

Toolchain (verified in Phase 0): ESPHome 2026.9.1, LVGL 9.5.0, ESP-IDF 5.5.5, Node 22. The ESPHome CLI is `~/venv/bin/esphome` (not on PATH).

- Validate the static apps: `~/venv/bin/esphome config legacy/{SDL_720,SDL_480,MFD}.yaml` (secrets in `legacy/secrets.yaml`)
- Build: `~/venv/bin/esphome compile legacy/<file>.yaml` (both SDL configs share `legacy/.esphome/build/sdl2/`)
- Run the host build: `.esphome/build/<name>/.pioenvs/<name>/program` (F11 saves `screenshot_YYYYMMDD_HHMMSS.bmp` in the CWD; needs an X display)
- Dev SignalK: `PORT=3999 signalk-server -c <scratch-dir> --sample-nmea0183-data [--securityenabled]`. **Never run it without `-c`**: that uses the real `~/.signalk`.
- TS packages (npm workspaces, from the repo root): `npm ci`, `npm run generate` (units TS/C++ + JSON Schemas; output is committed), `npm test` (includes a g++-built C++ units test), `npm run typecheck`, `npm run lint`, `npm run build`.
- Runtime firmware: `~/venv/bin/esphome compile firmware/esphelm_sdl.yaml` (desktop), `firmware/esphelm_p4.yaml` (P4-86), `firmware/esphelm_c3_compile_check.yaml` (compile-only). P4/C3 need `firmware/secrets.yaml` (symlink to `../legacy/secrets.yaml`). Reference: `docs/firmware-runtime.md`.
- Firmware end to end: `npm run build && npm run e2e:sdl` (SDL build against a real signalk-server on port 3993, 43 golden screenshots in `firmware/test/golden/`, including the autopilot flow and a chart page against stand-in plugins, alarms, display settings, the boot guard and offline 720×720 renders via `firmware/esphelm_sdl_720.yaml`; `UPDATE_GOLDEN=1` re-records, review them by eye). Needs an X display.
- ESPHomeSignalK unit tests: `../ESPHomeSignalK/tools/test_cpp.sh`.
- Editor: `npm run dev -w @esphelm/editor` (Vite, proxies to `ESPHELM_SIGNALK`, default http://localhost:3000); served by SignalK at `/signalk-esphelm/` after `npm run build`. Browser e2e: `npm run build && npm run e2e:editor` (installed Google Chrome via playwright-core; `CHROME=` to override). Reference: `docs/editor.md`.
- Plugin end to end: `npm run build && npm run e2e -w signalk-esphelm` (real signalk-server with security on, throwaway config dir, real tokens). `SIGNALK_SERVER=/path/to/bin/signalk-server` selects an install; three exist on this machine (2.17.2 on PATH, 2.19.0 in /usr/local, 2.26.0 in ~/node_modules).

- **Schema/plugin/editor:** unit tests (vitest or jest), type-check, lint, plus contract tests that load every fixture in `packages/schema/fixtures`.
- **Plugin:** run against a local dev SignalK server with a sample-data/demo source so paths have live values. Test the REST endpoints with real HTTP calls (ETag/304 behavior included).
- **Firmware:** `esphome config` for validation; `esphome compile` for build; **SDL host build** (`legacy/SDL_480.yaml`, `legacy/SDL_720.yaml`, `firmware/components/sdl_screenshot`) to render layouts on the desktop and capture screenshots. Use screenshots to verify visual output and for golden-image regression tests.
- **Hardware:** the person will flash and test on the real display. When a change needs a hardware check, say exactly what to look for.

Never claim something works unless you ran it. If you could not run a check (no toolchain, no network, no hardware), say so explicitly.

### Definition of done for any task
- Builds and type-checks cleanly.
- Tests added or updated and passing.
- Fixtures and `docs/layout-schema.md` updated if the schema changed.
- Failure modes considered (bad JSON, server down, path missing, value stale).
- Short summary: what changed, how it was verified, what is *not* verified.

## 9. Hard "don'ts"

- Don't copy code, assets or text from Tessera (AGPL-3.0). Take **UX inspiration only**. Don't copy anything from other projects without checking license compatibility and asking first.
- Don't introduce a cloud dependency. Everything runs on the boat's LAN.
- Don't add telemetry or phone-home behavior.
- Don't commit secrets, tokens, Wi-Fi credentials, or personal SignalK URLs. Use `secrets.yaml` (gitignored) and example files.
- Don't remove the existing static YAML apps or the SDL tooling.
- Don't weaken validation on the device to "make it work".

## 10. Working style

- Start each task by restating the goal and listing the files you expect to touch. For non-trivial work, propose a plan and wait for approval (use plan mode).
- Prefer the smallest change that proves the point. Explain trade-offs when there are real alternatives.
- When you discover that an assumption in this file is wrong, **propose an edit to this file** instead of working around it.
- Keep a running `docs/phase0-findings.md` (and later phase notes) so context survives between sessions.

## 11. Open questions (update as resolved)

| # | Question | Status |
|---|----------|--------|
| 1 | Which boards must the runtime support? (ESP32-P4 with PSRAM is comfortable; C3/C6 may limit dynamism) | **Resolved:** P4, S3+PSRAM and C3/C6 (no PSRAM) all in scope. Reference C3/C6 board still to pick |
| 2 | Is HomeAssistant remaining a data source (weather/forecast), or does the plugin become the only backend? | open |
| 3 | Should the plugin proxy/aggregate non-SignalK data (e.g. weather) so the display only talks to one server? | open |
| 4 | zod vs TypeBox for the schema source of truth | **Resolved:** TypeBox (ADR-0001) |
| 5 | Device auth model (SignalK read token on device, how provisioned) | **Resolved:** SignalK access request, read/write token required, device routes outside `/plugins` (ADR-0003) |
| 6 | Does `EspHomeSignalK` support runtime (un)subscription, or does it need changes? | **Resolved:** no; needs a listener API + unsubscribe-all/resubscribe (ADR-0004) |
| 7 | Editor previews: HTML approximation vs SDL-rendered screenshots | start HTML, verify with SDL |
| 8 | License of ESPHelm and its compatibility with plugin/firmware/editor dependencies | **Resolved:** MIT, no conflicts; firmware binaries are GPLv3 via ESPHome C++. ESPTiles lacks a LICENSE file |

## 12. Phases (status tracker)

- [x] **Phase 0:** Recon and decisions (no feature code), see `docs/phase0-findings.md`
- [x] **Phase 1:** Contract: schema v1, fixtures, contract tests (`value`, `gauge`, `bar`, `switch`), see `docs/phase1-notes.md`
- [x] **Phase 2:** Plugin skeleton: layout CRUD, device registry, hello/layout endpoints with ETag, version delta, see `docs/phase2-notes.md`
- [ ] **Phase 3:** Firmware vertical slice: fetch, cache, render one page of `value` tiles, dynamic subscriptions. Done on SDL, pending the P4 hardware check (`docs/phase3-notes.md`)
- [ ] **Phase 4:** Editor MVP: device list, one page, drag tiles, path picker, Save & send. Done, pending your review (`docs/phase4-notes.md`)
- [ ] **Phase 5a:** gauge/bar/switch tiles, wind-rose page, multi-page with a footer (no swipe, ADR-0009), editor support, starter layouts (wind, speeds, energy, engine, switchboard). Done on SDL, pending your review and the P4 hardware check (`docs/phase5a-notes.md`)
- [ ] **Phase 5b:** wind rose becomes a tile (page kind removed, pixel size tiers, 720 templates and SDL 720 check). Done on SDL, pending your review and the P4 hardware check (`docs/phase5b-notes.md`)
- [ ] **Phase 5c:** autopilot tile (confirm to engage, ADR-0011). Done on SDL against a stand-in, pending your review and the hardware check (`docs/phase5c-notes.md`)
- [ ] **Phase 5d:** chart page with anchor watch (ADR-0012). Done on SDL against a charts stand-in, pending your review and the P4 hardware check (`docs/phase5d-notes.md`)
- [ ] **Phase 6:** Hardening. This round: boot guard (ADR-0013), alarm banner with acknowledge through the plugin (ADR-0014), display settings in the layout (brightness, start page, auto day/night, screen timeout; ADR-0015). Done on SDL, pending your review and the P4 hardware check (`docs/phase6-notes.md`). Still open: orientation/resolution scaling, auth/recovery tooling
