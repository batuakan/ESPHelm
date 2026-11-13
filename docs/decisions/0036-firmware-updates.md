# ADR-0036: Firmware updates from the editor

Status: **Accepted** (2026-11-13)

## Context
- **No way in after the first install:** the firmware had no OTA. A display flashed over USB could only be updated over USB again, or through the captive portal's upload while its setup network was open.
- **The first install** is over USB in any case (esptool, later ESP Web Tools). This ADR covers every update after it.
- **ESPHome's HTTP OTA doesn't fit as it is** (checked first, ESPHome first):
  - `ota: platform: http_request` and its `flash` action only do basic auth in the URL. The device routes take a SignalK bearer token (ADR-0003); a route without one would sit outside SignalK's security.
  - Its `flash()` runs on the main loop, so LVGL would freeze for the whole download.
  - `update: platform: http_request` has its manifest URL fixed at compile time. The server is found at runtime with mDNS (ADR-0026), and it fetches without a token.
- **ESPHome's OTA core does fit:** an `OTAComponent` platform, the backends (`ota::make_ota_backend()`: `begin`, `set_update_md5`, `write`, `end` checks the MD5, `abort`), `notify_state_deferred_()` for OTA in its own task, `safe_mode` and ESP-IDF's rollback, and a host backend that replaces the running program and starts it again.

## Decision
**The runtime adds an OTA platform**, `ota: - platform: esphelm_runtime` (`firmware/ota.yaml`, with `safe_mode:`). Only the transport is ours: the display downloads with its device token on a worker task and writes through ESPHome's backend.

**An image's identity:**
- **The marker:** every image carries `ESPHELM-IMAGE/1 fw=<ESPHELM_FIRMWARE_VERSION> board=<esphelm_runtime board> kind=<color|mono>`. The plugin reads version, board and tile set from it; an image without exactly one marker is refused.
- **The build id:** for an ESP32 app image, `app_elf_sha256` from the app descriptor (offset 0x20 + 0x90; esptool shows it as *ELF file SHA256*). For a host program, the sha256 of the file. The display reports its own in `hello.fw.build` (on the host, the sha256 of `/proc/self/exe`).
- **A factory image is refused** with a hint to upload `firmware.ota.bin`.

**The protocol:**
1. An admin uploads an image in the editor (*Firmware* → *Upload .bin*), or presses *Check GitHub for updates*.
   - *Check GitHub* reads `manifest.json` of the latest release (written by `release.yml`) and fetches the images for the boards of the displays here, checking size, sha256 and marker. Only ever when pressed: nothing checks by itself.
   - The plugin keeps the newest two images per board and tile set, never the target of an update in progress.
2. The admin presses *Update* on a display (adopted, `capabilities.ota`, same board and tile set, not running that build). The editor asks once: the display restarts. The display asks nothing.
3. The plugin publishes `plugins.esphelm.<id>.firmware = {request, version, size, md5}` (`null` when there is nothing to do), as it does the layout version. The value is replayed when the plugin starts.
4. The display checks the offer (every field, a size up to 64 MB), closes its panel and shows a full-screen *Updating firmware* with progress. It downloads `GET /signalk/v1/api/esphelm/devices/:id/firmware?request=<request>`:
   - `Content-Length` must equal the offered size; the backend's `end()` checks the MD5.
   - **Served once per request:** a second GET gets 409. A display that keeps restarting can never loop on one update. The offer is withdrawn when the download starts.
   - Sent with `Cache-Control: no-store, no-transform`, so signalk-server's compression leaves `Content-Length` alone.
5. **Success:** the display restarts (`App.safe_reboot()`, a clean exit for the boot guard, ADR-0013); its next `hello` carries the target build, and the plugin marks the update done.
6. **Failure on the display** (download broke off, wrong size, MD5, flash): it aborts, shows *Update failed* and the reason for 10 s, posts `POST …/devices/:id/firmware/result {request, error}`, and carries on with its firmware.
7. **Rollback:** `safe_mode` confirms a new image after a minute running. One that crashes before that gives way to the old image; the next `hello` carries the old build after the download, and the plugin marks the update failed (*came back on its old firmware*).

**States in the device record:** `requested` → `downloading` → `installing` → `done` or `failed`. A request not downloaded yet can be cancelled.

## Consequences
- **Cost:** about 6 to 7 KB of flash per board. The CYD is at 1,526,171 of 1,835,008 bytes (83%), the C3 check at 90%.
- **The P4 runs its code from PSRAM** (`CONFIG_SPIRAM_XIP_FROM_PSRAM`, in its hardware file): otherwise every flash erase turns the cache off, and the screen flickered for the whole update. Checked on the P4: no flicker, boots as before; about 10 KB more internal RAM.
- **Every board has two app slots** already, so nothing changes in the partitions.
- **`safe_mode` is off on the host build** (`esphelm_sdl.yaml`): ESPHome's `ota` loads it everywhere, there is nothing to roll back to on a desktop, and the e2e restarts the program more often than its boot-loop counter (10 boots within a minute each) allows; it then started in safe mode with nothing but the essentials running.
- **The host build updates itself** in the SDL e2e: the program with bytes appended is a valid image with another build id; a damaged copy shows the failure screen (golden `87-update-failed`).
- **Firmware before 0.4.0** has no updates over the network: write the factory image over USB once.
- **Trust:** an image is as trusted as the admin who uploads it. The plugin only checks it is ESPHelm firmware for that board; ESP-IDF rejects an image for another chip. Signed images (ESPHome's `signature`) are not used.
- **Not done:** ESP Web Tools for the first install; an update of several displays in one press.
