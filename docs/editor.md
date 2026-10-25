# ESPHelm editor

Web editor for display layouts (`packages/editor`, React 19 + Vite). It is built into the plugin package (`packages/plugin/public/`), and signalk-server serves it as a webapp at **`http://<signalk>/signalk-esphelm/`** (listed under *Webapps* in the SignalK admin UI). Architecture: ADR-0008.

## Using it
1. **Log in to SignalK as an administrator** (admin UI). The editor uses that login: its API lives under `/plugins/esphelm/api`, which SignalK restricts to admins. Without a login the editor shows a *Log in* link.
2. **Displays** (left column, or the drop-down on a phone): every display that has said hello. A new one is *pending*: press **Adopt**. A display only appears after its own SignalK access request was approved with read/write permission (*Security → Access Requests*).
3. **Pages.** Each display has one layout, created on the first save. The tabs above the canvas are its pages, in the order the display shows them (its footer buttons step through them; the canvas shows a preview of that footer when there are several pages):
   - **+** adds a **grid page**, a **wind rose page**, or one page from a starter layout, after the current page.
   - **Templates** replaces *all* pages (and the theme) with a starter layout: Wind, Speeds, Energy, Engine or Switchboard. It asks first.
   - The current page's **title** (shown in the display's footer), **← →** to reorder, **Delete** (asks first; the last page can't be deleted).
   - Pages or templates that need widgets this display's firmware lacks are struck through or disabled.
4. **Edit a grid page:**
   - **Grid size:** columns × rows above the canvas. The canvas has the display's aspect ratio.
   - **Add a tile:** click a tile type in *Tiles* (first free cell), or drag it onto a free cell. Types the display's firmware can't render are disabled and marked `n/a` (from its hello).
   - **Move:** drag a tile. **Resize:** drag its bottom-right corner. Cells snap; a red outline means it won't fit there.
   - **Settings** (right drawer, a bottom sheet on a phone):
     - **SignalK path:** search the server's paths, showing their current value and SI units.
     - **Unit:** only units that fit the path's quantity. Picking a path chooses a sensible default (kn for speeds, °C for temperatures, and so on).
     - **Decimals** (default 1), **Label** (ASCII and `°` only, the glyphs the display has), **Stale after** (seconds; default 15).
     - **Gauge and bar:** **Min / Max** and **Zones** (from, to, state: normal, warn, alarm, emergency; in display units, inside min..max). Bars also have an **orientation**.
     - **Switch:** a path (on/off paths are listed first) and a label. On the display a tap sends a PUT, so the path needs something on the server that handles PUTs (e.g. a digital-switching plugin).
   - Tiles show **live values** from SignalK, converted exactly as the display does (same unit table and rounding): gauges with arc, zones and needle, bars with a zone-coloured fill, switches on/off.
5. **Edit a wind rose page:** the rose shows the live apparent wind (and true wind) pointers and heading. Tap one of the three **centre slots** to choose what it shows; it has the same settings as a value tile. Tap the rose itself for its sources (apparent wind angle, true wind direction, heading; empty means the standard SignalK path) and the true-wind pointer.
6. **Problems** under the canvas list everything the display would reject (same validator as the plugin and firmware), on every page. Clicking one opens its page and selects its tile or slot. **Save & send** stays disabled until there are none.
7. **Save & send** stores the layout, assigns it to the display, and the display picks it up within seconds through its version subscription. No reboot. Warnings, e.g. a layout larger than the display's reported capacity, are shown after sending.

**Themes:** *Day*, *Dark* and *Night* (red on black, for the cockpit at night), remembered per browser. The default follows the system setting.

## Developing
- `npm run dev -w @esphelm/editor`: Vite dev server with hot reload. API and stream requests are proxied to `ESPHELM_SIGNALK` (default `http://localhost:3000`), which must run the plugin. Log in to that server in the same browser first (the cookie is per host, so open the admin UI through the dev server: `http://localhost:5173/admin/`).
- `npm run build`: builds schema, plugin and editor; the editor goes into `packages/plugin/public/` (gitignored).
- **Tests:**
  - `npm test` runs `packages/editor/test/` (layout operations, formatting, API errors, and component tests in jsdom).
  - `npm run build && npm run e2e:editor` runs the browser test. A real signalk-server (security on, sample NMEA data) with the built plugin, driven by the installed **Google Chrome** headless through playwright-core (`CHROME=/path/to/chrome` to pick another). It checks:
    - login hint, adopt, path picker, live value
    - drag from the library, corner resize
    - invalid label blocks sending
    - Save & send, and that the display downloads exactly that layout and is notified
    - a wind page from a template with a slot changed to depth (live pointer and value), a new grid page with a gauge and a zone, moving the wind page to the front, and that the display downloads the three pages in that order
    - phone: tile drawer and slot drawer as bottom sheets

    Screenshots (desktop light/night, wind rose, gauge zones, phone dark) go to a temp dir printed by the test.

## Not covered yet
- Autopilot and chart/anchor pages (Phases 5b/5c).
- Copying tiles between pages, undo.
- Preview is an HTML approximation of the display (open question 7); SDL-rendered previews could come later.
- Tested in Chrome (desktop and emulated phone with touch) only; Safari/Firefox and real phones are unverified.
