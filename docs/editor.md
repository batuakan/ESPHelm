# ESPHelm editor

Web editor for display layouts (`packages/editor`, React 19 + Vite). It is built into the plugin package (`packages/plugin/public/`), and signalk-server serves it as a webapp at **`http://<signalk>/signalk-esphelm/`** (listed under *Webapps* in the SignalK admin UI). Architecture: ADR-0008.

## Using it
1. **Log in to SignalK as an administrator** (admin UI). The editor uses that login: its API lives under `/plugins/esphelm/api`, which SignalK restricts to admins. Without a login the editor shows a *Log in* link.
2. **Displays** (left column, or the drop-down on a phone): every display that has said hello. A new one is *pending*: press **Adopt**. A display only appears after its own SignalK access request was approved with read/write permission (*Security → Access Requests*).
3. **Pages.** Each display has one layout, created on the first save. The tabs above the canvas are its pages, in the order the display shows them (its footer buttons step through them; the canvas shows a preview of that footer when there are several pages):
   - **+** adds a **grid page**, a **wind rose page** (a 1x1 grid with one wind rose tile filling the screen), or one page from a starter layout, after the current page.
   - **Templates** replaces *all* pages (and the theme) with a starter layout: Wind, Speeds, Energy, Engine, Switchboard, Autopilot, or the denser *Sailing*, *Wind and engine* and *Helm* (rose and autopilot side by side) layouts for large displays (listed first when the display's shorter side is at least 600 px). It asks first.
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
5. **Wind rose tiles:** add one from *Tiles* like any other tile (it takes 2x2 where that fits), next to gauges or values, or several per page. The preview is drawn like the display (the legacy wind page): fixed ring with red/green sectors, compass card turning with the live heading, A/T markers, big centre values, in the display theme's colours.
   - Tap one of the three **centre slots** or four **corner slots** on the rose, or open it in the drawer, to choose what it shows; a slot has the same settings as a value tile. Corner values show on the display only when they fit outside the ring (full-size roses).
   - *Wind and heading sources*: apparent wind angle, true wind direction, heading (empty means the standard SignalK path), and the true-wind pointer.
   - **Size hint:** the drawer says how large the rose will be on the selected display and what it will draw: *full* (tick labels, heading, centre values), *compact* (no tick labels or heading; as many centre values as fit) or *pointers only*. The preview follows the same tiers. The display decides from the cell it really gets, and the number of centre values that fit in a compact rose depends on its fonts, so the hint is a guide.
6. **Autopilot tiles:** add one from *Tiles* (2x2 where it fits) or with **+ → Autopilot page**. The preview shows the live state, target and heading, and draws the buttons only when the display will show them. The drawer has:
   - **Modes it can engage** (AUTO, WIND, TRACK; STANDBY is always there)
   - **Label**
   - **Autopilot paths** (state, target, course adjustment, heading; empty means the classic `steering.autopilot.*` defaults)
   - a **size hint**: *course and mode buttons*, or *status only* when the tile is too small for safe controls

   The editor never commands the autopilot. On the display, engaging takes a second, confirming tap, STANDBY is one tap, and the course buttons work only while engaged (ADR-0011).
7. **Chart pages:** **+ → Chart page** (only for displays with PSRAM, which list `chart`). Tap the map for its settings:
   - **Chart:** the charts of your SignalK charts plugin; vector or other non-raster charts are listed but can't be picked.
   - **Zoom** (1–20, default 15), **anchor watch** on/off, and the **SignalK paths** (position, heading, anchor position, radius, alarm; empty means the standard paths).

   The preview draws the chart's own tiles at the live position and zoom, with the vessel, the anchor radius and the alarm, in the display theme (red-tinted at night like the display). Until a chart is picked, the problems list says "choose a chart".
8. **Problems** under the canvas list everything the display would reject (same validator as the plugin and firmware), on every page. Clicking one opens its page and selects its tile or slot. **Save & send** stays disabled until there are none.
9. **Save & send** stores the layout, assigns it to the display, and the display picks it up within seconds through its version subscription. No reboot. Warnings, e.g. a layout larger than the display's reported capacity, are shown after sending.

**Two different themes:**
- **Display theme** (*Display: Day / Night* above the canvas) is part of the layout. The display draws with it after *Save & send*, and the preview shows the same palette. New layouts start at Night; starter layouts bring their own.
- **Editor theme** (*Day*, *Dark*, *Night* in the top bar) only changes this editor's colours, is remembered per browser, and follows the system setting by default. It never changes the display.

**Display settings** (the *Display settings* button next to the display theme, ADR-0015) are part of the layout too, sent with *Save & send*:
- brightness for the day and the night theme (disabled when the display reports it can't dim its backlight)
- the start page
- *Auto day/night*: the night theme while `environment.sun` (derived-data plugin) says dusk or night; the drawer shows its current value
- *Screen off without a touch*: Never, or 30 s to 1 hour

Removing the start page, or replacing the pages with a starter layout, resets it to the first page.

A display that skipped a layout because it crashed while showing it (boot guard, ADR-0013) is marked in the display list until you send a changed layout.

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
    - a wind page from a template with a slot changed to depth (live pointer and value, size hint "full"), a new grid page with a gauge, a zone and a rose tile next to it, moving the wind page to the front, and that the display downloads the three pages in that order
    - on the 720 display the large-display templates come first; *Sailing (large display)* is delivered exactly as the template
    - *Helm (large display)*: the autopilot gets its buttons (size hint), WIND unticked, and the display downloads it without WIND
    - a chart page with the test chart of a charts stand-in: tiles in the preview around the sample-data position, and the display downloads the page
    - phone: tile drawer, and a tap on a rose slot opens that slot in the drawer

    Screenshots (desktop light/night, wind rose, gauge with a rose, Sailing 720, phone dark) go to a temp dir printed by the test.

## Not covered yet
- A list of the boat's active alarms (the display shows them; the editor doesn't yet).
- Copying tiles between pages, undo.
- Preview is an HTML approximation of the display (open question 7); SDL-rendered previews could come later.
- Tested in Chrome (desktop and emulated phone with touch) only; Safari/Firefox and real phones are unverified.
