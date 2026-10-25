/**
 * End-to-end test of the runtime firmware (SDL host build) against a real signalk-server with
 * the signalk-esphelm plugin:
 *   npm run build && npm run e2e:sdl            (UPDATE_GOLDEN=1 to regenerate golden images)
 * Needs: signalk-server (SIGNALK_SERVER=...), the ESPHome CLI (ESPHOME=..., default
 * ~/venv/bin/esphome), an X display for SDL, and Python with Pillow (PYTHON=..., default
 * ~/venv/bin/python). Uses throwaway directories; never touches ~/.signalk.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startSignalK,
  waitFor,
  type SignalKHarness,
} from '../../packages/plugin/scripts/sk-harness.js';
import { cacheRecord } from './cache_record.js';

const FIRMWARE = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(FIRMWARE, '..');
const GOLDEN = join(FIRMWARE, 'test/golden');
const FIXTURES = join(REPO, 'packages/schema/fixtures');
const ESPHOME = process.env.ESPHOME ?? join(homedir(), 'venv/bin/esphome');
const PYTHON = process.env.PYTHON ?? join(homedir(), 'venv/bin/python');
const PORT = Number(process.env.ESPHELM_E2E_PORT ?? 3993);
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const binary = (name: string) => join(FIRMWARE, `.esphome/build/${name}/.pioenvs/${name}/program`);
// ESPHomeSignalK's host build uses a fixed device id (utils.h).
const DEVICE_ID = '12345678-1234-1232-123456789012';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fixture = (rel: string) =>
  JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8')) as Record<string, unknown> & {
    pages: { tiles: Record<string, unknown>[] }[];
  };

class Firmware {
  private proc: ChildProcess | undefined;
  private out = '';
  constructor(
    private readonly work: string,
    private readonly program = binary('esphelm-sdl'),
  ) {}

  get workDir(): string {
    return this.work;
  }

  private runs = 0;

  start(): void {
    if (this.out) writeFileSync(join(this.work, `firmware-${this.runs}.log`), this.log());
    this.runs++;
    this.out = '';
    this.proc = spawn(this.program, [], { cwd: this.work, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout?.on('data', (d: Buffer) => (this.out += d.toString()));
    this.proc.stderr?.on('data', (d: Buffer) => (this.out += d.toString()));
  }

  log(): string {
    // Strip ANSI colour codes from the ESPHome logger.
    return this.out.replace(/\x1b\[[0-9;]*m/g, '');
  }

  count(re: RegExp): number {
    return (this.log().match(new RegExp(re.source, 'g')) ?? []).length;
  }

  async waitLog(re: RegExp, ms = 15000, atLeast = 1): Promise<boolean> {
    return waitFor(() => this.count(re) >= atLeast, ms);
  }

  async screenshot(name: string, outDir: string): Promise<void> {
    const bmp = join(outDir, `${name}.bmp`);
    writeFileSync(join(this.work, 'esphelm_shot_request'), bmp);
    const taken = await waitFor(() => existsSync(bmp), 5000);
    if (!taken) {
      check(`screenshot ${name}`, false, 'not taken');
      return;
    }
    await sleep(200);
    const args = ['-I', join(FIRMWARE, 'test/compare_images.py'), bmp, join(GOLDEN, `${name}.png`)];
    if (UPDATE) args.push('--update');
    let result: string;
    try {
      result = execFileSync(PYTHON, args, { encoding: 'utf8' }).trim();
    } catch (e) {
      result = String((e as { stdout?: string }).stdout ?? e).trim();
    }
    const status = (JSON.parse(result) as { status: string }).status;
    check(`screenshot ${name} matches golden`, status === 'match' || status === 'created', result);
  }

  saveLog(): void {
    writeFileSync(join(this.work, `firmware-${this.runs}.log`), this.log());
  }

  async stop(): Promise<void> {
    if (!this.proc || this.proc.exitCode !== null) return;
    writeFileSync(join(this.work, 'esphelm_exit_request'), '');
    const exited = await waitFor(() => this.proc?.exitCode !== null, 5000);
    if (!exited) this.proc.kill('SIGKILL');
  }
}

async function main(): Promise<void> {
  if (!process.env.DISPLAY) throw new Error('SDL needs an X display (DISPLAY is not set)');
  for (const config of ['firmware/esphelm_sdl.yaml', 'firmware/esphelm_sdl_720.yaml']) {
    console.log(`compiling ${config} for SignalK at 127.0.0.1:${PORT} ...`);
    execFileSync(
      ESPHOME,
      ['-s', 'signalk_host', '127.0.0.1', '-s', 'signalk_port', String(PORT), 'compile', config],
      { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'], timeout: 30 * 60 * 1000 },
    );
  }
  // Never let a test build talk to a real SignalK server (e.g. the default :3000): check that
  // the compiled code really uses the test port before starting any firmware.
  for (const name of ['esphelm-sdl', 'esphelm-sdl-720']) {
    const main = readFileSync(join(FIRMWARE, `.esphome/build/${name}/src/main.cpp`), 'utf8');
    if (!main.includes(`set_port(${PORT});`) || !main.includes('set_host("127.0.0.1");'))
      throw new Error(`${name} was not built for 127.0.0.1:${PORT}; refusing to run it`);
  }

  const work = mkdtempSync(join(tmpdir(), 'esphelm-fw-'));
  const shots = join(work, 'shots');
  mkdirSync(shots);
  let sk: SignalKHarness | undefined;
  const fw = new Firmware(work);
  const work720 = join(work, '720');
  mkdirSync(work720);
  const fw720 = new Firmware(work720, binary('esphelm-sdl-720'));
  try {
    sk = await startSignalK({
      port: PORT,
      putEcho: ['electrical.switches.bilgePump.state'],
      autopilotSim: true,
      chartSim: true,
    });
    console.log(`signalk-server ${sk.version} on ${sk.base}; firmware working dir ${work}\n`);
    const { json, admin } = sk;

    // 1. First boot: the firmware asks SignalK for access (read/write) and says so on screen.
    fw.start();
    const requested = await waitFor(
      () => fw.count(/Access request is pending approval/) > 0,
      20000,
    );
    const requests = await json('GET', '/skServer/security/access/requests', admin);
    const mine = (
      requests.body as unknown as { accessIdentifier: string; permissions: string }[]
    ).find((r) => r.accessIdentifier === DEVICE_ID);
    check(
      'firmware sends an access request asking for read/write',
      requested && mine?.permissions === 'readwrite',
      JSON.stringify(mine),
    );
    await sleep(1500);
    await fw.screenshot('01-waiting-for-approval', shots);

    // 2. Approve it: the firmware gets its token, says hello and waits for adoption.
    await sk.approve(DEVICE_ID, 'readwrite');
    check(
      'firmware registers as pending after approval',
      await fw.waitLog(/pending adoption/, 20000),
    );
    await sleep(700);
    await fw.screenshot('02-adopt-this-display', shots);

    // 3. Adopt and assign a layout: the version delta makes the firmware fetch and render it.
    const layout = fixture('valid/grid-2x2-values-480.json');
    await json('PUT', `/plugins/esphelm/api/layouts/${String(layout.id)}`, admin, layout);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, {
      state: 'adopted',
      layoutId: layout.id,
    });
    check(
      'firmware fetches and renders the assigned layout',
      await fw.waitLog(/Showing fetched layout "grid-480" \(1 pages/),
    );

    // 4. Live values (SI) arrive via the layout-derived subscription and are shown converted.
    const { ws } = await sk.stream(admin);
    const publish = (values: Record<string, number | boolean | string | object>) =>
      ws.send(
        JSON.stringify({
          context: 'vessels.self',
          updates: [{ values: Object.entries(values).map(([path, value]) => ({ path, value })) }],
        }),
      );
    await sleep(1000);
    publish({
      'navigation.speedOverGround': 5.0, // 9.7 kn
      'environment.wind.speedApparent': 7.2, // 14.0 kn
      'environment.wind.speedTrue': 6.0, // 11.7 kn
      'navigation.speedThroughWater': 4.8, // 9.3 kn
    });
    await sleep(1500);
    await fw.screenshot('03-live-values', shots);

    // 5. Edit the layout (drop STW, relabel, short staleAfter): the path set shrinks, so the
    //    firmware must resubscribe (unsubscribe-all + full subscribe) and keep its socket.
    const tiles = layout.pages[0]?.tiles ?? [];
    const edited = {
      ...layout,
      pages: [
        {
          ...layout.pages[0],
          tiles: [
            { ...tiles[0], label: 'Speed', staleAfter: 6, w: 2 },
            { ...tiles[1], x: 0, y: 1, staleAfter: 6 },
            { ...tiles[2], x: 1, y: 1, staleAfter: 6 },
          ],
        },
      ],
    };
    const saved = await json(
      'PUT',
      `/plugins/esphelm/api/layouts/${String(layout.id)}`,
      admin,
      edited,
    );
    check(
      'edited layout is accepted by the plugin',
      saved.status === 200,
      JSON.stringify(saved.body),
    );
    check(
      'firmware picks up the edit',
      await fw.waitLog(/Showing fetched layout "grid-480"/, 15000, 2),
    );
    // 3 tile paths plus the layout version path.
    check(
      'firmware resubscribes when paths are removed',
      await fw.waitLog(/Resubscribing to 4 paths/),
    );
    check(
      'the SignalK socket stays connected',
      fw.count(/Connected to SignalK stream/) === 1,
      `${fw.count(/Connected to SignalK stream/)} connects`,
    );
    await sleep(1500);
    await fw.screenshot('04-edited-layout', shots);

    // 6. A layout with several pages and every widget: a footer appears, only the visible page
    //    is built, and changing page resubscribes to that page's paths (the server replays the
    //    cached values, so the new page shows them at once).
    const multi = fixture('valid/multi-page-widgets-480.json');
    await json('PUT', `/plugins/esphelm/api/layouts/${String(multi.id)}`, admin, multi);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: multi.id });
    check(
      'firmware renders the multi-page layout',
      await fw.waitLog(/Showing fetched layout "multi-480" \(5 pages/),
    );
    publish({
      'navigation.speedOverGround': 3.2, // 6.2 kn
      'electrical.batteries.house.capacity.stateOfCharge': 0.82, // 82 %
      'electrical.batteries.house.voltage': 12.6,
      'environment.wind.angleApparent': -0.6, // 34 deg to port
      'environment.wind.speedApparent': 7.0, // 13.6 kn
      'environment.wind.speedTrue': 5.0, // 9.7 kn
      'environment.wind.directionTrue': 0.4,
      'navigation.headingTrue': 1.2, // 69 deg; true wind 46 deg to port
      'propulsion.main.revolutions': 40, // 2400 rpm
      'propulsion.main.oilPressure': 350000, // 3.5 bar
      'electrical.switches.bilgePump.state': false,
    });
    await sleep(1500);
    await fw.screenshot('05-multi-mixed', shots);

    const goTo = async (index: number, title: string) => {
      writeFileSync(join(fw.workDir, 'esphelm_page_request'), String(index));
      const shown = await fw.waitLog(new RegExp(`Page ${index + 1}/5 "${title}"`));
      check(`page hook shows page ${index + 1} (${title})`, shown);
      await sleep(1500);
    };
    await goTo(1, 'Wind');
    await fw.screenshot('06-multi-wind', shots);
    await goTo(2, 'Engine');
    await fw.screenshot('07-multi-engine', shots);

    // 7. Tapping the switch sends a PUT; the echo plugin answers with a delta and the switch
    //    follows the path's value.
    writeFileSync(join(fw.workDir, 'esphelm_tap_request'), 'bilge');
    check(
      'switch tap sends a PUT',
      await fw.waitLog(/Put request: .*electrical\.switches\.bilgePump\.state.*true/),
    );
    let switched = false;
    for (let i = 0; i < 20 && !switched; i++) {
      const got = await json(
        'GET',
        '/signalk/v1/api/vessels/self/electrical/switches/bilgePump/state',
        admin,
      );
      switched = got.body?.value === true;
      if (!switched) await sleep(250);
    }
    check('the server has the new switch value', switched);
    await sleep(1500);
    await fw.screenshot('08-switch-on', shots);

    // 8. Wind roses as tiles next to other tiles: a 2x2 rose (about 250 px: compact, two slots),
    //    a 1x1 rose (about 120 px: pointers only) and a 1x1 autopilot (status only), live.
    publish({
      'steering.autopilot.state': 'standby',
      'steering.autopilot.target': 3.0, // 172 deg
      'navigation.headingMagnetic': 3.05, // 175 deg
    });
    await goTo(3, 'Helm');
    await fw.screenshot('09-multi-helm', shots);

    // 8b. A chart page (ADR-0012): tiles of the charts stand-in through the plugin, the vessel
    //     in the middle, the anchor and its alarm radius. Then back to the multi-page layout.
    const charts = fixture('valid/chart-page.json');
    await json('PUT', `/plugins/esphelm/api/layouts/${String(charts.id)}`, admin, charts);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: charts.id });
    check(
      'firmware renders the chart layout',
      await fw.waitLog(/Showing fetched layout "chart" \(3 pages/),
    );
    publish({
      'navigation.position': { latitude: 60.15, longitude: 24.95 },
      'navigation.headingTrue': 0.8,
      'navigation.anchor.position': { latitude: 60.1506, longitude: 24.9488 },
      'navigation.anchor.maxRadius': 60,
      'notifications.navigation.anchor': { state: 'normal', message: 'Anchor watch' },
    });
    await sleep(6000); // 25 tiles, one at a time
    await fw.screenshot('16-chart', shots);
    // About 350 m north: the vessel moves into the next tile row and the grid recentres.
    publish({ 'navigation.position': { latitude: 60.1532, longitude: 24.95 } });
    await sleep(4000);
    await fw.screenshot('17-chart-moved', shots);
    writeFileSync(join(fw.workDir, 'esphelm_tap_request'), 'chart zoom_in');
    check('chart zooms in through its + button', await fw.waitLog(/Chart chart: zoom 16/));
    await sleep(6000);
    await fw.screenshot('18-chart-zoomed', shots);
    publish({
      'navigation.position': { latitude: 60.1508, longitude: 24.9497 },
      'notifications.navigation.anchor': { state: 'alarm', message: 'Anchor dragging' },
    });
    await sleep(4000);
    await fw.screenshot('19-chart-anchor-alarm', shots);
    // A chart the server doesn't have: placeholder tiles, the overlay still works.
    writeFileSync(join(fw.workDir, 'esphelm_page_request'), '1');
    check('chart page with an unknown chart shows', await fw.waitLog(/Page 2\/3 "Anchor"/));
    await sleep(2500);
    await fw.screenshot('20-chart-unknown', shots);
    check(
      'the plugin answered the unknown chart with 404 (no tiles drawn, no crash)',
      fw.count(/tile .* failed/) === 0,
    );
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: multi.id });
    check(
      'back to the multi-page layout',
      await fw.waitLog(/Showing fetched layout "multi-480" \(5 pages/, 15000, 2),
    );

    // 9. The autopilot (ADR-0011), against the autopilot stand-in in the harness.
    const pilot = (part: string) =>
      writeFileSync(join(fw.workDir, 'esphelm_tap_request'), `pilot-ap ${part}`);
    const stateNow = async () =>
      (await json('GET', '/signalk/v1/api/vessels/self/steering/autopilot/state', admin)).body
        ?.value;
    const targetNow = async () =>
      Number(
        (await json('GET', '/signalk/v1/api/vessels/self/steering/autopilot/target', admin)).body
          ?.value,
      );
    const waitState = async (want: string) => {
      for (let i = 0; i < 20; i++) {
        if ((await stateNow()) === want) return true;
        await sleep(250);
      }
      return false;
    };
    const puts = () => fw.count(/Autopilot pilot-ap: PUT /);
    await goTo(4, 'Pilot');
    await fw.screenshot('10-pilot-standby', shots);

    pilot('+10');
    check(
      'autopilot: course buttons do nothing in standby',
      (await fw.waitLog(/pilot-ap: \+10 ignored \(not engaged\)/)) && puts() === 0,
    );
    pilot('auto');
    check('autopilot: first tap on AUTO only arms it', await fw.waitLog(/pilot-ap: armed auto/));
    await sleep(600);
    check(
      'autopilot: no PUT before the confirming tap',
      puts() === 0 && (await stateNow()) === 'standby',
    );
    await fw.screenshot('11-pilot-armed', shots);
    pilot('auto');
    check(
      'autopilot: second tap engages AUTO',
      (await fw.waitLog(/pilot-ap: PUT steering\.autopilot\.state = auto/)) &&
        (await waitState('auto')),
    );
    await sleep(1200);
    await fw.screenshot('12-pilot-auto', shots);

    const before = await targetNow();
    pilot('+10');
    await fw.waitLog(/pilot-ap: PUT steering\.autopilot\.actions\.adjustHeading = \+10/);
    let after = before;
    for (let i = 0; i < 20 && Math.abs(after - before) < 0.1; i++) {
      await sleep(250);
      after = await targetNow();
    }
    check(
      'autopilot: +10 moves the target by 10 degrees',
      Math.abs(((after - before) * 180) / Math.PI - 10) < 0.01,
      `${before} -> ${after}`,
    );
    await sleep(1200);
    await fw.screenshot('13-pilot-adjusted', shots);

    pilot('wind');
    await fw.waitLog(/pilot-ap: armed wind/);
    check(
      'autopilot: an armed mode expires after 3 s without sending',
      (await fw.waitLog(/pilot-ap: arm expired \(wind\)/, 5000)) &&
        fw.count(/pilot-ap: PUT steering\.autopilot\.state = wind/) === 0,
    );
    pilot('standby');
    check(
      'autopilot: STANDBY is one tap',
      (await fw.waitLog(/pilot-ap: PUT steering\.autopilot\.state = standby/)) &&
        (await waitState('standby')),
    );

    // 10. Server gone: values and needles go stale, and the autopilot shows "offline" with
    //     every button disabled.
    await sk.stop();
    sk = undefined;
    await sleep(7500); // > staleAfter (6 s) since the last value
    await fw.screenshot('14-stale-offline', shots);
    pilot('standby');
    check(
      'autopilot: offline, even STANDBY is refused (nothing could be sent)',
      await fw.waitLog(/pilot-ap: standby ignored \(offline\)/),
    );

    // 10. Reboot without a server: the cached multi-page layout comes back on its first page.
    await fw.stop();
    fw.start();
    check(
      'reboot without server shows the cached multi-page layout',
      await fw.waitLog(/Showing cached layout "multi-480" \(5 pages/),
    );
    await sleep(1500);
    await fw.screenshot('15-offline-cached', shots);
    await fw.stop();

    // 11. The 720x720 build (P4-86 fonts), started offline from a seeded cache: a full-size rose
    //     with engine tiles, then a compact and a medium rose.
    const layout720 = readFileSync(join(FIXTURES, 'valid/rose-and-engine-720.json'), 'utf8');
    writeFileSync(join(work720, 'esphelm_cur.bin'), cacheRecord(layout720, '"seed-720"'));
    fw720.start();
    check(
      '720 build shows the seeded layout',
      await fw720.waitLog(/Showing cached layout "rose-engine-720" \(2 pages/),
    );
    await sleep(1500);
    await fw720.screenshot('720-01-helm', shots);
    writeFileSync(join(work720, 'esphelm_page_request'), '1');
    check('720 page hook', await fw720.waitLog(/Page 2\/2 "Small roses"/));
    await sleep(1500);
    await fw720.screenshot('720-02-small-roses', shots);
    await fw720.stop();

    // 12. The same 720 build with the Helm starter layout: a wind rose and the autopilot side by
    //     side (offline, so the autopilot buttons are disabled).
    const helm720 = readFileSync(join(REPO, 'packages/schema/templates/helm-720.json'), 'utf8');
    writeFileSync(join(work720, 'esphelm_cur.bin'), cacheRecord(helm720, '"seed-helm"'));
    fw720.start();
    check(
      '720 build shows the Helm template',
      await fw720.waitLog(/Showing cached layout "template-helm-720" \(1 pages/),
    );
    await sleep(1500);
    await fw720.screenshot('720-03-helm-autopilot', shots);
  } finally {
    await fw.stop();
    await fw720.stop();
    if (sk) await sk.stop();
    if (failures > 0) {
      fw.saveLog();
      fw720.saveLog();
      console.log(`\nkept ${work} (screenshots, firmware-*.log)`);
    } else {
      rmSync(work, { recursive: true, force: true });
    }
  }
  console.log(failures > 0 ? `\n${failures} check(s) failed` : '\nall checks passed');
  if (failures > 0) process.exitCode = 1;
}

await main();
