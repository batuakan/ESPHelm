<p align="center"><img width="96px" src="packages/editor/public/icon.svg" alt="ESPHelm"></p>

# ESPHelm

**ESPHelm — Open-source ESP32 multifunction marine displays with native SignalK support.**

ESPHelm is a lightweight, open-source marine display platform built on ESP32.
It connects directly to SignalK (and HomeAssistant) to show real-time vessel data on affordable, customizable hardware, and you design its screens in a web editor that runs inside your SignalK server. No YAML, no recompiling.

---

<p align="center">
 <img width="200px" src="/docs/images/display-wind-day.png">
 <img width="200px" src="/docs/images/display-wind-night.png">
 <img width="200px" src="/docs/images/display-wind-laylines.png">
 <img width="200px" src="/docs/images/display-wind-dark.png">
 <img width="200px" src="/docs/images/display-chart-tiles.png">
 <img width="200px" src="/docs/images/display-engine-day.png">
 <img width="200px" src="/docs/images/display-engine-dark.png">
 <img width="200px" src="/docs/images/display-energy-night.png">
 <img width="200px" src="/docs/images/display-switchboard-day.png">
 <img width="200px" src="/docs/images/display-autopilot-night.png">
 <img width="200px" src="/docs/images/display-grid-day.png">
 <img width="200px" src="/docs/images/display-alarm-night.png">
 <img width="200px" src="/docs/images/display-graph-day.png">
 <img width="200px" src="/docs/images/display-heading-tape-night.png">
 <img width="200px" src="/docs/images/display-center-zero-day.png">
 <img width="200px" src="/docs/images/display-clock-day.png">
 <img width="200px" src="/docs/images/display-clock-saver.png">
 <img width="200px" src="/docs/images/display-settings-day.png">
 <img width="200px" src="/docs/images/display-settings-info.png">
 <img width="200px" src="/docs/images/display-settings-network.png">
 <img width="200px" src="/docs/images/display-setup-wifi.png">
 <img width="200px" src="/docs/images/display-mono-zones.png">
 <img width="200px" src="/docs/images/display-mono-inverted.png">
</p>

<p align="center"><em>Screens rendered by the ESPHelm firmware (desktop build at 480×480) with live SignalK data, in the day, dark and night themes.</em></p>

---

I have always wanted to have a multi function display (MFD) on the electric panel of my sailboat, only to have my jaw drop at the very high prices.

This project started as a collection of ESPHome recipes that together function as an MFD (they live on in the [`ESPHelmv1` tag](https://github.com/batuakan/ESPHelm/tree/ESPHelmv1/legacy), see [the original apps](#the-original-static-apps) below). It has since grown into a display whose screens you can change at any time from a browser, on the boat, from your phone.

For this project I have chosen the [ESP32-P4 Smart 86 display from Waveshare](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-4b.htm) for its "classic" square look and its high resolution, high-performance, dual-core RISC-V architecture. ESP32-S3 boards with PSRAM and the smaller ESP32-C3 and C6 boards are targets too (the C3 build compiles; chart pages need PSRAM). Ready-made configs also exist for two cheap boards: the [Guition ESP32-S3-4848S040](https://community.home-assistant.io/t/guition-4-480x480-esp32-s3-4848s040-smart-display-with-lvgl/729271) (4", 480×480) and the ESP32-2432S028R "cheap yellow display" (2.8", 320×240). For a screen that reads in full sunlight without a backlight there is the [Waveshare ESP32-S3-RLCD-4.2](https://docs.waveshare.com/ESP32-S3-RLCD-4.2) (4.2" 400×300 reflective LCD, black and white, two buttons instead of touch).

## 🧭 How it works

```
SignalK server
 └─ signalk-esphelm plugin ── stores your layouts, serves them to displays, hosts the editor
        ▲  layout (JSON), chart tiles, alarm acknowledge
        │
ESP32 display (ESPHome + esphelm_runtime) ── renders the layout with LVGL, live values over the SignalK WebSocket
```

1. Flash the ESPHelm firmware once. On first boot the display asks SignalK for access; approve it under *Security → Access Requests*.
2. Open the **ESPHelm editor** in the SignalK web apps, adopt the display, and build its pages: drag tiles from the library onto a grid, pick SignalK paths, units and labels, or start from a template.
3. Press **Save & send**. The display picks the new layout up within seconds, caches it and keeps showing it even when the server is down.

### The editor

<p align="center">
 <img width="800px" src="/docs/images/editor-desktop.png">
</p>

Pages side by side, live values in the preview, and a drawer with the settings of whatever you tap: here a wind rose's centre values.

<p align="center">
 <img width="800px" src="/docs/images/editor-wind-rose-drawer.png">
</p>

Layouts can be shared: export one as a file and import it on another display, or on another boat. Paths that boat's server doesn't have are listed with a picker, so nothing has to be edited by hand. On the same boat, a display can copy another display's layout or link to it, so both show one layout.

<p align="center">
 <img width="800px" src="/docs/images/editor-share.png">
</p>

A display mounted sideways or upside down is set up in the editor (*Display settings → Mounted*): the display turns its picture and touch, and you design the pages for the turned screen. A portrait display gets a tall canvas, a landscape one a wide canvas.

<p align="center">
 <img width="800px" src="/docs/images/editor-portrait.png">
</p>

New firmware installs from the editor too: upload an update image or fetch the latest release, and the display list offers *Update* on each display that can take it.

<p align="center">
 <img width="800px" src="/docs/images/editor-firmware.png">
</p>

It works on a phone too, and has day, dark and night (red) themes of its own, separate from the display's theme.

<p align="center">
 <img width="260px" src="/docs/images/editor-phone.png">
 <img width="520px" src="/docs/images/editor-night-settings.png">
</p>

## 🌊 Features

- **Tiles:** value (coloured by a fixed colour or by thresholds; the text grows and shrinks with the tile), gauge (with coloured zones), bar (gauges and bars can be centre zero, for a rudder, heel, rate of turn or battery current: filled from zero, red to port and green to starboard, or plus and minus), switch (sends a SignalK PUT), position (GPS in four formats), wind rose with up to seven values of your choice (and its angles), laylines for both tacks upwind and downwind (from a polar plugin's beat and gybe angles, or angles you set), the bearing to the next waypoint and the polar's target angle, an autopilot with safe controls (tap to arm, confirm to engage, one-tap STANDBY), a graph of a value's last 10 min, 1 h or 6 h (with an optional fixed range and zone bands), and a heading tape: a compass strip that scrolls with the heading, with markers for COG, the bearing to the next waypoint and the autopilot target, a clock: the time and/or date in your time zone (summer time included) or UTC, set from GPS time through SignalK or from NTP, and kept running offline, and an engine tile like a classic tachometer: a large RPM arc with three small gauges of your choice inside it (oil pressure, fuel and coolant to start), each with its own range, zones and an icon, and up to four values of your choice in its corners (engine hours, alternator voltage, ...).
- **Zones from SignalK:** zones in a path's SignalK metadata replace a value, gauge, bar or graph tile's own zones (and an engine tile's RPM zones), and the display follows them when they change on the server.
- **History graphs:** tap a value that records to see its last 10 min, 1 h or 6 h. You choose which values record, per value, in the editor, so values nobody looks at take no memory: nothing records unless you switch it on. A wind rose can record any of its values, with buttons in the graph to switch between them, and angles such as the heading are averaged on the circle, so a graph across north has no jump. The editor counts what a layout records against the board's limit (48 values with PSRAM, 6 without). The display records from when it starts, and keeps the 6 h graph only with PSRAM.
- **Pages:** as many as you like, with page buttons in the footer.
- **Charts:** a chart tile with anchor watch (SignalK charts, PSRAM boards), beside a wind rose or depth, or filling its page. Several charts share their map tiles, so a second chart of the same chart and zoom costs no extra memory.
- **Templates** porting the original apps (wind, speeds, energy, engine, switchboard, autopilot, chart) and denser layouts for 720×720 displays.
- **Sharing layouts:** export a layout as a file and import it on any display, here or on another boat, with a list to replace the SignalK paths and charts that server doesn't have. Displays on one boat can copy another display's layout, or link to it so both show one layout.
- **Alarms:** every SignalK notification shows in a banner at the top of the display, worst first. **ACK** silences it through the plugin; an escalation sounds again. On a display with a speaker (the P4-86), alarms that ask for sound play a tone until acknowledged: once for an alert or a warning, every 5 s for an alarm, without a pause for an emergency.
- **Touch sounds:** a short click when you press a button or tile, with the volume and an on/off switch in the editor's display settings and on the display.
- **Three display themes:** *Day* (light, for sunlight), *Dark* (a dark page with full colours, like the editor's dark theme) and *Night* (red on black, for night vision). Automatic day/night switches between Night and your Day or Dark.
- **Black-and-white displays:** reflective LCDs, readable in full sun without a backlight, get tiles of their own: value, bar, position and clock as outlined frames, a heavy frame for a warning and an inverted tile for an alarm, every pixel pure black or white. The editor previews such a display in black and white, with *Plain* and *Inverted* themes. Its firmware carries only these tiles, and colour firmware only the colour ones. A display without touch uses its buttons: the next page, Plain or Inverted, and acknowledge an alarm.
- **Display settings** in the editor: day and night brightness, start page, automatic day/night from the sun, and a screen timeout whose waking touch never presses a button. Instead of going dark, the screen can show a faint clock.
- **Settings on the display itself:** the menu button in the footer opens a panel with three tabs. *Settings* has a brightness slider, Day / Dark / Night / Auto, the volume and touch sounds (on a display with a speaker) and *Screen off*, saved on the display. *Network* shows the Wi-Fi network and the SignalK server, and can forget either or pick another server. *Info* shows what the display knows: the SignalK server, how many deltas it has received, its layout and its clock (see [On the display](#-on-the-display)).
- **No configuration in the firmware:** nothing about your boat is compiled in. A new display opens its own setup network, with a QR code on its screen; join it from your phone and pick the boat's Wi-Fi. It then finds the SignalK server by itself (mDNS) and stays with that server (see [Setting up a display](#-setting-up-a-display)).
- **Offline first:** the last layout is cached on the display and shown at boot without a network; stale values are marked instead of frozen.
- **Firmware updates from the editor:** upload an update image, or fetch the latest release from GitHub with one button, and press *Update* on a display. It downloads the image from your SignalK server over the LAN, shows its progress, and restarts; a firmware that doesn't start gives way to the old one. Only the first install is over USB.
- **Safe with bad layouts:** every layout is validated on the device, and one that crashes the display is skipped at the next boot in favour of the last one that worked.
- **Resolution agnostic:** layouts are grids, so the same layout works on 480×480 and 720×720.
- Everything stays on the boat's LAN: no cloud, no telemetry.

<p align="center">
 <img width="360px" src="/docs/images/display-sailing-720-night.png">
</p>
<p align="center"><em>The "Sailing" template on a 720×720 display, night theme.</em></p>

## 👆 On the display

- **Change page:** the **<** and **>** buttons in the footer.
- **Settings:** the button with three bars in the footer (every layout has one) opens the settings panel, on its *Settings* tab.
  - **Brightness:** a slider for the theme shown (night is kept separately; Day and Dark share one).
  - **Theme:** *Day*, *Dark*, *Night*, or *Auto* (the layout's theme, or the sun's with automatic day/night). With automatic day/night on, Day or Dark is what comes back at sunrise; a choice of Night holds until the next sunrise or sunset.
  - **Screen off,** when the layout has a screen timeout.
  - **Saved on the display:** what you choose survives a restart. When you change the same setting in the editor and send the layout, the editor's value wins.
  - **Network tab:** the Wi-Fi network, signal and IP, and the SignalK server. *Change server* lists the servers on the network; *Forget server* drops the server and its approval. At the bottom, *Factory reset* is ESPHome's factory reset: the display forgets Wi-Fi, its server and approval, its cached layout and its settings, and restarts into its setup network. *Forget server* and *Factory reset* ask *Yes* first.
  - **Info tab:** the display (id, firmware, uptime, free memory), SignalK (server, connection, deltas received and dropped, the last delta's age), the layout and the clock.
  - **Closing:** only the **X** closes it.
- **Alarms:** tap the banner to see the next alarm, **ACK** to acknowledge it.
- **Screen off** (screen timeout): the first touch only wakes the display, it never presses a button.

## 🚀 Getting started

> **Status:** the runtime-configurable ESPHelm is tested end to end on the desktop build and against real signalk-server versions, and runs on the Waveshare ESP32-P4-86. The S3 and C3/C6 boards, the Guition 4848S040, the cheap yellow display and the RLCD-4.2 aren't tested on hardware yet (their builds compile). Expect rough edges, and please report them.

You need a SignalK server, Node 22, and [ESPHome](https://esphome.io/) for the firmware.

```bash
git clone https://github.com/batuakan/ESPHelm.git
cd ESPHelm
npm ci
npm run build
```

**Plugin and editor:** install *ESPHelm* from your SignalK server's *Appstore* (the npm package [`signalk-esphelm`](https://www.npmjs.com/package/signalk-esphelm)), restart SignalK and enable *ESPHelm* under *Server → Plugin Config*. The editor is then at `/signalk-esphelm/` on your server. To run this checkout instead, symlink `packages/plugin` into your SignalK config dir as `node_modules/signalk-esphelm` and add `"signalk-esphelm": "*"` to that dir's `package.json` dependencies.

**Firmware:** nothing to configure. Download your board's `esphelm-<board>-<version>.factory.bin` from [Releases](https://github.com/batuakan/ESPHelm/releases) (P4-86, Guition 4848S040, the cheap yellow display or the RLCD-4.2) and write it over USB with `esptool.py write_flash 0x0 <file>`. That's the only time: later versions install from the editor (*Firmware* above the display list), from an uploaded `.ota.bin` or with *Check GitHub for updates*.

Or build it yourself: the [EspHomeSignalK](https://github.com/batuakan/ESPHomeSignalK) component is fetched from GitHub when you build. The P4 board also needs its Wi-Fi co-processor firmware, `firmware/network_adapter_esp32c6.bin`, from [esphome/esp-hosted-firmware v2.9.3](https://github.com/esphome/esp-hosted-firmware/releases/tag/v2.9.3) (the release matching its pinned checksum; it is not in this repository). Then:

```bash
esphome run firmware/esphelm_p4.yaml                # Waveshare ESP32-P4-86
esphome run firmware/esphelm_guition_4848s040.yaml  # Guition ESP32-S3-4848S040
esphome run firmware/esphelm_cyd.yaml               # ESP32-2432S028R (cheap yellow display)
esphome run firmware/esphelm_rlcd.yaml              # Waveshare ESP32-S3-RLCD-4.2 (black and white)
```

### 📶 Setting up a display

1. **Join its setup network.** A display without a saved network shows *Set up Wi-Fi* with a QR code, its network's name (`esphelm-p4-`, `esphelm-guition-` or `esphelm-cyd-` and six characters) and a password made for that display. Scan the QR code with your phone's camera, or type the password.
2. **Pick the boat's Wi-Fi** on the page that opens (or at http://192.168.4.1). The display joins it and closes its setup network.
3. **Approve it in SignalK.** The display finds the server with mDNS and asks for access: grant read/write under *Security → Access Requests*. It stays with that server from then on, also after a restart.
4. **Adopt it in the editor** and assign a layout.

Mistyped the password? Power-cycle the display: when it finds no Wi-Fi for 2 minutes after a power-up, it opens its setup network again (for the first 10 minutes after power-up). Once connected, losing the network never opens it, so switching the router off doesn't expose the display. To move to another network, use *Factory reset* at the bottom of the *Network* tab, then approve the display again in SignalK; the plugin gives it its layout back. More in [ADR-0026](docs/decisions/0026-zero-config-setup.md).

The firmware also builds for your desktop (`firmware/esphelm_sdl.yaml`), which is handy for trying layouts without a display. More in [`docs/firmware-runtime.md`](docs/firmware-runtime.md), [`docs/editor.md`](docs/editor.md) and [`docs/plugin-api.md`](docs/plugin-api.md).

## 🛠️ Development

```bash
npm test               # schema, plugin, editor and firmware parser tests (needs g++ and git)
npm run typecheck
npm run lint
npm run e2e:sdl        # the firmware on your desktop against a real signalk-server, 109 golden screenshots
npm run e2e:editor     # the editor in Chrome
npm run e2e -w signalk-esphelm   # the plugin against a real signalk-server
```

CI (`.github/workflows/ci.yml`) runs all of these on GitHub. Images are in Git LFS, so clone with `git-lfs` installed. The firmware's desktop build needs SDL2, OpenSSL, zlib and [IXWebSocket](https://github.com/machinezone/IXWebSocket) in `/usr/local`.

The first `npm test` downloads ArduinoJson 7.4.3 into `firmware/test/.cache/` (set `ESPHELM_ARDUINOJSON` to a copy to work offline). The schema in `packages/schema` is the contract between plugin, editor and firmware; decisions are recorded in [`docs/decisions/`](docs/decisions/) and the layout format in [`docs/layout-schema.md`](docs/layout-schema.md).

## Credits

The RLCD-4.2's panel driver is [ESPHome-ST7305-RLCD](https://github.com/kylehase/ESPHome-ST7305-RLCD) by Kyle Hase (Apache License 2.0), fetched at build time.

The engine tile's oil, fuel, coolant and battery icons are from [Material Design Icons](https://pictogrammers.com/library/mdi/) by Pictogrammers, used under the [Apache License 2.0](https://pictogrammers.com/docs/general/license/).

## 🧭 Project Goals

- Affordable DIY multifunction displays
- Clean, hackable embedded architecture
- Easy to develop new applications
- Simple integration with existing SignalK setups
- Easy customization for different vessels and layouts

## Design Goals

This project uses ESPHome as the "programming environment", a proven environment for embedded IoT devices with HomeAssistant integration and support for thousands of sensors. Integration with SignalK is handled by the [EspHomeSignalK](https://github.com/batuakan/ESPHomeSignalK) external component, which subscribes to SignalK data paths and handles PUT requests.

- The display renders a fixed catalog of widgets; layouts, pages, paths, units, labels and themes change at runtime without a firmware build
- Widgets should not depend on each other
- Everything should be screen resolution agnostic, at least for 480x480 and 720x720 displays
- Reusable components are always preferred


