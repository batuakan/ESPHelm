/**
 * Real-browser test of the editor inside a real signalk-server (security on, sample NMEA data,
 * the built signalk-esphelm plugin + editor webapp):
 *   npm run build && npm run e2e:editor
 * Drives the installed Google Chrome headless through playwright-core (CHROME=... to pick a
 * binary). Screenshots go to a temp dir (printed). Never touches ~/.signalk.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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
  const sk = await startSignalK({ sampleData: true });
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
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'light theme' }).click();

    // Add a tile by clicking, pick a path, see a live converted value.
    await page
      .getByRole('region', { name: 'Tiles' })
      .getByRole('button', { name: /Value/ })
      .click();
    await page.getByLabel('Search SignalK paths').fill('speedOverGround');
    await page.getByRole('option', { name: /navigation\.speedOverGround/ }).click();
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

    const handle = page.getByTestId('tile-tile-1').getByLabel('Resize');
    const hb = await handle.boundingBox();
    const down = await cellCenter(page, 0, 1, 2, 2);
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(down.x, down.y, { steps: 12 });
      await page.mouse.up();
    }

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
    await shot(page, '04-desktop-night-wind-rose');

    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByRole('menuitem', { name: 'Grid page' }).click();
    await page.getByLabel('Page title').fill('Gauges');
    const library = page.getByRole('region', { name: 'Tiles' });
    await library.getByRole('button', { name: /Gauge/ }).click();
    await page.getByLabel('Search SignalK paths').fill('speedOverGround');
    await page.getByRole('option', { name: /navigation\.speedOverGround/ }).click();
    await page.getByLabel('Label').fill('SOG');
    await page.getByLabel('Maximum').fill('12');
    await page.getByRole('button', { name: 'Add zone' }).click();
    await page.getByLabel('Zone 1 state').selectOption('warn');
    await library.getByRole('button', { name: /Wind rose/ }).click();
    const hint = (await drawer.locator('.size-hint').textContent()) ?? '';
    check('one cell of a 2x2 grid on 720 still gets a full rose', /: full/.test(hint), hint);
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
        JSON.stringify(rose) ===
          JSON.stringify({ type: 'wind_rose', id: 'rose-1', x: 1, y: 0, w: 1, h: 1, slots: {} }),
      JSON.stringify(pages),
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
