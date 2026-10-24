# ADR-0002: Persist layouts in NVS (current + last-known-good)

Status: **Proposed** (Phase 0)

## Context
The display must render a cached layout at boot with no server (offline first), and must fall back to the last known good layout on any error (golden rule 2). Options:

- **ESPHome `preferences`.** Fixed-size typed slots. Writes are deferred by `flash_write_interval` (5 min on the P4-86, `modules/hardware/waveshare-esp32-p4-86.yaml:72`), so a reboot shortly after a save loses it.
- **LittleFS/SPIFFS partition.** ESPHome excludes these IDF components (`esphome/components/esp32/__init__.py:270,310`). It needs an added dependency and a **partition-table change, which can't be delivered by OTA**.
- **SD card.** Not present on all boards.
- **NVS via the ESP-IDF API directly.** The default NVS partition is 448 KiB (`esp32/__init__.py:3069`). Blobs span pages, and writes are atomic per key with wear levelling.

## Decision
`esphelm_runtime` uses `nvs_open("esphelm")` with keys:
- `cur`: the active layout blob
- `lkg`: the last-known-good blob
- `meta`: a small struct per slot `{magic, schemaMajor, len, crc32, etag[64]}`

Flow:
1. A new layout is validated, built, and only then written to `cur`.
2. After it has rendered for N seconds without a fault, it is copied to `lkg`.
3. At boot, try `cur`, then `lkg`, then the compiled-in default page.

The host/SDL build uses the same interface backed by files in the working directory.

## Consequences
- No partition change, so existing devices upgrade by OTA.
- 2 × 64 KiB max uses about 30 % of NVS. This shares NVS with ESPHome preferences and the SignalK token.
- Write latency and wear for 64 KiB blobs are **not measured yet** (spike R7 in phase0-findings).
- A boot-loop guard (crash counter in RTC memory or NVS) is needed so that a layout that crashes the renderer is skipped. That is designed in Phase 3/6.
