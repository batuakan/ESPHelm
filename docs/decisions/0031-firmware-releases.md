# ADR-0031: Firmware releases

Status: **Accepted** (2026-11-09)

## Context
- **Building was the only way in:** to put ESPHelm on a display you had to install ESPHome, fetch the P4's Wi-Fi co-processor firmware by hand and compile.
- **Moving parts:**
  - ESPHomeSignalK is fetched from its `main` branch at build time, so two builds of the same ESPHelm commit could differ.
  - The P4 embeds `network_adapter_esp32c6.bin`, which is not in this repository (its sha256 is pinned in `hardware/waveshare-esp32-p4-86.yaml`).
- **The version:** the firmware reports a hard-coded `FIRMWARE_VERSION` (`esphelm_runtime.h`) in `hello` and on the Info tab.

## Decision
**Pushing tag `vX.Y.Z`** runs `.github/workflows/release.yml`, which builds every supported board and creates a **draft** GitHub release. `vX.Y.Z-rc.N` makes a draft prerelease.
- **The tag must match `FIRMWARE_VERSION`:** the version before any `-…` suffix must equal it, or the run fails before building. A display always reports the version it was released as.
- **Boards:**
  - The P4-86, the Guition 4848S040 and the cheap yellow display.
  - Not the C3 compile check, which has placeholder pins.
- **Files:** per board, `esphelm-<board>-<version>.factory.bin` (the whole flash, written at 0x0 with esptool) and `.ota.bin` (the app, for the captive portal's upload). Plus `SHA256SUMS`. No browser flasher for now.
- **Pinned ESPHomeSignalK:**
  - The board files take its git ref from the substitution `signalk_ref`, which defaults to `main`.
  - The release resolves `main` to a commit once and builds every board with `-s signalk_ref <sha>`.
  - The release notes name that commit.
- **The P4's co-processor firmware:** downloaded from esphome/esp-hosted-firmware **v2.9.3** (the release whose file matches the pin) and checked against the sha256 in the hardware file, so the pin stays the single source.
- **Clean builds:** only the toolchains (`~/.cache/esphome`: ESP-IDF and its Python env) are cached, never `firmware/.esphome`.
- **A draft:** a person checks it on hardware and publishes it.

## Consequences
- **Cutting a release:** bump `FIRMWARE_VERSION` in a PR, merge, tag the merge commit, review the draft (`docs/firmware-runtime.md` → *Releases*).
- **Rebuilding exactly:** the tag plus the ESPHomeSignalK commit from the notes, with ESPHome at the version in the workflow.
- **Normal builds unchanged:** `esphome run firmware/<board>.yaml` still builds against ESPHomeSignalK `main`.
- **Not done:**
  - device builds on every PR (P4, Guition, CYD and C3 compiles are still only run on tags or by hand);
  - a web flasher (ESP Web Tools on GitHub Pages);
  - the plugin as an npm package.
