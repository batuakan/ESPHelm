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
   - **Zones from the server (ADR-0020):** if the SignalK server has zones in the path's metadata, the drawer lists them, read-only, and the preview uses them. They replace the zones you enter, which stay as the fallback for when the server has none.
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

**Text sizes** (ADR-0017): a value tile's number, caption and unit are previewed at the sizes the display will pick for that tile. The editor uses the display's font list from its hello, or the default 480 build's for a display that doesn't report one. A bigger tile gets bigger text. A value wider than two digits (plus decimals) steps down a size, as on the display. The display's digits-only fonts are used for numbers only, so an "on" or a text value is previewed in a smaller full font. The preview draws value tiles in the display's font (Roboto) so the fit matches.

**Value tile colours** (ADR-0016): *Colour* sets a fixed colour (by day; at night everything is red), and *Colour by value* adds rows of from, to and state in the tile's display unit. Leave a bound empty for no limit ("2 or less"). The last matching row wins, over the fixed colour. The preview colours the number as the display does, in the display theme's colours.

**Value history** (ADR-0018, ADR-0019): *Tap for history* (off by default) makes the display record the value, so a tap on the tile opens a graph of it, and shows the small sparkline mark in the tile's corner. Checking it writes `history: true`. On a wind rose, each filled slot has a *Record history* checkbox, and the *History* section has the apparent wind angle, true wind direction and heading; they write the rose's `history` list, and emptying a slot drops its name. Under each checkbox a counter says how many values the whole layout records, with a warning past the C3/C6 limit (6) or the PSRAM limit (48). *Preview graph* opens a mock of the display's popup in the layout's theme (with a button per value on a wind rose; angles drawn around their mean, as on the display), with the 10 min / 1 h / 6 h windows and an example curve around the live value. The display draws what it recorded itself since it started, so the mock is only an example (6 h only on displays with PSRAM).

**Graph tile** (ADR-0021): a line graph of a value's recent history, from the library's *Graph*, 2x1 by default. The drawer has the path, unit, decimals, label and stale time, then *Window* (10 min, 1 h, or 6 h, which is 1 h on C3/C6 displays), *Fixed range* (min and max of the y axis; unchecked, the axis follows the values) and *Zones* (bands behind the line that also colour the value; the server's zones replace them, ADR-0020). A graph always records, so the history counter includes it. The size hint says whether the display has room for the range and time labels (from 120 px of content height). The preview draws an example curve around the live value in the tile's window, with its zone bands; the display draws what it recorded itself.

**Centre zero** (ADR-0023): gauges and bars have a *Centre zero* checkbox, for values either side of zero (rudder, heel, rate of turn, battery current). Checking it makes the range cross zero (min becomes −max when it was 0 or more) and switches `deg` to `deg180`, so negative angles stay negative. *Sides* chooses port/starboard (P and S, red and green) or plus/minus (signed). The preview draws the symmetric scale, the fill from zero and the value as the display writes it ("4.9 kn P", "-4.9 kn"). The problems list says when a centre-zero range doesn't cross zero.

**Heading tape** (ADR-0022): a compass strip that scrolls with the heading, from the library's *Heading tape*, 2x1 by default. The drawer has the caption, the heading path (default `navigation.headingTrue`), the span (degrees across the tape, 30–180, default 90), and a checkbox per marker: course over ground, the bearing to the next waypoint and the autopilot target, each with its own path. A warning appears when the heading is magnetic and an enabled marker is true, or the other way round, since they'd be off by the magnetic variation. The preview draws the same ticks and labels as the display, for the tile's width on the selected display, with the live heading and markers.

**Clock** (ADR-0024): the display's time and/or date, from the library's *Clock*, 1x1 by default with both. The drawer chooses what it shows, 12- or 24-hour, seconds, the date format (each with an example), and UTC instead of the layout's time zone. It has no path: the display keeps its own clock, set from SignalK's `navigation.datetime` (a GPS) or its firmware's NTP or HomeAssistant time. The preview shows this computer's time in the layout's zone. The first clock added to a layout gives it this computer's time zone.

**Position tile:** shows `navigation.position` (or another position path) as two lines. The drawer lists the four formats, each with an example from the live value: degrees and decimal minutes (`60° 09.000' N`), degrees, minutes and seconds, decimal degrees, and signed decimal. *Decimals* applies to the last part (minutes, seconds or degrees); empty uses the format's default. The preview uses the same formatter as the display.

**Display settings** (the *Display settings* button next to the display theme, ADR-0015) are part of the layout too, sent with *Save & send*:
- brightness for the day and the night theme (disabled when the display reports it can't dim its backlight)
- the start page
- *Auto day/night*: the night theme while `environment.sun` (derived-data plugin) says dusk or night; the drawer shows its current value
- *Screen off without a touch*: Never, or 30 s to 1 hour
- *Screen saver* (with a timeout): off, or the time, the date or both, shown faintly instead of turning the screen off, and its brightness (1–100 %, default 30; the P4-86 is dark below about 30 %; when the display can dim)
- *Clock*: the time zone (every IANA zone the browser knows; the layout stores its POSIX rule, so the display follows summer time offline) and the path the time comes from (default `navigation.datetime`)

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
    - a value colour and an open-ended zone, coloured in the preview
    - the value tile's preview text size comes from the display's fonts
    - history off until checked, the counter, the mark and the mock history popup (1 h window, close), a new tile recording nothing, and that the display downloads `history: true` for the first tile only
    - on the wind template: switching a corner's history off and the heading on, the counter, the preview's value buttons, and the `history` list the display downloads
    - Save & send, and that the display downloads exactly that layout (with the colour and zone) and is notified
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
