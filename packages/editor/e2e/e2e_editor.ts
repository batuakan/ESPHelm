/**
 * Real-browser test of the editor inside a real signalk-server (security on, sample NMEA data,
 * the built signalk-esphelm plugin + editor webapp):
 *   npm run build && npm run e2e:editor
 * Drives the installed Google Chrome headless through playwright-core (CHROME=... to pick a
 * binary). Screenshots go to a temp dir (printed). Never touches ~/.signalk.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEMPLATES } from '@esphelm/schema';
import { chromium, type Page } from 'playwright-core';
import { PLUGIN_DIR, startSignalK, waitFor } from '../../plugin/scripts/sk-harness.js';

const FIXTURES = join(PLUGIN_DIR, '../schema/fixtures');
const DEVICE_ID = '0b0b0b0b-1111-2222-0ba2-0000ed170001';
const SHOTS = mkdtempSync(join(tmpdir(), 'esphelm-editor-shots-'));

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

/** Center of grid cell (x, y) in page coordinates. */
async function cellCenter(page: Page, x: number, y: number, cols: number, rows: number) {
  const box = await page.getByTestId('grid').boundingBox();
  if (!box) throw new Error('grid not visible');
  return { x: box.x + ((x + 0.5) * box.width) / cols, y: box.y + ((y + 0.5) * box.height) / rows };
}

async function main(): Promise<void> {
  if (!existsSync(join(PLUGIN_DIR, 'public/index.html')))
    throw new Error('run `npm run build` first');
  const sk = await startSignalK({ sampleData: true, chartSim: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
  });
  try {
    console.log(`signalk-server ${sk.version} on ${sk.base}; screenshots in ${SHOTS}\n`);
    const editorUrl = `${sk.base}/signalk-esphelm/`;

    // A display says hello (as the firmware would) and is pending.
    const deviceToken = await sk.deviceToken(DEVICE_ID, 'readwrite');
    const hello = {
      ...(JSON.parse(readFileSync(join(FIXTURES, 'hello/valid/p4.json'), 'utf8')) as object),
      deviceId: DEVICE_ID,
    };
    const helloRes = await sk.json(
      'POST',
      '/signalk/v1/api/esphelm/devices/hello',
      deviceToken,
      hello,
    );
    check(
      'display registers via hello',
      helloRes.status === 200 && helloRes.body.state === 'pending',
    );

    // Not logged in: the editor explains what to do.
    const anon = await browser.newPage();
    await anon.goto(editorUrl);
    const loginLink = anon.getByRole('link', { name: 'Log in' });
    const hinted = await loginLink.waitFor({ timeout: 10000 }).then(
      () => true,
      () => false,
    );
    check('without a login the editor shows a login hint', hinted);
    await shot(anon, '00-not-logged-in');
    await anon.close();

    // Logged in as admin (the SignalK login cookie).
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addCookies([{ name: 'JAUTHENTICATION', value: sk.admin, url: sk.base }]);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    await page.goto(editorUrl);
    await page
      .getByRole('region', { name: 'Displays' })
      .getByRole('button', { name: 'Adopt' })
      .click();
    await page.getByRole('status').filter({ hasText: 'adopted' }).waitFor();
    check('admin adopts the display', true);

    // Name the display; the plugin keeps it.
    const displays = page.getByRole('region', { name: 'Displays' });
    await displays.getByRole('button', { name: 'Rename' }).click();
    await displays.getByRole('textbox', { name: 'Display name' }).fill('Nav station');
    await displays.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('status').filter({ hasText: 'Renamed to Nav station' }).waitFor();
    const named = (await (
      await fetch(`${sk.base}/plugins/esphelm/api/devices`, {
        headers: { Authorization: `Bearer ${sk.admin}` },
      })
    ).json()) as { id: string; name?: string }[];
    check('the display is renamed', named.find((d) => d.id === DEVICE_ID)?.name === 'Nav station');
    check(
      'the display list shows the end of its id',
      await displays
        .getByText(`…${DEVICE_ID.replace(/[^0-9a-zA-Z]/g, '').slice(-4)}`, { exact: false })
        .isVisible(),
    );
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'light theme' }).click();

    // Add a tile by clicking, pick a path, see a live converted value.
    await page
      .getByRole('region', { name: 'Tiles' })
      .getByRole('button', { name: /Value/ })
      .click();
    await page.getByLabel('Search SignalK paths').fill('speedOverGround');
    await page.getByRole('option', { name: /^navigation\.speedOverGround/ }).click();
    check(
      'picking a speed path selects knots',
      (await page.getByLabel('Display unit').inputValue()) === 'kn',
    );
    await page.getByLabel('Label').fill('SOG');
    const tile1Value = page.getByTestId('tile-tile-1').locator('.tile-value');
    let live = false;
    for (let i = 0; i < 40 && !live; i++) {
      live = /^\d+\.\d$/.test((await tile1Value.textContent()) ?? '');
      if (!live) await page.waitForTimeout(250);
    }
    check(
      'tile shows a live value converted to knots',
      live,
      (await tile1Value.textContent()) ?? '',
    );
    // Colour (ADR-0016): blue, then a zone with no lower bound ("1000 kn or less") over it.
    const tileDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    await tileDrawer.getByLabel('Colour').selectOption('blue');
    const blue = /value-color-blue/.test((await tile1Value.getAttribute('class')) ?? '');
    await tileDrawer.getByRole('button', { name: 'Add zone' }).click();
    await tileDrawer.getByLabel('Zone 1 to').fill('1000');
    await tileDrawer.getByLabel('Zone 1 state').selectOption('warn');
    check(
      'value colour and an open-ended zone colour the preview',
      blue && /value-zone-warn/.test((await tile1Value.getAttribute('class')) ?? ''),
      (await tile1Value.getAttribute('class')) ?? '',
    );
    // Zones in the server's metadata (ADR-0020) replace the tile's own in the preview, and the
    // drawer lists them. The editor refreshes its paths every 15 s. The server also raises its
    // own notification for a value in such a zone, so path pickers list that path from here on.
    const sogMeta = '/signalk/v1/api/vessels/self/navigation/speedOverGround/meta';
    const putSogZones = async (zones: unknown[]) =>
      (await sk.json('PUT', sogMeta, sk.admin, { value: { units: 'm/s', zones } })).status;
    check(
      'the server takes zones for SOG',
      (await putSogZones([{ lower: 0, state: 'alarm' }])) === 202,
    );
    const serverZoneList = tileDrawer.getByRole('group', { name: 'Zones from the SignalK server' });
    check(
      'the drawer lists the zones from the server',
      await serverZoneList
        .waitFor({ timeout: 20000 })
        .then(() => true)
        .catch(() => false),
      (await serverZoneList.textContent().catch(() => '')) ?? '',
    );
    check(
      "the server's zones replace the tile's own in the preview",
      /value-zone-alarm/.test((await tile1Value.getAttribute('class')) ?? ''),
      (await tile1Value.getAttribute('class')) ?? '',
    );
    await putSogZones([]);
    check(
      "emptied on the server: the tile's own zone is back",
      await serverZoneList
        .waitFor({ state: 'detached', timeout: 20000 })
        .then(() => true)
        .catch(() => false),
    );
    check(
      "the tile's own zone colours the preview again",
      /value-zone-warn/.test((await tile1Value.getAttribute('class')) ?? ''),
      (await tile1Value.getAttribute('class')) ?? '',
    );

    // History (ADR-0018, ADR-0019): off until switched on; then the tile shows the "tap for
    // history" mark, the drawer counts what the layout records, and previews the display's
    // popup in its windows.
    const mark = page.getByTestId('tile-tile-1').locator('.tile-history-mark');
    const markBefore = await mark.count();
    await tileDrawer.getByLabel('Tap for history').check();
    const counted = (await tileDrawer.locator('.history-count').textContent()) ?? '';
    check(
      'history is off until switched on, then counted for the layout',
      markBefore === 0 && /^Recording 1 value in this layout: fits every display/.test(counted),
      counted,
    );
    await tileDrawer.getByRole('button', { name: 'Preview graph' }).click();
    const popup = page.getByRole('dialog', { name: 'History preview' });
    await popup.waitFor();
    await popup.getByRole('button', { name: '1 h' }).click();
    const oneHour = await popup.getByText('-60 m').isVisible();
    await shot(page, '03-history-preview');
    await popup.getByRole('button', { name: 'Close history' }).click();
    check(
      'a value tile has the history mark and previews its graph',
      (await mark.isVisible()) && oneHour && (await popup.count()) === 0,
    );

    // Add a second tile by dragging the library item onto cell (1,0); make tile-1 two rows tall.
    const libraryValue = page
      .getByRole('region', { name: 'Tiles' })
      .getByRole('button', { name: /Value/ });
    const from = await libraryValue.boundingBox();
    const to = await cellCenter(page, 1, 0, 2, 2);
    if (from) {
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    }
    check(
      'dragging from the library places a tile',
      await page.getByTestId('tile-tile-2').isVisible(),
    );
    await page.getByLabel('Search SignalK paths').fill('speedApparent');
    await page.getByRole('option', { name: /environment\.wind\.speedApparent/ }).click();
    await page.getByLabel('Label').fill('AWS');
    check(
      'a new value tile records nothing',
      (await page.getByTestId('tile-tile-2').locator('.tile-history-mark').count()) === 0 &&
        !(await page.getByLabel('Tap for history').isChecked()),
    );

    const handle = page.getByTestId('tile-tile-1').getByLabel('Resize');
    const hb = await handle.boundingBox();
    const down = await cellCenter(page, 0, 1, 2, 2);
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(down.x, down.y, { steps: 12 });
      await page.mouse.up();
    }

    // Value tiles show the text sizes the display picks for them (ADR-0017).
    const tile1 = page.getByTestId('tile-tile-1');
    const fontPx = async (selector: string) =>
      parseFloat(
        await tile1
          .locator(selector)
          .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).fontSize),
      );
    const text = {
      style: (await tile1.getAttribute('style')) ?? '',
      value: await fontPx('.tile-value'),
      caption: await fontPx('.tile-label'),
    };
    check(
      "a value tile previews the display's text size",
      /--tile-value-size: min\([\d.]+cqh, [\d.]+cqw\)/.test(text.style) &&
        text.value > 2 * text.caption,
      JSON.stringify(text),
    );

    // An invalid label is flagged and blocks Save & send.
    await page.getByTestId('tile-tile-2').click();
    await page.getByLabel('Label').fill('Wind ä');
    const save = page.getByRole('button', { name: 'Save & send' });
    await page.getByText(/tile-2: the label has characters/).waitFor();
    check('invalid label blocks Save & send', await save.isDisabled());
    await shot(page, '01-desktop-light-problem');
    await page.getByLabel('Label').fill('AWS');
    await page.getByText('No problems').waitFor();

    await page.getByRole('button', { name: 'night theme' }).click();
    await page.waitForTimeout(500);
    await shot(page, '02-desktop-night');

    // Save & send, then check what the display would download.
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).waitFor();
    check('Save & send reports success', true);
    const served = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const tiles =
      (served.body.pages as { tiles: Record<string, unknown>[] }[] | undefined)?.[0]?.tiles ?? [];
    check(
      'the display now gets the layout made in the editor',
      served.status === 200 &&
        JSON.stringify(tiles.map((t) => [t.id, t.x, t.y, t.w, t.h, t.path, t.unit, t.label])) ===
          JSON.stringify([
            ['tile-1', 0, 0, 1, 2, 'navigation.speedOverGround', 'kn', 'SOG'],
            ['tile-2', 1, 0, 1, 1, 'environment.wind.speedApparent', 'kn', 'AWS'],
          ]),
      JSON.stringify(tiles.map((t) => [t.id, t.x, t.y, t.w, t.h, t.label])),
    );
    const { ws, messages } = await sk.stream(deviceToken);
    const versionPath = `plugins.esphelm.${DEVICE_ID}.version`;
    ws.send(
      JSON.stringify({
        context: 'vessels.self',
        subscribe: [{ path: versionPath, policy: 'instant' }],
      }),
    );
    const etag = served.headers.get('etag');
    const gotVersion = await waitFor(
      () => JSON.stringify(messages).includes(JSON.stringify(etag).slice(1, -1)),
      5000,
    );
    check(
      'the display gets the colour and the open-ended zone',
      JSON.stringify([tiles[0]?.color, tiles[0]?.zones]) ===
        JSON.stringify(['blue', [{ to: 1000, state: 'warn' }]]),
      JSON.stringify([tiles[0]?.color, tiles[0]?.zones]),
    );
    check(
      'the display gets history on for the SOG tile only',
      tiles[0]?.history === true && tiles[1]?.history === undefined,
      JSON.stringify([tiles[0]?.history, tiles[1]?.history]),
    );
    check('the display is notified with the new version', gotVersion, String(etag));
    // Pages: a wind page from a template (a 1x1 grid with a rose tile, slots prefilled), a new
    // grid page with a gauge, a zone and a small rose tile next to it; then the wind page moves
    // to the front. Save & send delivers all three.
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Starter: Wind', exact: true }).click();
    await page.getByTestId('slot-wind-rose-center3').click();
    const drawer = page.getByRole('complementary', { name: 'Tile settings' });
    const center3 = drawer.getByTestId('slot-section-center3');
    await center3.getByRole('button', { name: /SignalK path:/ }).click();
    await center3.getByLabel('Search SignalK paths').fill('belowTransducer');
    await center3.getByRole('option', { name: /environment\.depth\.belowTransducer/ }).click();
    await center3.getByLabel('Label').fill('Depth');
    check(
      'a full-screen rose on the 720 display is drawn in full',
      /: full/.test((await drawer.locator('.size-hint').textContent()) ?? ''),
      (await drawer.locator('.size-hint').textContent()) ?? '',
    );
    let roseLive = false;
    for (let i = 0; i < 40 && !roseLive; i++) {
      roseLive =
        (await page.locator('.marker.apparent').count()) > 0 &&
        /^\d+\.\d$/.test(
          (await page.getByTestId('slot-wind-rose-center3').locator('.slot-value').textContent()) ??
            '',
        );
      if (!roseLive) await page.waitForTimeout(250);
    }
    check('wind rose tile shows the live apparent wind and slot values', roseLive);
    // The template records three of the rose's values; switch the depth corner off and the
    // heading on. All four corners hold values, so there's no free corner for the mark (as on
    // the display); the rose is still tappable. The preview has a button per recorded value.
    await drawer.getByTestId('slot-section-topLeft').locator('summary').click();
    await drawer.getByLabel('History of Top left corner').uncheck();
    await drawer.getByTestId('rose-history').locator('summary').click();
    const awaOn = await drawer.getByLabel('History of Apparent wind angle').isChecked();
    await drawer.getByLabel('History of Heading').check();
    const roseCount = (await drawer.locator('.history-count').textContent()) ?? '';
    const roseMarks = await page
      .getByTestId('rose-wind-rose')
      .locator('.tile-history-mark')
      .count();
    check(
      'the wind rose records the values switched on, counted with the rest',
      awaOn &&
        roseMarks === 0 &&
        /^Recording 4 values in this layout: fits every display/.test(roseCount),
      JSON.stringify({ awaOn, roseMarks, roseCount }),
    );
    await drawer.getByRole('button', { name: 'Preview graph' }).click();
    const rosePopup = page.getByRole('dialog', { name: 'History preview' });
    const valueButtons = await rosePopup
      .getByRole('group', { name: 'Recorded values' })
      .getByRole('button')
      .allTextContents();
    await rosePopup.getByRole('button', { name: 'HDG' }).click();
    const hdgShown = (await rosePopup.locator('.history-caption').textContent()) === 'HDG';
    await shot(page, '06-history-preview-rose');
    await rosePopup.getByRole('button', { name: 'Close history' }).click();
    check(
      'the rose preview has a button per recorded value',
      valueButtons.join('|') === 'Depth|AWA|HDG' && hdgShown,
      valueButtons.join('|'),
    );
    await shot(page, '04-desktop-night-wind-rose');

    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Grid page' }).click();
    await page.getByLabel('Page title').fill('Gauges');
    const library = page.getByRole('region', { name: 'Tiles' });
    await library.getByRole('button', { name: /Gauge/ }).click();
    await page.getByLabel('Search SignalK paths').fill('speedOverGround');
    await page.getByRole('option', { name: /^navigation\.speedOverGround/ }).click();
    await page.getByLabel('Label').fill('SOG');
    await page.getByLabel('Maximum').fill('12');
    await page.getByRole('button', { name: 'Add zone' }).click();
    await page.getByLabel('Zone 1 state').selectOption('warn');
    await library.getByRole('button', { name: /Wind rose/ }).click();
    const hint = (await drawer.locator('.size-hint').textContent()) ?? '';
    check('one cell of a 2x2 grid on 720 still gets a full rose', /: full/.test(hint), hint);
    // Recording its heading gives the rose the mark, at the same small size as on value tiles.
    await drawer.getByTestId('rose-history').locator('summary').click();
    await drawer.getByLabel('History of Heading').check();
    const roseMark = await page
      .getByTestId('rose-rose-1')
      .locator('.tile-history-mark')
      .boundingBox();
    check(
      'a wind rose that records shows the small history mark',
      roseMark !== null && roseMark.width <= 24 && roseMark.height <= 12,
      JSON.stringify(roseMark),
    );
    // Performance (ADR-0029): laylines at a fixed beat angle, drawn from the live true wind
    // direction (the sample data has none, so the test sends one) and heading.
    await drawer.getByLabel('Laylines').check();
    await drawer.getByLabel('Fixed beat angle').fill('40');
    const roseOne = page.getByTestId('rose-rose-1');
    const sendTrueWind = () =>
      ws.send(
        JSON.stringify({
          context: 'vessels.self',
          updates: [
            {
              values: [
                { path: 'environment.wind.directionTrue', value: 1.0 },
                { path: 'navigation.headingTrue', value: 0.3 },
              ],
            },
          ],
        }),
      );
    sendTrueWind();
    const windTimer = setInterval(sendTrueWind, 1000);
    let laylinesShown = false;
    for (let i = 0; i < 40 && !laylinesShown; i++) {
      laylinesShown = (await roseOne.locator('.layline').count()) === 2;
      if (!laylinesShown) await page.waitForTimeout(250);
    }
    clearInterval(windTimer);
    check(
      'the rose previews two laylines from the live true wind',
      laylinesShown && (await roseOne.locator('.marker.true').count()) === 1,
      String(await roseOne.locator('.layline').count()),
    );
    await page.getByText('No problems').waitFor();
    await shot(page, '05-desktop-night-gauge-and-rose');

    await page.getByRole('tab', { name: /Wind/ }).click();
    await page.getByRole('button', { name: 'Move page left' }).click();
    const tabs = await page.getByRole('tab').allTextContents();
    check('pages can be reordered', tabs.join('|') === 'Wind|Main|Gauges', tabs.join('|'));
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).waitFor();
    const served3 = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    type ServedPage = { title?: string; tiles: Record<string, unknown>[] };
    const pages = (served3.body.pages ?? []) as ServedPage[];
    const [gauge, rose] = pages[2]?.tiles ?? [];
    check(
      'the display gets the three pages in the edited order',
      JSON.stringify(pages.map((p) => [p.title, p.tiles.map((t) => t.type)])) ===
        JSON.stringify([
          ['Wind', ['wind_rose']],
          ['Main', ['value', 'value']],
          ['Gauges', ['gauge', 'wind_rose']],
        ]) &&
        JSON.stringify((pages[0]?.tiles[0]?.slots as Record<string, unknown>)?.center3) ===
          JSON.stringify({
            path: 'environment.depth.belowTransducer',
            unit: 'm',
            decimals: 1,
            label: 'Depth',
          }) &&
        JSON.stringify(gauge) ===
          JSON.stringify({
            type: 'gauge',
            id: 'tile-3',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            path: 'navigation.speedOverGround',
            min: 0,
            max: 12,
            unit: 'kn',
            label: 'SOG',
            zones: [{ from: 9.6, to: 12, state: 'warn' }],
          }) &&
        JSON.stringify({ ...rose, config: undefined }) ===
          JSON.stringify({
            type: 'wind_rose',
            id: 'rose-1',
            x: 1,
            y: 0,
            w: 1,
            h: 1,
            slots: {},
            history: ['heading'],
          }),
      JSON.stringify(pages),
    );
    check(
      'the display gets the laylines and the fixed beat angle',
      JSON.stringify(rose?.config) === JSON.stringify({ showLaylines: true, fixedBeat: 40 }),
      JSON.stringify(rose?.config),
    );
    check(
      "the display gets the wind rose's recorded values in their order",
      JSON.stringify(pages[0]?.tiles[0]?.history) ===
        JSON.stringify(['center3', 'apparentAngle', 'heading']),
      JSON.stringify(pages[0]?.tiles[0]?.history),
    );

    // Start over from the large-display template: listed first for this 720x720 display.
    await page.getByRole('button', { name: 'Templates' }).click();
    const first = await page
      .getByRole('menu', { name: 'Start from template' })
      .getByRole('menuitem')
      .first()
      .textContent();
    check(
      'large-display templates come first on a 720 display',
      /large display/.test(first ?? ''),
      first ?? '',
    );
    await page.getByRole('menuitem', { name: 'Sailing (large display)' }).click();
    await page.getByRole('button', { name: 'Replace' }).click();
    await page.getByText('No problems').waitFor();
    await page.waitForTimeout(1500); // live values
    await shot(page, '06-desktop-night-sailing-720');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).waitFor();
    const sailing = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    check(
      'the display gets the Sailing template as it is',
      JSON.stringify(sailing.body.pages) === JSON.stringify(TEMPLATES['sailing-720']?.pages),
    );

    // The Helm layout puts the autopilot next to the wind rose. Drop WIND from its modes,
    // check the size hint, send it.
    await page.getByRole('button', { name: 'Templates' }).click();
    await page.getByRole('menuitem', { name: 'Helm (large display)' }).click();
    await page.getByRole('button', { name: 'Replace' }).click();
    await page.getByTestId('tile-autopilot').click();
    const apDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    const apHint = (await apDrawer.locator('.size-hint').textContent()) ?? '';
    check(
      'the 2x2 autopilot on 720 gets its buttons',
      /course and mode buttons/.test(apHint),
      apHint,
    );
    await apDrawer.getByRole('checkbox', { name: 'WIND' }).uncheck();
    await page.getByText('No problems').waitFor();
    await page.waitForTimeout(1000);
    await shot(page, '07-desktop-night-helm-autopilot');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).waitFor();
    const helm = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const ap = ((helm.body.pages as ServedPage[] | undefined)?.[0]?.tiles ?? []).find(
      (t) => t.type === 'autopilot',
    );
    check(
      'the display gets the autopilot without WIND',
      JSON.stringify(ap) ===
        JSON.stringify({
          type: 'autopilot',
          id: 'autopilot',
          x: 2,
          y: 0,
          w: 2,
          h: 2,
          modes: ['auto', 'route'],
        }),
      JSON.stringify(ap),
    );

    // A chart page (a 1x1 grid with a chart tile, ADR-0030): the test chart from the charts
    // stand-in, previewed with its real tiles at the sample data's position. Then a second
    // column with a value beside the chart.
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Chart page', exact: true }).click();
    const chartDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    await chartDrawer.getByLabel('Chart').selectOption('test-chart');
    await chartDrawer.getByLabel('Zoom').fill('14');
    let chartTiles = 0;
    for (let i = 0; i < 40 && chartTiles === 0; i++) {
      chartTiles = await page.locator('[data-testid^="chart-"] image').count();
      if (chartTiles === 0) await page.waitForTimeout(250);
    }
    check(
      'the chart preview shows tiles around the live position',
      chartTiles > 0,
      `${chartTiles} tiles`,
    );
    await page.waitForTimeout(1500); // tile images load
    await shot(page, '07c-desktop-night-chart');
    await chartDrawer.getByRole('button', { name: 'Close settings' }).click();
    await page.getByLabel('Columns').fill('2');
    await page
      .getByRole('region', { name: 'Tiles' })
      .getByRole('button', { name: /^Value/ })
      .click();
    await page.getByLabel('Search SignalK paths').fill('speedOverGround');
    await page.getByRole('option', { name: /^navigation\.speedOverGround/ }).click();
    await page.waitForTimeout(1000);
    await shot(page, '07d-desktop-night-chart-beside-value');

    // An engine tile on a new page: its empty corners are hinted with a "+", as on a wind rose,
    // and one opens that corner in the drawer.
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Grid page', exact: true }).click();
    await page
      .getByRole('region', { name: 'Tiles' })
      .getByRole('button', { name: /^Engine/ })
      .click();
    const engineCorners = page.locator('[data-testid^="engine-"] button.rose-slot.corner');
    await engineCorners.first().waitFor();
    check(
      'an engine tile hints its four empty corners with a +',
      (await engineCorners.count()) === 4 &&
        (await engineCorners.allTextContents()).every((t) => t === '+'),
      String(await engineCorners.allTextContents()),
    );
    // The bottom-right one too, clear of the tile's resize handle.
    await page.getByTestId('slot-engine-1-bottomRight').click({ timeout: 5000 });
    const engineDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    check(
      "a corner's + opens that corner in the drawer",
      (await engineDrawer
        .locator('[data-testid="slot-section-bottomRight"]')
        .getAttribute('open')) !== null,
    );
    await shot(page, '07e-desktop-night-engine-corners');
    await page.getByText('No problems').waitFor();
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).waitFor();
    const withChart = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const chartPageServed = (withChart.body.pages as Record<string, unknown>[] | undefined)?.find(
      (p) => p.id === 'chart-1',
    );
    const [chartServed, besideServed] = (chartPageServed?.tiles ?? []) as Record<string, unknown>[];
    check(
      'the display gets the chart tile beside a value',
      JSON.stringify(chartPageServed?.grid) === JSON.stringify({ cols: 2, rows: 1 }) &&
        JSON.stringify(chartServed) ===
          JSON.stringify({
            type: 'chart',
            id: 'chart-1-map',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            chart: 'test-chart',
            zoom: 14,
          }) &&
        besideServed?.type === 'value' &&
        besideServed.x === 1 &&
        besideServed.path === 'navigation.speedOverGround',
      JSON.stringify(chartPageServed),
    );
    await page.getByRole('tab', { name: 'Helm' }).click();

    // The display theme is part of the layout (the editor's own theme is not).
    await page
      .getByRole('group', { name: 'Display theme' })
      .getByRole('button', { name: 'Day' })
      .click();
    await page.waitForTimeout(500);
    await shot(page, '07b-desktop-night-editor-day-display');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).waitFor();
    const dayLayout = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    check(
      'the display gets the day theme',
      dayLayout.body.theme === 'day',
      String(dayLayout.body.theme),
    );

    // Display settings (ADR-0015) travel with the layout too.
    await page.getByRole('button', { name: 'Display settings' }).click();
    const settingsDrawer = page.getByRole('complementary', { name: 'Display settings' });
    const startSelect = settingsDrawer.getByLabel('Start page');
    const helmId = await startSelect
      .locator('option')
      .filter({ hasText: /\. Helm$/ })
      .first()
      .getAttribute('value');
    await startSelect.selectOption(helmId ?? '');
    await settingsDrawer.getByLabel('Auto day/night').check();
    await settingsDrawer.getByLabel('Screen timeout').selectOption({ label: '5 min' });
    await settingsDrawer.getByLabel('Night brightness').fill('15');
    await page.waitForTimeout(500);
    await shot(page, '09-desktop-display-settings');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).last().waitFor();
    const withSettings = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    check(
      'the display gets its settings',
      JSON.stringify(withSettings.body.settings) ===
        JSON.stringify({
          startPage: helmId,
          autoTheme: 'sun',
          screenTimeout: 300,
          brightness: { night: 15 },
        }),
      JSON.stringify(withSettings.body.settings),
    );

    // A position tile on a new page, in degrees, minutes and seconds.
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Grid page' }).click();
    await page.getByRole('button', { name: /^Position/ }).click();
    const posDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    await posDrawer.getByLabel('Degrees, minutes and seconds').check();
    await page.waitForTimeout(1500); // the sample data's position arrives
    await shot(page, '10-desktop-position-tile');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).last().waitFor();
    const withPosition = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const positionTile = (
      withPosition.body.pages as { tiles?: { type: string; format?: string }[] }[]
    )
      .flatMap((p) => p.tiles ?? [])
      .find((t) => t.type === 'position');
    check(
      'the display gets the position tile in DMS',
      positionTile?.format === 'dms',
      JSON.stringify(positionTile),
    );
    const posText = await page
      .getByTestId(/^position-/)
      .first()
      .textContent();
    check(
      'the preview shows the live position in DMS',
      /\d+° \d\d' \d\d\.\d" [NS]/.test(posText ?? ''),
      String(posText),
    );

    // A graph tile (ADR-0021) next to it: the live SOG, its 1 h window, sent to the display.
    await page.getByRole('button', { name: /^Graph/ }).click();
    const graphDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    await graphDrawer.getByLabel('Search SignalK paths').fill('speedOverGround');
    await page.getByRole('option', { name: /^navigation\.speedOverGround/ }).click();
    await graphDrawer.getByLabel('Window').selectOption('1h');
    await page.waitForTimeout(1500); // live values
    const graphTile = page.getByTestId(/^tile-graph-/).first();
    const graphHint = (await graphDrawer.locator('.size-hint').textContent()) ?? '';
    check(
      'a graph tile previews its line and says what fits',
      (await graphTile.getByRole('img', { name: 'Graph' }).isVisible()) &&
        /^About \d+×\d+ px on this display: the line/.test(graphHint),
      graphHint,
    );
    await shot(page, '11-desktop-graph-tile');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).last().waitFor();
    const withGraph = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const servedGraph = (withGraph.body.pages as { tiles?: Record<string, unknown>[] }[])
      .flatMap((p) => p.tiles ?? [])
      .find((t) => t.type === 'graph');
    check(
      'the display gets the graph tile with its window',
      servedGraph?.path === 'navigation.speedOverGround' && servedGraph.window === '1h',
      JSON.stringify(servedGraph),
    );

    // A heading tape (ADR-0022) on a new page: the sample data's heading on the tape, COG only.
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Grid page' }).click();
    await page.getByRole('button', { name: /^Heading tape/ }).click();
    const tapeDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    await tapeDrawer.getByRole('checkbox', { name: 'Bearing to the next waypoint' }).uncheck();
    await tapeDrawer.getByRole('checkbox', { name: 'Autopilot target' }).uncheck();
    await page.waitForTimeout(1500); // live values
    const tapeText =
      (await page
        .getByTestId(/^tape-/)
        .first()
        .locator('.tape-number')
        .textContent()) ?? '';
    await shot(page, '12-desktop-heading-tape');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).last().waitFor();
    const withTape = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const servedTape = (withTape.body.pages as { tiles?: Record<string, unknown>[] }[])
      .flatMap((p) => p.tiles ?? [])
      .find((t) => t.type === 'heading_tape');
    check(
      'a heading tape previews the heading and the display gets it with COG only',
      /^(\d+°T|--)$/.test(tapeText) && JSON.stringify(servedTape?.markers) === '["cog"]',
      `${tapeText} ${JSON.stringify(servedTape)}`,
    );

    // A centre-zero gauge (ADR-0023) on a new page: plus/minus, sent to the display.
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Grid page' }).click();
    await page.getByRole('button', { name: /^Gauge/ }).click();
    const czDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    await czDrawer.getByLabel('Search SignalK paths').fill('speedOverGround');
    await page.getByRole('option', { name: /^navigation\.speedOverGround/ }).click();
    await czDrawer.getByLabel('Centre zero').check();
    await czDrawer.getByLabel('Sides').selectOption('plusMinus');
    await page.waitForTimeout(1500); // live values
    await shot(page, '13-desktop-center-zero');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).last().waitFor();
    const withCz = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const servedCz = (withCz.body.pages as { tiles?: Record<string, unknown>[] }[])
      .flatMap((p) => p.tiles ?? [])
      .find((t) => t.type === 'gauge' && t.centerZero === true);
    check(
      'a centre-zero gauge reaches the display with a symmetric range and plus/minus',
      servedCz?.sides === 'plusMinus' && Number(servedCz.min) < 0 && Number(servedCz.max) > 0,
      JSON.stringify(servedCz),
    );

    // A clock (ADR-0024) on a new page, Stockholm time and the clock screen saver.
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Grid page' }).click();
    await page.getByRole('button', { name: /^Clock/ }).click();
    const clockDrawer = page.getByRole('complementary', { name: 'Tile settings' });
    await clockDrawer.getByRole('checkbox', { name: '12-hour clock' }).check();
    const clockText =
      (await page
        .getByTestId(/^clock-/)
        .first()
        .textContent()) ?? '';
    await page.getByRole('button', { name: 'Display settings' }).click();
    const clockSettings = page.getByRole('complementary', { name: 'Display settings' });
    await clockSettings.getByLabel('Time zone').selectOption('Europe/Stockholm');
    await clockSettings.getByLabel('Screen timeout').selectOption('300');
    await clockSettings.getByLabel('Screen saver', { exact: true }).selectOption('both');
    await shot(page, '14-desktop-clock-settings');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Sent to' }).last().waitFor();
    const withClock = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    const servedClock = (withClock.body.pages as { tiles?: Record<string, unknown>[] }[])
      .flatMap((p) => p.tiles ?? [])
      .find((t) => t.type === 'clock');
    const servedSettings = withClock.body.settings as Record<string, unknown> | undefined;
    check(
      'a clock previews the time and the display gets it with the zone rule and the screen saver',
      /\d{1,2}:\d\d(AM|PM)/.test(clockText) &&
        servedClock?.hour12 === true &&
        JSON.stringify(servedSettings?.timeZone) ===
          '{"name":"Europe/Stockholm","posix":"<+01>-1<+02>,M3.5.0,M10.5.0/3"}' &&
        servedSettings?.screenSaver === 'both' &&
        servedSettings.screenTimeout === 300,
      `${clockText} ${JSON.stringify(servedClock)} ${JSON.stringify(servedSettings)}`,
    );

    // Sharing (ADR-0027): a second display, export, import with a remapped path, link, separate.
    const DEVICE_ID2 = '0b0b0b0b-1111-2222-0ba2-0000ed170002';
    const token2 = await sk.deviceToken(DEVICE_ID2, 'readwrite');
    await sk.json('POST', '/signalk/v1/api/esphelm/devices/hello', token2, {
      ...hello,
      deviceId: DEVICE_ID2,
    });
    await sk.json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID2}`, sk.admin, {
      state: 'adopted',
      name: 'Cockpit',
    });
    const helmLayout = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    await page.reload();
    await page.getByRole('button', { name: 'light theme' }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /^Export file/ }).click(),
    ]);
    const exported = join(SHOTS, download.suggestedFilename());
    await download.saveAs(exported);
    const exportedText = readFileSync(exported, 'utf8');
    check(
      'Export file downloads the layout',
      /^esphelm-.+\.json$/.test(download.suggestedFilename()) &&
        JSON.stringify(JSON.parse(exportedText)) === JSON.stringify(helmLayout.body),
      download.suggestedFilename(),
    );

    // Another boat's file: SOG is on a path this server doesn't have.
    const foreign = join(SHOTS, 'foreign.json');
    writeFileSync(
      foreign,
      exportedText.replaceAll('"navigation.speedOverGround"', '"electrical.batteries.e2e.voltage"'),
    );
    await page.getByRole('combobox', { name: 'Display', exact: true }).selectOption(DEVICE_ID2);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByLabel('Layout file').setInputFiles(foreign);
    await page
      .getByRole('dialog', { name: 'Import layout' })
      .getByRole('button', { name: 'Replace' })
      .click();
    const remap = page.getByRole('dialog', { name: 'Replace paths' });
    const row = remap.getByRole('listitem').filter({ hasText: 'electrical.batteries.e2e.voltage' });
    await row.getByRole('button', { name: /^Replace with: / }).click();
    await row.getByLabel('Search Replace with').fill('speedOverGround');
    await row.getByRole('option', { name: /^navigation\.speedOverGround/ }).click();
    await shot(page, '15-desktop-import-remap');
    await remap.getByRole('button', { name: /^Replace \d/ }).click();
    await page.getByRole('button', { name: 'Save & send' }).click();
    await page.getByRole('status').filter({ hasText: 'Sent to Cockpit' }).waitFor();
    const cockpitServed = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID2}/layout`,
      token2,
    );
    const cockpitText = JSON.stringify(cockpitServed.body);
    check(
      'an imported layout gets the display’s own id, with the missing path replaced',
      cockpitServed.status === 200 &&
        (cockpitServed.body.id as string).endsWith(DEVICE_ID2.replace(/[^a-z0-9_-]/g, '')) &&
        cockpitText.includes('"navigation.speedOverGround"') &&
        !cockpitText.includes('electrical.batteries.e2e.voltage'),
      `${String(cockpitServed.body.id)}`,
    );

    // Link the cockpit display to the helm's layout, then give it its own copy again.
    const helmName = (await sk.json('GET', '/plugins/esphelm/api/devices', sk.admin))
      .body as unknown as {
      id: string;
      name?: string;
      hello: { board?: string };
    }[];
    const helmDevice = helmName.find((d) => d.id === DEVICE_ID)!;
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page
      .getByRole('menuitem', { name: helmDevice.name ?? helmDevice.hello.board ?? DEVICE_ID })
      .click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    await page.getByText(/^Shared with /).waitFor();
    const devicesLinked = (await sk.json('GET', '/plugins/esphelm/api/devices', sk.admin))
      .body as unknown as { id: string; layoutId?: string }[];
    const ids = (list: { id: string; layoutId?: string }[]) =>
      [DEVICE_ID, DEVICE_ID2].map((id) => list.find((d) => d.id === id)?.layoutId);
    const [sharedId, linkedId] = ids(devicesLinked);
    check(
      'Link gives both displays one layout',
      !!sharedId && sharedId === linkedId,
      `${sharedId} ${linkedId}`,
    );
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await shot(page, '16-desktop-share-linked');
    await page.getByRole('menuitem', { name: /^Make a separate copy/ }).click();
    await page.getByRole('button', { name: 'Save & send' }).click();
    await page.getByRole('status').filter({ hasText: 'Sent to Cockpit' }).waitFor();
    const [helmAfter, ownAfter] = ids(
      (await sk.json('GET', '/plugins/esphelm/api/devices', sk.admin)).body as unknown as {
        id: string;
        layoutId?: string;
      }[],
    );
    check(
      'Make a separate copy gives the display its own layout again',
      helmAfter === sharedId && !!ownAfter && ownAfter !== helmAfter,
      `${helmAfter} ${ownAfter}`,
    );
    await page.getByRole('combobox', { name: 'Display', exact: true }).selectOption(DEVICE_ID);

    // Mounting rotation (ADR-0028): the helm display says hello as a 1280x800 panel that can turn.
    // The editor follows without a reload; Display settings > Mounted > 90 degrees previews it as
    // 800x1280 at once and Save & send puts the rotation in the layout. Linking a square display
    // to it warns.
    const frame = page.locator('.display-frame');
    const viewport = page.viewportSize();
    const sizeShown = (text: string) =>
      page
        .locator('.device-size')
        .getByText(text, { exact: true })
        .waitFor({ timeout: 15000 })
        .then(
          () => true,
          () => false,
        );
    await sk.json('POST', '/signalk/v1/api/esphelm/devices/hello', deviceToken, {
      ...hello,
      display: { width: 1280, height: 800, rotation: 0 },
    });
    check(
      'rotation: the editor follows a new display size without a reload',
      await sizeShown('1280×800'),
    );
    await page.waitForTimeout(300);
    const wide = await frame.boundingBox();
    check(
      'rotation: a landscape preview is wider than a square one',
      !!wide && !!viewport && wide.width > 600 && wide.y + wide.height <= viewport.height,
      JSON.stringify(wide),
    );
    await shot(page, '17-desktop-landscape');
    await page.getByRole('button', { name: 'Display settings' }).click();
    const mounting = page.getByRole('complementary', { name: 'Display settings' });
    await mounting.getByLabel('Rotation').selectOption('90');
    check(
      'rotation: Mounted turned 90 degrees previews the turned screen',
      await sizeShown('800×1280'),
    );
    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.waitForTimeout(300);
    const tall = await frame.boundingBox();
    check(
      'rotation: a portrait preview fits the window',
      !!tall && !!viewport && tall.y + tall.height <= viewport.height && tall.height > tall.width,
      JSON.stringify(tall),
    );
    await shot(page, '18-desktop-portrait');
    await page.getByRole('button', { name: 'Save & send' }).click();
    await page.getByRole('status').filter({ hasText: /^Sent/ }).waitFor();
    const turnedLayout = await sk.json(
      'GET',
      `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`,
      deviceToken,
    );
    check(
      'rotation: Save & send puts it in the layout',
      (turnedLayout.body.settings as { rotation?: number } | undefined)?.rotation === 90,
      JSON.stringify(turnedLayout.body.settings),
    );
    await page.getByRole('combobox', { name: 'Display', exact: true }).selectOption(DEVICE_ID2);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page
      .getByRole('menuitem', { name: helmDevice.name ?? helmDevice.hello.board ?? DEVICE_ID })
      .click();
    check(
      'rotation: linking displays of different shapes warns',
      await page
        .getByText(/Its screen is landscape \(1280×800\)/)
        .waitFor({ timeout: 5000 })
        .then(
          () => true,
          () => false,
        ),
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('Escape');
    // Back as it was for the rest: not turned, the display's own size.
    await page.getByRole('combobox', { name: 'Display', exact: true }).selectOption(DEVICE_ID);
    await page.getByRole('button', { name: 'Display settings' }).click();
    await mounting.getByLabel('Rotation').selectOption('0');
    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.getByRole('button', { name: 'Save & send' }).click();
    await page.getByRole('status').filter({ hasText: /^Sent/ }).waitFor();
    await sk.json('POST', '/signalk/v1/api/esphelm/devices/hello', deviceToken, hello);
    await sizeShown('720×720');

    // Firmware updates (ADR-0036): the display reports updates; an image is uploaded in the
    // dialog and installed, and the display is offered it.
    await sk.json('POST', '/signalk/v1/api/esphelm/devices/hello', deviceToken, {
      ...hello,
      fw: { version: '0.4.0', build: 'aa'.repeat(32) },
      capabilities: { ...(hello as unknown as { capabilities: object }).capabilities, ota: true },
    });
    const image = Buffer.alloc(64 * 1024, 0x5a);
    image[0] = 0xe9;
    image.writeUInt32LE(0xabcd5432, 0x20);
    Buffer.from('bb'.repeat(32), 'hex').copy(image, 0x20 + 0x90);
    image.write(
      `ESPHELM-IMAGE/1 fw=0.5.0 board=${(hello as unknown as { board: string }).board} kind=color\0`,
      4096,
      'latin1',
    );
    await page.getByRole('button', { name: 'Firmware', exact: true }).click();
    const fwDialog = page.getByRole('dialog', { name: 'Firmware' });
    await fwDialog.getByLabel('Firmware image').setInputFiles({
      name: 'esphelm-p4-0.5.0.ota.bin',
      mimeType: 'application/octet-stream',
      buffer: image,
    });
    check(
      'firmware: an uploaded image is read and listed',
      await fwDialog
        .getByText(/Added 0\.5\.0 for/)
        .waitFor({ timeout: 10000 })
        .then(
          () => true,
          () => false,
        ),
    );
    await shot(page, '19-desktop-firmware');
    await fwDialog.getByRole('button', { name: 'Install' }).click();
    await fwDialog.getByRole('button', { name: 'Update', exact: true }).click();
    await fwDialog.getByText(/is updating to 0\.5\.0/).waitFor({ timeout: 10000 });
    const fwDevices = await sk.json('GET', '/plugins/esphelm/api/devices', sk.admin);
    const fwDevice = (
      fwDevices.body as unknown as { id: string; update?: { state: string; version: string } }[]
    ).find((d) => d.id === DEVICE_ID);
    check(
      'firmware: Install asks the display to update',
      fwDevice?.update?.state === 'requested' && fwDevice.update.version === '0.5.0',
      JSON.stringify(fwDevice?.update),
    );
    await fwDialog.getByRole('button', { name: 'Close' }).click();
    check(
      'firmware: the display list shows the update waiting',
      await page
        .getByText('Update to 0.5.0 waits for the display')
        .waitFor({ timeout: 10000 })
        .then(
          () => true,
          () => false,
        ),
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await sk.json('POST', '/signalk/v1/api/esphelm/devices/hello', deviceToken, hello);

    check(
      'no errors in the browser console',
      consoleErrors.length === 0,
      consoleErrors.join(' | '),
    );

    // Phone size with touch, drawer as a bottom sheet.
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await phone.addCookies([{ name: 'JAUTHENTICATION', value: sk.admin, url: sk.base }]);
    const mobile = await phone.newPage();
    await mobile.goto(editorUrl);
    await mobile.getByTestId('tile-sog').waitFor();
    await mobile.getByRole('button', { name: 'dark theme' }).click();
    await mobile.getByTestId('tile-sog').tap();
    await mobile.getByRole('complementary', { name: 'Tile settings' }).waitFor();
    await mobile.waitForTimeout(500);
    await shot(mobile, '03-phone-dark-drawer');
    check('phone layout opens the tile drawer', true);
    await mobile.getByRole('button', { name: 'Close settings' }).tap();
    await mobile.getByTestId('slot-rose-center1').tap();
    const open = await mobile
      .getByRole('complementary', { name: 'Tile settings' })
      .getByTestId('slot-section-center1')
      .evaluate((el) => el.hasAttribute('open'));
    await mobile.waitForTimeout(500);
    await shot(mobile, '08-phone-dark-rose-slot');
    check('phone: tapping a rose slot opens it in the tile drawer', open);
    await phone.close();
  } finally {
    await browser.close();
    await sk.stop();
  }
  console.log(failures > 0 ? `\n${failures} check(s) failed` : '\nall checks passed');
  if (failures > 0) process.exitCode = 1;
}

await main();
