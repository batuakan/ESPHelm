# ESPHelm editor

Web editor for display layouts (`packages/editor`, React 19 + Vite). It is built into the plugin package (`packages/plugin/public/`), and signalk-server serves it as a webapp at **`http://<signalk>/signalk-esphelm/`** (listed under *Webapps* in the SignalK admin UI). Architecture: ADR-0008.

## Using it
1. **Log in to SignalK as an administrator** (admin UI). The editor uses that login: its API lives under `/plugins/esphelm/api`, which SignalK restricts to admins. Without a login the editor shows a *Log in* link.
2. **Displays** (left column, or the drop-down on a phone): every display that has said hello. A new one is *pending*: press **Adopt**. **Rename** under the selected display gives it a name ("Helm", "Nav station"; empty shows the board again), kept by the plugin. Each line ends with the last four characters of the display's id, the same as *Settings → Info → Display → Id* on the display, so two displays of one board can be told apart. A display only appears after its own SignalK access request was approved with read/write permission (*Security → Access Requests*).
3. **Pages.** Each display has one layout, created on the first save.
   - **The layout bar** at the top holds what applies to the whole layout: **Templates** and **Share** (below), **Display theme** and **Display settings**, and the display's size.
   - **The tabs** under it are the pages, in the order the display shows them. They wrap onto more rows when there are many. The display's footer buttons step through them; the canvas shows a preview of that footer, which every layout has: the page title and the display's settings menu button, ADR-0025, plus the page buttons when there are several pages.
   - **+** adds a **grid page**, a **wind rose page** (a 1x1 grid with one wind rose tile filling the screen), or one page from a starter layout, after the current page.
   - **Templates** replaces *all* pages (and the theme) with a starter layout: Wind, Speeds, Energy, Engine, Switchboard, Autopilot, Passage (for black-and-white displays), or the denser *Sailing*, *Wind and engine* and *Helm* (rose and autopilot side by side) layouts for large displays (listed first when the display's shorter side is at least 600 px). It asks first.
   - **Share** (ADR-0027):
     - **Export file:** downloads the layout as `esphelm-<name>.json` (plain layout v1, including changes not yet sent).
     - **Import file…:** replaces all pages, the theme and the settings with a file's. The layout keeps this display's id and name, and nothing is sent until *Save & send*.
       - A file that isn't a valid layout is refused, with its first errors.
       - Paths and charts this server doesn't have are then listed with a picker each. A replacement applies to every use; *Keep as is* skips them.
     - **Use another display's layout:** pick a display, then **Copy** (its pages become this display's own layout, sent with *Save & send*) or **Link** (both displays show one layout at once, and editing it changes both; the editor says "Shared with …").
     - **Make a separate copy** (on a linked display) gives it its own layout again with the next *Save & send*.
     - **Displays of different shapes** (landscape, portrait or square, after their rotation): before *Link*, the editor says the other screen's shape and that a linked layout is stretched to both, and suggests *Copy*.
   - Under the tabs, the current page's **title** (shown in the display's footer), **← →** to reorder, **Delete** (asks first; the last page can't be deleted), and a grid page's size.
   - Pages or templates that need widgets this display's firmware lacks are struck through or disabled.
4. **Edit a grid page:**
   - **Grid size:** columns × rows, next to the page title. The canvas has the display's aspect ratio, turned by the layout's rotation (ADR-0028, *Display settings → Mounted*), and fits the window: a portrait display is tall, a landscape one gets a wider canvas. The editor reloads the displays every 5 s, so a new size (another display, or a new firmware) shows without a reload.
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
   - **Performance** (ADR-0029): *Laylines* (green and red lines: the heading on each tack at the beat angle upwind, the gybe angle downwind), *Waypoint* (a W marker at the bearing to the next waypoint) and *Target angle* (a bar at the polar's target true wind angle). Their paths are under *Performance sources* (shown once one is on); laylines also take the beat and gybe angles used when SignalK has none (default 45° / 150°; a polar plugin fills `performance.beatAngle` / `gybeAngle`). The preview draws them from the live values, as the display does, and the drawer warns when the heading and the waypoint bearing mix true and magnetic. The *Wind* and *Sailing* starters have laylines and the waypoint on.
   - **Size hint:** the drawer says how large the rose will be on the selected display and what it will draw: *full* (tick labels, heading, centre values), *compact* (no tick labels or heading; as many centre values as fit) or *pointers only*. The preview follows the same tiers. The display decides from the cell it really gets, and the number of centre values that fit in a compact rose depends on its fonts, so the hint is a guide.
6. **Autopilot tiles:** add one from *Tiles* (2x2 where it fits) or with **+ → Autopilot page**. The preview shows the live state, target and heading, and draws the buttons only when the display will show them. The drawer has:
   - **Modes it can engage** (AUTO, WIND, TRACK; STANDBY is always there)
   - **Label**
   - **Autopilot paths** (state, target, course adjustment, heading; empty means the classic `steering.autopilot.*` defaults)
   - a **size hint**: *course and mode buttons*, or *status only* when the tile is too small for safe controls

   The editor never commands the autopilot. On the display, engaging takes a second, confirming tap, STANDBY is one tap, and the course buttons work only while engaged (ADR-0011).
7. **Chart tiles** (ADR-0030; only for displays with PSRAM, which list `chart`): add one from *Tiles* (2x2 where it fits) beside a rose or depth, or with **+ → Chart page** (a 1x1 page with one chart filling it). Several charts can share a page: the display keeps one store of map tiles for all of them, so charts of the same chart and zoom cost no extra memory. Tap a chart for its settings:
   - **Chart:** the charts of your SignalK charts plugin; vector or other non-raster charts are listed but can't be picked.
   - **Zoom** (1–20, default 15), **anchor watch** on/off, and the **SignalK paths** (position, heading, anchor position, radius, alarm; empty means the standard paths).

   - A **size hint** says what the display draws at this size: the map with zoom buttons and the position line, without the line, or the map alone (an anchor alarm then frames it in red).

   The preview draws the chart's own tiles at the live position and zoom, at the tile's size on the display and for its size, with the vessel, the anchor radius and the alarm, in the display theme (red-tinted at night like the display). Until a chart is picked, the problems list says "choose a chart". Layouts with chart pages from before are converted to chart tiles when the plugin loads them or when you import one.
8. **Problems** under the canvas list everything the display would reject (same validator as the plugin and firmware), on every page. Clicking one opens its page and selects its tile or slot. **Save & send** stays disabled until there are none.
9. **Save & send** stores the layout, assigns it to the display, and the display picks it up within seconds through its version subscription. No reboot. Warnings, e.g. a layout larger than the display's reported capacity, are shown after sending.

**Two different themes:**
- **Display theme** (*Display: Day / Dark / Night* above the canvas) is part of the layout. The display draws with it after *Save & send*, and the preview shows the same palette. New layouts start at Night; starter layouts bring their own. *Dark* (ADR-0034) looks like this editor's dark theme; it is greyed out for a display whose firmware doesn't have it (`capabilities.darkTheme` in its hello), since that firmware would refuse the layout.
- **Black-and-white displays** (`display.kind: mono` in the hello, ADR-0035): the preview draws in black and white with outlined tiles, the theme buttons become *Plain* (black on white, `day`) and *Inverted* (`dark`; a `night` layout looks the same there), and a value tile has no *Colour*: its zones show as a style (*Zones by value*). The tile library offers only the tiles the display lists in `widgets`.
- **Editor theme** (*Day*, *Dark*, *Night* in the top bar) only changes this editor's colours, is remembered per browser, and follows the system setting by default. It never changes the display.

**Text sizes** (ADR-0017): a value tile's number, caption and unit are previewed at the sizes the display will pick for that tile. The editor uses the display's font list from its hello, or the default 480 build's for a display that doesn't report one. A bigger tile gets bigger text. A value wider than two digits (plus decimals) steps down a size, as on the display. The display's digits-only fonts are used for numbers only, so an "on" or a text value is previewed in a smaller full font. The preview draws value tiles in the display's font (Roboto) so the fit matches.

**Value tile colours** (ADR-0016): *Colour* sets a fixed colour (by day; at night everything is red), and *Colour by value* adds rows of from, to and state in the tile's display unit. Leave a bound empty for no limit ("2 or less"). The last matching row wins, over the fixed colour. The preview colours the number as the display does, in the display theme's colours.

**Value history** (ADR-0018, ADR-0019): *Tap for history* (off by default) makes the display record the value, so a tap on the tile opens a graph of it, and shows the small sparkline mark in the tile's corner. Checking it writes `history: true`. On a wind rose, each filled slot has a *Record history* checkbox, and the *History* section has the apparent wind angle, true wind direction and heading; they write the rose's `history` list, and emptying a slot drops its name. Under each checkbox a counter says how many values the whole layout records, with a warning past the C3/C6 limit (6) or the PSRAM limit (48). *Preview graph* opens a mock of the display's popup in the layout's theme (with a button per value on a wind rose; angles drawn around their mean, as on the display), with the 10 min / 1 h / 6 h windows and an example curve around the live value. The display draws what it recorded itself since it started, so the mock is only an example (6 h only on displays with PSRAM).

**Graph tile** (ADR-0021): a line graph of a value's recent history, from the library's *Graph*, 2x1 by default. The drawer has the path, unit, decimals, label and stale time, then *Window* (10 min, 1 h, or 6 h, which is 1 h on C3/C6 displays), *Fixed range* (min and max of the y axis; unchecked, the axis follows the values) and *Zones* (bands behind the line that also colour the value; the server's zones replace them, ADR-0020). A graph always records, so the history counter includes it. The size hint says whether the display has room for the range and time labels (from 120 px of content height). The preview draws an example curve around the live value in the tile's window, with its zone bands; the display draws what it recorded itself.

**Centre zero** (ADR-0023): gauges and bars have a *Centre zero* checkbox, for values either side of zero (rudder, heel, rate of turn, battery current). Checking it makes the range cross zero (min becomes −max when it was 0 or more) and switches `deg` to `deg180`, so negative angles stay negative. *Sides* chooses port/starboard (P and S, red and green) or plus/minus (signed). The preview draws the symmetric scale, the fill from zero and the value as the display writes it ("4.9 kn P", "-4.9 kn"). The problems list says when a centre-zero range doesn't cross zero.

**Heading tape** (ADR-0022): a compass strip that scrolls with the heading, from the library's *Heading tape*, 2x1 by default. The drawer has the caption, the heading path (default `navigation.headingTrue`), the span (degrees across the tape, 30–180, default 90), and a checkbox per marker: course over ground, the bearing to the next waypoint and the autopilot target, each with its own path. A warning appears when the heading is magnetic and an enabled marker is true, or the other way round, since they'd be off by the magnetic variation. The preview draws the same ticks and labels as the display, for the tile's width on the selected display, with the live heading and markers.

**Clock** (ADR-0024): the display's time and/or date, from the library's *Clock*, 1x1 by default with both. The drawer chooses what it shows, 12- or 24-hour, seconds, the date format (each with an example), and UTC instead of the layout's time zone. It has no path: the display keeps its own clock, set from SignalK's `navigation.datetime` (a GPS) or its firmware's NTP or HomeAssistant time. The preview shows this computer's time in the layout's zone. The first clock added to a layout gives it this computer's time zone.

**Engine** (ADR-0032): from the library's *Engine*, 2x2 where it fits, starting with the legacy engine screen's values (RPM of `propulsion.p0`, oil pressure, fuel level, coolant). The drawer has a *Revolutions* section (path, unit, range, zones; zones from the server apply here) and one section per slot (*Left*, *Right*, *Bottom gauge*): path, unit, range, zones and an icon (oil can, fuel pump, thermometer, battery, or none to show the label), with *Empty this slot* and *Add a gauge here*, then one section per corner (*Top left corner* and so on) for a plain value, as on a wind rose. The preview draws the display's geometry and icons at the tile's size there, so it drops the slots below 260 px and the labels below 160 px as the display does, and shows a corner value only where the display has room for it outside the arc; a tap on a corner value opens its section. With the slots shown, an empty corner is hinted with a faint *+* (as on a wind rose) that opens its section; the bottom-right one sits clear of the resize handle.

**Position tile:** shows `navigation.position` (or another position path) as two lines. The drawer lists the four formats, each with an example from the live value: degrees and decimal minutes (`60° 09.000' N`), degrees, minutes and seconds, decimal degrees, and signed decimal. *Decimals* applies to the last part (minutes, seconds or degrees); empty uses the format's default. The preview uses the same formatter as the display.

**Display settings** (the *Display settings* button next to the display theme, ADR-0015) are part of the layout too, sent with *Save & send*:
- *Mounted* (ADR-0028): as built, or turned 90°, 180° or 270° clockwise for a display mounted sideways or upside down. The canvas turns at once; the pages are laid out for the turned screen. Disabled, with a note, when the display reports it can't turn its picture
- brightness for the day and the night theme (disabled when the display reports it can't dim its backlight)
- *Sound* (ADR-0033): the volume (10–100 %, default 60) and *Touch sounds*, a click when a button or tile is touched. Disabled, with a note, when the display reports no speaker. Alarms sound when the server asks for it (their `method` includes `sound`)
- the start page
- *Auto day/night*: the night theme while `environment.sun` (derived-data plugin) says dusk or night; the drawer shows its current value
- *Screen off without a touch*: Never, or 30 s to 1 hour
- *Screen saver* (with a timeout): off, or the time, the date or both, shown faintly instead of turning the screen off, and its brightness (1–100 %, default 30; the P4-86 is dark below about 30 %; when the display can dim)
- *Clock*: the time zone (every IANA zone the browser knows; the layout stores its POSIX rule, so the display follows summer time offline) and the path the time comes from (default `navigation.datetime`)

Removing the start page, or replacing the pages with a starter layout, resets it to the first page.

A display that skipped a layout because it crashed while showing it (boot guard, ADR-0013) is marked in the display list until you send a changed layout.

**Firmware** (the *Firmware* button above the display list, ADR-0036): updates over the network, for displays on firmware 0.4.0 or later (the first install is over USB).
- **Upload .bin:** an update image (`esphelm-<board>-<version>.ota.bin` from a release, or `firmware.ota.bin` from your own build). The plugin reads its version, board and tile set from the image; a factory image or a file that isn't ESPHelm firmware is refused. Two images are kept per board.
- **Check GitHub for updates:** fetches the latest release's images for the boards of your displays. Only when pressed; it needs an internet connection, the upload doesn't.
- **Install** on a display that can take an image (same board and tile set), after *The display restarts.* The display shows its progress, restarts, and comes back with the new version, or on its old firmware if the new one doesn't start.
- **In the display list:** each display's firmware version; *Update to X* when a newer image is there (asks once); the update's state while it runs (*Cancel* until the display starts downloading); *Updated to X*, or *Update to X failed* with the reason (× clears it).

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
    - a wind page from a template with a slot changed to depth (live pointer and value, size hint "full"), a new grid page with a gauge, a zone and a rose tile next to it (laylines on at a fixed beat angle of 40°, previewed with the true wind), moving the wind page to the front, and that the display downloads the three pages in that order
    - on the 720 display the large-display templates come first; *Sailing (large display)* is delivered exactly as the template
    - *Helm (large display)*: the autopilot gets its buttons (size hint), WIND unticked, and the display downloads it without WIND
    - a chart page with the test chart of a charts stand-in: tiles in the preview around the sample-data position, a value added beside the chart, and the display downloads the chart tile and the value
    - an engine tile on a new page: a faint *+* in each of its four empty corners, and the bottom-right one (beside the resize handle) opens that corner in the drawer
    - sharing: a second display; *Export file* downloads exactly the layout the display gets; a file with a path the server lacks is imported on the second display, the path replaced in the list, and the display gets it under its own id; *Link* gives both displays one layout and *Make a separate copy* separates them again
    - rotation: the display says hello as a 1280×800 panel that can turn; the editor follows without a reload with a wider preview (`17-desktop-landscape`); *Display settings → Mounted → 90°* previews 800×1280 at once, fitting the window (`18-desktop-portrait`), and *Save & send* puts `settings.rotation: 90` in the layout; linking a square display to it warns
    - phone: tile drawer, and a tap on a rose slot opens that slot in the drawer

    Screenshots (desktop light/night, wind rose, gauge with a rose, Sailing 720, phone dark) go to a temp dir printed by the test.

## Not covered yet
- A list of the boat's active alarms (the display shows them; the editor doesn't yet).
- Copying tiles between pages, undo.
- Preview is an HTML approximation of the display (open question 7); SDL-rendered previews could come later.
- Tested in Chrome (desktop and emulated phone with touch) only; Safari/Firefox and real phones are unverified.
