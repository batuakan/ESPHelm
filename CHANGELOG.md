# Changelog

What changed in each ESPHelm release: the display firmware, the SignalK plugin `signalk-esphelm` with its editor, and the layout contract `@esphelm/schema`. They are released together. Each GitHub release starts with its section from this file, and the SignalK App Store shows those notes on the plugin's *Changelog* tab.

## Unreleased

### New
- **HTTPS and WSS to the SignalK server.** A server with SSL is found and preferred. The display trusts the server's certificate the first time it connects, and refuses another one later, so its token can't go to a machine posing as the server. The *Network* tab shows the certificate's fingerprint. A server that really got a new certificate is trusted again with *Forget server*. Not on the cheap yellow display (CYD), which has no PSRAM to spare.
- **Display access in the editor.** The editor warns when a display's SignalK access is about to run out (when it was approved with an expiration). *Remove display* removes a display from ESPHelm and revokes its SignalK access, so a lost display can't read or change anything on the boat.
- **Mute all sound.** One switch, on the display (*Settings → Sound*) or in the editor (*Display settings → Sound*), silences every alarm tone, emergencies included, and the touch clicks. The alarm banner still shows every alarm, the footer shows a crossed-out speaker, and switching the sound back on plays any alarm still waiting at once. Needs this firmware; the editor offers it only to displays that have it.

### Changed
- The starter layouts, and new layouts, start on the **Day** theme. Night (red on black, dimmed) looked like a dead screen in daylight. It's one tap away in the editor.
- On displays with PSRAM, the encryption buffers live in PSRAM, so HTTPS costs no extra internal memory.

## 0.5.0 (2026-11-20)
Firmware 0.5.0 · signalk-esphelm 0.3.0 · @esphelm/schema 1.2.0

### New
- **Alarms panel tile:** every active SignalK alarm at once, worst first, with how long each has been on and an ACK per row. It can show one branch only, e.g. the electrical alarms.
- **Route on the chart:** the active route and the next waypoint from SignalK's course API. When the waypoint is off the chart, an arrow at the edge shows its direction and distance.
- **Black-and-white displays** gain the wind rose, engine, gauge, heading tape and graph tiles.
- **Demo displays** in the editor (480×480, 720×720, 400×300 black and white, 320×240 without PSRAM): try the editor with your boat's live values before you have a display. Turn them off in the plugin's settings.
- **Display names:** name each display in the editor. The end of its id is shown to tell two displays of one board apart.
- On the Waveshare RLCD, a long press on BOOT hides the page footer.

### Fixed
- The RLCD redraws after every frame, and its setup screen puts the QR code beside the text.

## 0.4.0 (2026-11-14)
Firmware 0.4.0 · signalk-esphelm 0.2.0 · @esphelm/schema 1.1.0

The first release with firmware images on GitHub. Highlights:
- **Firmware updates from the editor:** upload an image or fetch the latest release, and press *Update* on a display. Only the first install is over USB.
- **Boards:** the Waveshare ESP32-P4-86, the Guition ESP32-S3-4848S040, the cheap yellow display (ESP32-2432S028R) and the Waveshare ESP32-S3-RLCD-4.2 (black and white, with its own tile set).
- **Tiles:** value, gauge, bar, switch, position, wind rose (laylines, waypoint, target angle), autopilot, graph, heading tape, centre-zero gauges and bars, clock, engine and chart (anchor watch).
- **Display:** a settings and information panel, a Dark theme next to Day and Night, alarm tones and touch clicks on the P4, mounting rotation, and setup without configuration (Wi-Fi from the display's own setup network, the server found by itself).
- **Editor:** layouts shared as files and between displays, zones from SignalK metadata.
