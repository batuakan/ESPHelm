# ESPHelm editor

Web editor for display layouts (`packages/editor`, React 19 + Vite). It is built into the plugin package (`packages/plugin/public/`), and signalk-server serves it as a webapp at **`http://<signalk>/signalk-esphelm/`** (listed under *Webapps* in the SignalK admin UI). Architecture: ADR-0008.

## Using it
1. **Log in to SignalK as an administrator** (admin UI). The editor uses that login: its API lives under `/plugins/esphelm/api`, which SignalK restricts to admins. Without a login the editor shows a *Log in* link.
2. **Displays** (left column, or the drop-down on a phone): every display that has said hello. A new one is *pending*: press **Adopt**. A display only appears after its own SignalK access request was approved with read/write permission (*Security → Access Requests*).
3. **Edit the page.** Each display has one layout, created on the first save. The editor works on its first grid page:
   - **Grid size:** columns × rows above the canvas. The canvas has the display's aspect ratio.
   - **Add a tile:** click a tile type in *Tiles* (first free cell), or drag it onto a free cell. Types the display's firmware can't render are disabled and marked `n/a` (from its hello).
   - **Move:** drag a tile. **Resize:** drag its bottom-right corner. Cells snap; a red outline means it won't fit there.
   - **Settings** (right drawer, a bottom sheet on a phone):
     - **SignalK path:** search the server's paths, showing their current value and SI units.
     - **Unit:** only units that fit the path's quantity. Picking a path chooses a sensible default (kn for speeds, °C for temperatures, and so on).
     - **Decimals** (default 1), **Label** (ASCII and `°` only, the glyphs the display has), **Stale after** (seconds; default 15).
   - Tiles show **live values** from SignalK, converted exactly as the display does (same unit table and rounding).
4. **Problems** under the canvas list everything the display would reject (same validator as the plugin and firmware). Clicking one selects its tile. **Save & send** stays disabled until there are none.
5. **Save & send** stores the layout, assigns it to the display, and the display picks it up within seconds through its version subscription. No reboot. Warnings, e.g. a layout larger than the display's reported capacity, are shown after sending.

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

    Screenshots (desktop light/night, phone dark) go to a temp dir printed by the test.

## Not covered yet
- Multi-page editing, full-page widgets (wind rose slots), and gauge/bar/switch tile settings beyond what the firmware renders.
- Preview is an HTML approximation of the display (open question 7); SDL-rendered previews could come later.
- Tested in Chrome (desktop and emulated phone with touch) only; Safari/Firefox and real phones are unverified.
