<p align="center"><img width="96px" src="packages/editor/public/icon.svg" alt="ESPHelm"></p>

# ESPHelm

**ESPHelm — Open-source ESP32 multifunction marine displays with native SignalK support.**

ESPHelm is a lightweight, open-source marine display platform built on ESP32.
It connects directly to SignalK (and HomeAssistant) to show real-time vessel data on affordable, customizable hardware, and you design its screens in a web editor that runs inside your SignalK server. No YAML, no recompiling.

---

<p align="center">
 <img width="200px" src="/docs/images/display-wind-day.png">
 <img width="200px" src="/docs/images/display-wind-night.png">
 <img width="200px" src="/docs/images/display-engine-day.png">
 <img width="200px" src="/docs/images/display-energy-night.png">
 <img width="200px" src="/docs/images/display-switchboard-day.png">
 <img width="200px" src="/docs/images/display-autopilot-night.png">
 <img width="200px" src="/docs/images/display-grid-day.png">
 <img width="200px" src="/docs/images/display-alarm-night.png">
</p>

<p align="center"><em>Screens rendered by the ESPHelm firmware (desktop build at 480×480) with live SignalK data, in the day and night themes.</em></p>

---

I have always wanted to have a multi function display (MFD) on the electric panel of my sailboat, only to have my jaw drop at the very high prices.

This project started as a collection of ESPHome recipes that together function as an MFD (they live on in the [`ESPHelmv1` tag](https://github.com/batuakan/ESPHelm/tree/ESPHelmv1/legacy), see [the original apps](#the-original-static-apps) below). It has since grown into a display whose screens you can change at any time from a browser, on the boat, from your phone.

For this project I have chosen the [ESP32-P4 Smart 86 display from Waveshare](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-4b.htm) for its "classic" square look and its high resolution, high-performance, dual-core RISC-V architecture. ESP32-S3 boards with PSRAM and the smaller ESP32-C3 and C6 boards are targets too (the C3 build compiles; chart pages need PSRAM).

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

It works on a phone too, and has day, dark and night (red) themes of its own, separate from the display's theme.

<p align="center">
 <img width="260px" src="/docs/images/editor-phone.png">
 <img width="520px" src="/docs/images/editor-night-settings.png">
</p>

## 🌊 Features

- **Tiles:** value (coloured by a fixed colour or by thresholds; the text grows and shrinks with the tile), gauge (with coloured zones), bar, switch (sends a SignalK PUT), position (GPS in four formats), wind rose with up to seven values of your choice (and its angles), and an autopilot with safe controls (tap to arm, confirm to engage, one-tap STANDBY).
- **History graphs:** tap a value that records to see its last 10 min, 1 h or 6 h. You choose which values record, per value, in the editor, so values nobody looks at take no memory: nothing records unless you switch it on. A wind rose can record any of its values, with buttons in the graph to switch between them, and angles such as the heading are averaged on the circle, so a graph across north has no jump. The editor counts what a layout records against the board's limit (48 values with PSRAM, 6 without). The display records from when it starts, and keeps the 6 h graph only with PSRAM.
- **Pages:** as many as you like, with page buttons in a footer, plus a full-screen **chart page** with anchor watch (SignalK charts, PSRAM boards).
- **Templates** porting the original apps (wind, speeds, energy, engine, switchboard, autopilot, chart) and denser layouts for 720×720 displays.
- **Alarms:** every SignalK notification shows in a banner at the top of the display, worst first. **ACK** silences it through the plugin; an escalation sounds again.
- **Display settings** in the editor: day and night brightness, start page, automatic day/night from the sun, and a screen timeout whose waking touch never presses a button.
- **Day/night on the display itself:** hold the page title in the footer for a second (see [On the display](#-on-the-display)).
- **Offline first:** the last layout is cached on the display and shown at boot without a network; stale values are marked instead of frozen.
- **Safe with bad layouts:** every layout is validated on the device, and one that crashes the display is skipped at the next boot in favour of the last one that worked.
- **Resolution agnostic:** layouts are grids, so the same layout works on 480×480 and 720×720.
- Everything stays on the boat's LAN: no cloud, no telemetry.

<p align="center">
 <img width="360px" src="/docs/images/display-sailing-720-night.png">
</p>
<p align="center"><em>The "Sailing" template on a 720×720 display, night theme.</em></p>

## 👆 On the display

- **Change page:** the **<** and **>** buttons in the footer.
- **Switch day/night:** press and **hold the page title** in the footer (between the **<** and **>** buttons) for one second. The page redraws in the other theme, at that theme's brightness.
  - With automatic day/night on, your choice holds until the next sunrise or sunset, then the sun takes over again.
  - Sending a layout with a different theme from the editor also replaces it, and a restart goes back to the layout's theme.
  - The footer only appears on layouts with more than one page, so a single-page layout can't be switched on the display: set its theme in the editor.
- **Alarms:** tap the banner to see the next alarm, **ACK** to acknowledge it.
- **Screen off** (screen timeout): the first touch only wakes the display, it never presses a button.

## 🚀 Getting started

> **Status:** the runtime-configurable ESPHelm is tested end to end on the desktop build and against real signalk-server versions, but **not yet on real hardware**. Expect rough edges, and please report them.

You need a SignalK server, Node 22, and [ESPHome](https://esphome.io/) for the firmware.

```bash
git clone https://github.com/batuakan/ESPHelm.git
cd ESPHelm
npm ci
npm run build
```

**Plugin and editor:** symlink `packages/plugin` into your SignalK config dir as `node_modules/signalk-esphelm`, add `"signalk-esphelm": "*"` to that dir's `package.json` dependencies, restart SignalK and enable *ESPHelm* under *Server → Plugin Config*. The editor is then at `/signalk-esphelm/` on your server. (An npm / App Store package comes later.)

**Firmware:** create `firmware/secrets.yaml` (`wifi_ssid`, `wifi_password`, `signalk_host`; it is git-ignored). The [EspHomeSignalK](https://github.com/batuakan/ESPHomeSignalK) component is fetched from GitHub when you build. The P4 board also needs its Wi-Fi co-processor firmware, `firmware/network_adapter_esp32c6.bin`, from [esphome/esp-hosted-firmware](https://github.com/esphome/esp-hosted-firmware) (it is not in this repository). Then:

```bash
esphome run firmware/esphelm_p4.yaml
```

The firmware also builds for your desktop (`firmware/esphelm_sdl.yaml`), which is handy for trying layouts without a display. More in [`docs/firmware-runtime.md`](docs/firmware-runtime.md), [`docs/editor.md`](docs/editor.md) and [`docs/plugin-api.md`](docs/plugin-api.md).

## 🛠️ Development

```bash
npm test               # schema, plugin, editor and firmware parser tests (needs g++ and git)
npm run typecheck
npm run lint
npm run e2e:sdl        # the firmware on your desktop against a real signalk-server, 48 golden screenshots
npm run e2e:editor     # the editor in Chrome
npm run e2e -w signalk-esphelm   # the plugin against a real signalk-server
```

The first `npm test` downloads ArduinoJson 7.4.3 into `firmware/test/.cache/` (set `ESPHELM_ARDUINOJSON` to a copy to work offline). The schema in `packages/schema` is the contract between plugin, editor and firmware; decisions are recorded in [`docs/decisions/`](docs/decisions/) and the layout format in [`docs/layout-schema.md`](docs/layout-schema.md).

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


