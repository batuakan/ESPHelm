# ⚓ ESPHelm

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

- **Tiles:** value (coloured by a fixed colour or by thresholds; the text grows and shrinks with the tile; tap one for a graph of its last 10 min, 1 h or 6 h), gauge (with coloured zones), bar, switch (sends a SignalK PUT), position (GPS in four formats), wind rose with up to seven values of your choice, and an autopilot with safe controls (tap to arm, confirm to engage, one-tap STANDBY).
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

**Firmware:** create `firmware/secrets.yaml` (`wifi_ssid`, `wifi_password`, `signalk_host`), then:

```bash
esphome run firmware/esphelm_p4.yaml
```

The firmware also builds for your desktop (`firmware/esphelm_sdl.yaml`), which is handy for trying layouts without a display. More in [`docs/firmware-runtime.md`](docs/firmware-runtime.md), [`docs/editor.md`](docs/editor.md) and [`docs/plugin-api.md`](docs/plugin-api.md).

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


## The original static apps

These are the ESPHome YAML applications ESPHelm started with. They are no longer in `main`; they live on in the [`ESPHelmv1` tag](https://github.com/batuakan/ESPHelm/tree/ESPHelmv1/legacy), and each is now also a template in the editor.

<p align="center">
 <img width="200px" src="/docs/images/weather.png">
 <img width="200px" src="/docs/images/engine.png">
 <img width="200px" src="/docs/images/wind.png">
 <img width="200px" src="/docs/images/chart.png">
 <img width="200px" src="/docs/images/switchboard.png">
 <img width="200px" src="/docs/images/grid.png">
 <img width="200px" src="/docs/images/energy.png">
</p>

```bash
git checkout ESPHelmv1
esphome run legacy/MFD.yaml
```

Build and upload to your ESP device (with `secrets.yaml` next to the configs).

### Weather and clock

<img width="200px" src="/docs/images/weather.png">
<img width="200px" src="/docs/images/forecast.png">


Who doesn't need a stylish clock and weather forecast on their MFD!! This application displays the current time, current weather conditions and a 5 day forecast fetched from HomeAssistant showing: outlook, min/max temperature, wind direction, wind speed and gusts.

Not ported to the runtime yet: where weather should come from is still an open question.

### Wind

 <img width="200px" src="/docs/images/wind.png">

Not much to say here, a wind instrument application showing:

- SOG
- TWS
- AWS
- True Heading
- Compass rose
- Apparent Wind Direction
- True Wind Direction.

Rotating the compass rose on ESP32 C3 takes a significant amount of resources, so comment it out if things get slow.


### Engine

<img width="200px" src="/docs/images/engine.png">

A simple engine monitoring application, showing

- engine rpm
- temperature
- oil pressure
- fuel level



### Energy

 <img width="200px" src="/docs/images/energy.png">

A simple battery, solar, and shore power consumption contribution application showing

- House battery state of charge
- Shore power input in amp hours
- Solar input in amp hours
- House battery consumption in amp hours
- House battery voltage in volts (blue indicator)
- Engine battery voltage in volts (red indicator)

### Grid

 <img width="200px" src="/docs/images/grid.png">

A simple numeric display, if you don't want to see additional clutter, showing

- Speed over ground
- Apparent wind speed
- True wind speed
- Speed through water

Modify according to your needs

**TODO:**

- [ ] It would be nice to see a graph of history behind the numeric values


### Anchor Watch / Chart

 <img width="200px" src="/docs/images/chart.png">
<img width="200px" src="/docs/images/anchor.png">

A simple chart utilizing SignalK charts (mbtiles or proxied/cached charts) using the [chart-plugin](https://github.com/SignalK/charts-plugin) and [signalk-rgb565-proxy](https://github.com/batuakan/SignalKRGB565Proxy) plugins. chart-plugin provides the charts and fetches them from the remote server if needed. The rgb565 plugin decodes the image and converts it to raw pixel values in rgb565 16 bit format and sends them to the esp32, where they get stitched together and displayed in the viewport using the [ESPTiles](https://github.com/batuakan/ESPTiles) external esphome component. The application centers the vessel on the display.

Additionally this application subscribes to anchor position and anchor maxRadius and displays an overlay over the chart showing the anchor swing area.

The runtime's chart page does the same without the proxy plugin: the ESPHelm plugin converts the tiles itself.

**TODO:**

- [ ] Clean up the view when the anchor is pulled up. Hide the anchor icon and the circle.
- [ ] Anchor view feels a little iffy as the data received for vessel position and anchor position is received asynchronously.
- [ ] Display depth and current radius
- [ ] Add GUI buttons to drop and pull the anchor

### Autopilot

 <img width="200px" src="/docs/images/autopilot.png">

This application utilizes the [signalk-autopilot](https://github.com/SignalK/signalk-autopilot) plugin, passes requests as PUT requests and subscribes to relevant topics to display data.

One interesting extension to the autopilot would be a small esp32 based wireless remote for your autopilot with physical buttons and a small display.

**WARNING** This application has not been tested with a real autopilot yet, only the simulated one provided by the autopilot plugin. The same goes for the runtime's autopilot tile.

**TODO:**

- [ ] Test using real autopilots
- [ ] Would be nice to show a small nautical chart and the current leg of the route you are following

### Switchboard

 <img width="200px" src="/docs/images/switchboard.png">

Use the switchboard application to turn smart switches on and off. The application currently populates a list of switches, but you need to adjust them to your needs of course. The switches can control HomeAssistant switches, SignalK switches or switches on the esp32 itself such as relays. In the legacy app the control logic is not included yet; the runtime's switch tile sends SignalK PUT requests.


## What is missing

The following applications would be nice to have

- [x] Engine monitoring
  - [x] RPM
  - [x] Oil Pressure
  - [x] Various temperature measurements
- [x] Alarms
- [ ] Tanks monitoring
  - [ ] Fresh Water
  - [ ] Diesel
  - [ ] Waste
- [ ] Weather and clock in the runtime
- [ ] Graphs of value history
