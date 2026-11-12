# signalk-esphelm

Design the screens of your [ESPHelm](https://github.com/batuakan/ESPHelm) displays in your SignalK server, and send them to the displays without reflashing.

ESPHelm is open-source ESP32 multifunction displays for boats. This plugin is their server side:

- **Editor:** a web app at `/signalk-esphelm/` on your server. Pick a display, see its pages side by side with live values, drag tiles onto a grid, set paths, units and zones, and press *Save & send*. It works on a phone and has day, dark and night themes.
- **Layouts:** stored on the server and served to the displays, which cache them and keep working offline.
- **Devices:** a display announces itself when it first connects; you adopt it in the editor and give it a layout.
- **Charts:** chart tiles get their map tiles from your SignalK charts through the plugin.

<p>
 <img width="200" src="https://github.com/batuakan/ESPHelm/raw/main/docs/images/display-wind-day.png" alt="Wind rose by day">
 <img width="200" src="https://github.com/batuakan/ESPHelm/raw/main/docs/images/display-engine-dark.png" alt="Engine tile, dark theme">
 <img width="200" src="https://github.com/batuakan/ESPHelm/raw/main/docs/images/display-chart-tiles.png" alt="Chart tiles">
</p>

## Install

1. In the SignalK admin UI, open *Appstore → Available*, find **ESPHelm** and install it. (Or `npm install signalk-esphelm` in your SignalK config dir, usually `~/.signalk`.)
2. Restart the server and enable *ESPHelm* under *Server → Plugin Config*.
3. Open the editor from *Webapps*, or at `http://<your-server>:3000/signalk-esphelm/`.

Requires Node 22 or later.

## Displays

Firmware for the supported boards (Waveshare ESP32-P4-86, Guition ESP32-S3-4848S040, the ESP32-2432S028R "cheap yellow display", the Waveshare ESP32-S3-RLCD-4.2) is on the [releases page](https://github.com/batuakan/ESPHelm/releases). A new display:

1. shows a QR code for its own setup network: join it and pick the boat's Wi-Fi;
2. finds the SignalK server with mDNS and asks for access: approve it with read/write under *Security → Access Requests*;
3. appears in the editor: adopt it and assign a layout.

Everything stays on the boat's network; nothing talks to the internet.

## Security

With SignalK security on, the editor and its API need an admin login. Displays use the token from their approved access request, with read/write permission; there is no anonymous access.

## More

- [Project README](https://github.com/batuakan/ESPHelm#readme)
- [Plugin API](https://github.com/batuakan/ESPHelm/blob/main/docs/plugin-api.md)
- [Editor](https://github.com/batuakan/ESPHelm/blob/main/docs/editor.md)
- [Issues](https://github.com/batuakan/ESPHelm/issues)

MIT licensed.
