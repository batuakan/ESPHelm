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

  start(env: Record<string, string> = {}): void {
    if (this.out) writeFileSync(join(this.work, `firmware-${this.runs}.log`), this.log());
    this.runs++;
    this.out = '';
    this.proc = spawn(this.program, [], {
      cwd: this.work,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
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

  /** Waits for the program to end by itself (e.g. the boot guard's test crash). */
  async waitExit(ms = 15000): Promise<boolean> {
    return waitFor(() => this.proc?.exitCode !== null || this.proc?.signalCode !== null, ms);
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
  const workBoot = join(work, 'boot');
  mkdirSync(workBoot);
  const fwBoot = new Firmware(workBoot);
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
    // 3 tile paths, the layout version path and notifications.* (the alarm banner).
    check(
      'firmware resubscribes when paths are removed',
      await fw.waitLog(/Resubscribing to 5 paths/),
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
    // The anchor alarm also raised the alarm banner (ADR-0014); clear it for the next steps.
    publish({ 'notifications.navigation.anchor': { state: 'normal', message: 'Anchor watch' } });
    check(
      'the anchor alarm clears the banner',
      await fw.waitLog(/notifications\.navigation\.anchor cleared/),
    );
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: multi.id });
    check(
      'back to the multi-page layout',
      await fw.waitLog(/Showing fetched layout "multi-480" \(5 pages/, 15000, 2),
    );

    // 8c. Boot guard (ADR-0013): a fetched layout that crashes the display while it is built
    //     (ESPHELM_TEST_CRASH_ON aborts at that tile) is skipped after the crash, refused when
    //     fetched again, and reported in the hello.
    await fw.stop();
    const crashEnv = { ESPHELM_TEST_CRASH_ON: 'crash-me' };
    fw.start(crashEnv);
    check(
      'boot guard: restarted on the cached layout',
      await fw.waitLog(/Showing cached layout "multi-480"/),
    );
    await fw.waitLog(/Sending hello/, 15000);
    const crashing = fixture('valid/grid-2x2-values-480.json');
    crashing.id = 'crashing';
    const victim = crashing.pages[0]?.tiles[0];
    if (victim) victim.id = 'crash-me';
    await json('PUT', '/plugins/esphelm/api/layouts/crashing', admin, crashing);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: 'crashing' });
    check(
      'boot guard: the new layout crashes the display while it is built',
      (await fw.waitExit(20000)) && fw.count(/crashing at tile crash-me/) === 1,
    );
    fw.start(crashEnv);
    check(
      'boot guard: after the crash the fetched layout is skipped, the cached one shown',
      (await fw.waitLog(/crashed the display \(1 attempt\); skipping it/)) &&
        (await fw.waitLog(/Showing cached layout "multi-480"/)),
    );
    check(
      'boot guard: the layout is refused when fetched again (no second crash)',
      (await fw.waitLog(/fetched layout .* skipped: it crashed the display before/, 20000)) &&
        fw.count(/crashing at tile/) === 0,
    );
    const devices = (await json('GET', '/plugins/esphelm/api/devices', admin)).body as unknown as {
      id: string;
      hello: { recovery?: { skippedLayoutEtag: string } };
    }[];
    check(
      'boot guard: the hello reports the skipped layout',
      !!devices.find((d) => d.id === DEVICE_ID)?.hello.recovery?.skippedLayoutEtag,
      JSON.stringify(devices.find((d) => d.id === DEVICE_ID)?.hello.recovery),
    );
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: multi.id });
    await fw.stop();
    fw.start();
    check(
      'boot guard: back to the multi-page layout',
      await fw.waitLog(/Showing cached layout "multi-480" \(5 pages/),
    );
    await sleep(1500);

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

    // 9b. Alarms (ADR-0014): notifications from any source show in a banner above the page,
    //     worst first; ACK silences them through the plugin and they shrink to a strip; an
    //     escalation shows the full banner again.
    const DEPTH = 'notifications.environment.depth.belowTransducer';
    const BATTERY = 'notifications.electrical.batteries.house.voltage';
    const banner = (part = '') =>
      writeFileSync(join(fw.workDir, 'esphelm_tap_request'), `@alarm ${part}`.trim());
    const notify = (path: string, state: string, message: string, method = ['visual', 'sound']) =>
      publish({ [path]: { state, method, message } });
    await goTo(0, 'Mixed');
    notify(BATTERY, 'warn', 'House battery low', ['visual']);
    notify(DEPTH, 'alarm', 'Shallow water: 2.1 m');
    check(
      'alarms: both notifications reach the display',
      (await fw.waitLog(/ALARM notifications\.environment\.depth\.belowTransducer/)) &&
        (await fw.waitLog(/WARN notifications\.electrical\.batteries\.house\.voltage/)),
    );
    await sleep(1000);
    await fw.screenshot('21-alarm-banner', shots);
    banner(); // show the next one (the battery warning)
    await sleep(800);
    await fw.screenshot('22-alarm-next', shots);
    banner(); // back to the depth alarm
    await sleep(500);
    banner('ack');
    check(
      'alarms: ACK goes to the plugin',
      await fw.waitLog(/Acknowledging notifications\.environment\.depth\.belowTransducer/),
    );
    const methodOf = async (path: string) =>
      (
        (await json('GET', `/signalk/v1/api/vessels/self/${path.replace(/\./g, '/')}`, admin))
          .body as { value?: { method?: string[] } } | undefined
      )?.value?.method;
    let silenced = false;
    for (let i = 0; i < 20 && !silenced; i++) {
      silenced = JSON.stringify(await methodOf(DEPTH)) === '["visual"]';
      if (!silenced) await sleep(250);
    }
    check('alarms: the plugin silenced the depth alarm', silenced);
    banner('ack'); // the battery warning is shown now
    check(
      'alarms: the second alarm is acknowledged too',
      await fw.waitLog(/Acknowledging notifications\.electrical\.batteries\.house\.voltage/),
    );
    const live = () =>
      publish({
        'navigation.speedOverGround': 3.2,
        'electrical.batteries.house.capacity.stateOfCharge': 0.82,
        'electrical.batteries.house.voltage': 12.6,
      });
    live();
    await sleep(1200);
    await fw.screenshot('23-alarm-acknowledged', shots);
    notify(DEPTH, 'emergency', 'Aground?');
    check(
      'alarms: an escalation shows the full banner again',
      await fw.waitLog(/EMERGENCY notifications\.environment\.depth\.belowTransducer/),
    );
    live();
    await sleep(1000);
    await fw.screenshot('24-alarm-escalated', shots);
    notify(DEPTH, 'normal', '', []);
    notify(BATTERY, 'normal', '', []);
    check(
      'alarms: back to normal, the banner goes away',
      (await fw.waitLog(/belowTransducer cleared/)) && (await fw.waitLog(/house\.voltage cleared/)),
    );

    // 9c. Display settings (ADR-0015): the start page, day/night by environment.sun, and the
    //     screen switching off without a touch (woken by an alarm and by a touch). The SDL
    //     build has no backlight, so brightness is only logged.
    const settings = fixture('valid/settings.json');
    settings.theme = 'day';
    settings.settings = {
      brightness: { day: 90, night: 12 },
      startPage: 'second',
      autoTheme: 'sun',
      screenTimeout: 10,
    };
    publish({ 'environment.sun': 'day' });
    await json('PUT', '/plugins/esphelm/api/layouts/settings', admin, settings);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: 'settings' });
    check(
      'settings: the layout opens on its start page',
      (await fw.waitLog(/Showing fetched layout "settings"/)) &&
        (await fw.waitLog(/Page 2\/2 "Second"/)),
    );
    publish({ 'navigation.speedThroughWater': 2.4 });
    notify(DEPTH, 'alarm', 'Shallow water: 2.1 m');
    await sleep(1500);
    await fw.screenshot('25-settings-day-alarm', shots);
    publish({ 'environment.sun': 'dusk' });
    check(
      'settings: dusk switches to the night theme',
      await fw.waitLog(/Sun: dusk, switching to the night theme/),
    );
    publish({ 'navigation.speedThroughWater': 2.4 });
    await sleep(1500);
    await fw.screenshot('26-settings-night-alarm', shots);
    check(
      'settings: night brightness is applied',
      fw.count(/Brightness 12 % \(no backlight configured\)/) >= 1,
    );
    notify(DEPTH, 'normal', '', []);
    check(
      'settings: the screen switches off after 10 s without a touch',
      await fw.waitLog(/Screen off after 10 s without a touch/, 20000),
    );
    await sleep(500);
    await fw.screenshot('27-settings-screen-off', shots);
    notify(DEPTH, 'alarm', 'Shallow water: 2.0 m');
    check('settings: an alarm switches the screen on', await fw.waitLog(/Screen on \(alarm\)/));
    notify(DEPTH, 'normal', '', []);
    check(
      'settings: off again without a touch',
      await fw.waitLog(/Screen off after 10 s without a touch/, 20000, 2),
    );
    writeFileSync(join(fw.workDir, 'esphelm_tap_request'), '@screen');
    check('settings: a touch switches it on', await fw.waitLog(/Screen on \(touch\)/));
    // Day/night chosen on the display (the footer title held down): kept while the sun stays
    // the same, handed back to autoTheme when it changes.
    writeFileSync(join(fw.workDir, 'esphelm_tap_request'), '@theme');
    check(
      'theme: holding the footer title switches night to day',
      (await fw.waitLog(/Theme switched on the display: day/)) &&
        (await fw.waitLog(/Brightness 90 % \(no backlight configured\)/)),
    );
    publish({ 'environment.sun': 'night' });
    await sleep(1500);
    check(
      'theme: the choice holds while the sun stays down',
      fw.count(/back to the automatic theme/) === 0 &&
        fw.count(/switching to the night theme/) === 1,
    );
    publish({ 'environment.sun': 'day' });
    check(
      'theme: sunrise hands it back to the automatic theme',
      await fw.waitLog(/Sun: day, back to the automatic theme/),
    );

    // 9d. Position tiles: the four text formats of one live position (two wide tiles, two
    //     single cells that fall back to a smaller font), then a value that isn't a position.
    const position = fixture('valid/position.json');
    await json('PUT', '/plugins/esphelm/api/layouts/position', admin, position);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: 'position' });
    check(
      'position: the layout with four position tiles renders',
      await fw.waitLog(/Showing fetched layout "position" \(1 pages/),
    );
    publish({ 'navigation.position': { latitude: -33.858131, longitude: 151.214512 } });
    await sleep(1500);
    await fw.screenshot('28-position-formats', shots);
    publish({ 'navigation.position': { latitude: 'here', longitude: 151.2 } });
    await sleep(1200);
    await fw.screenshot('29-position-not-a-position', shots);

    // 9e. Value tile colours (ADR-0016): six fixed colours, and colour by value (depth in its
    //     warn zone, house voltage in its alarm zone over the tile's own blue, engine temperature
    //     in a normal zone), by day and at night.
    const colors = fixture('valid/value-colors.json');
    await json('PUT', '/plugins/esphelm/api/layouts/value-colors', admin, colors);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, {
      layoutId: 'value-colors',
    });
    check(
      'colours: the value colour layout renders',
      await fw.waitLog(/Showing fetched layout "value-colors" \(1 pages/),
    );
    const colourValues = {
      'navigation.speedOverGround': 3.1, // 6.0 kn
      'environment.depth.belowTransducer': 2.6, // warn (3 or less)
      'electrical.batteries.house.voltage': 11.5, // alarm (11.8 or less), over the tile's blue
      'propulsion.p0.temperature': 353.15, // 80 °C, normal (0..95)
    };
    publish(colourValues);
    await sleep(1500);
    await fw.screenshot('30-value-colors-day', shots);
    await json('PUT', '/plugins/esphelm/api/layouts/value-colors', admin, {
      ...colors,
      theme: 'night',
    });
    check(
      'colours: the same layout at night',
      await fw.waitLog(/Showing fetched layout "value-colors" \(1 pages/, 15000, 2),
    );
    publish(colourValues);
    await sleep(1500);
    await fw.screenshot('31-value-colors-night', shots);

    // 9f. Text follows the tile size (ADR-0017): a full-width, a 2x2 and four single-cell value
    //     tiles; the RPM is wider than its sample ("88"), so it steps down a size.
    const sizes = fixture('valid/value-sizes.json');
    await json('PUT', '/plugins/esphelm/api/layouts/value-sizes', admin, sizes);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, {
      layoutId: 'value-sizes',
    });
    check(
      'sizes: the value sizes layout renders',
      await fw.waitLog(/Showing fetched layout "value-sizes" \(1 pages/),
    );
    publish({
      'navigation.speedOverGround': 3.1, // 6.0 kn
      'environment.depth.belowTransducer': 12.4,
      'propulsion.p0.revolutions': 40, // 2400 rpm
      'electrical.batteries.house.voltage': 12.75,
      'propulsion.p0.temperature': 353.15, // 80 °C
      'navigation.headingTrue': 4.2, // 241°
    });
    check(
      'sizes: a value wider than the sample steps down a font size',
      await fw.waitLog(/Value rpm: smaller font \(line \d+ px\) for "2400"/),
    );
    await sleep(1500);
    await fw.screenshot('32-value-sizes', shots);
    await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, { layoutId: multi.id });
    check(
      'settings: back to the multi-page layout (no settings: its first page, never off)',
      await fw.waitLog(/Showing fetched layout "multi-480"/, 15000, 1),
    );
    writeFileSync(join(fw.workDir, 'esphelm_page_request'), '4');
    await fw.waitLog(/Page 5\/5 "Pilot"/, 15000, 2);
    await sleep(1500);

    // 10. Server gone: values and needles go stale, and the autopilot shows "offline" with
    //     every button disabled.
    await sk.stop();
    sk = undefined;
    await sleep(16000); // > every staleAfter (6 s on tiles, the 15 s default on the autopilot)
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
    await fw720.stop();

    // 12b. The value sizes layout at 720 (P4-86 fonts, offline): the full-width tile gets the
    //      largest font.
    const sizes720 = readFileSync(join(FIXTURES, 'valid/value-sizes.json'), 'utf8');
    writeFileSync(join(work720, 'esphelm_cur.bin'), cacheRecord(sizes720, '"seed-sizes"'));
    fw720.start();
    check(
      '720 build shows the value sizes layout',
      await fw720.waitLog(/Showing cached layout "value-sizes" \(1 pages/),
    );
    await sleep(1500);
    await fw720.screenshot('720-04-value-sizes', shots);
    await fw720.stop();

    // 13. Boot guard, offline: a cached layout that crashes the display is tried twice, then the
    //     last known good one is shown, and it stays skipped after a normal restart.
    const good = readFileSync(join(FIXTURES, 'valid/minimal.json'), 'utf8');
    writeFileSync(
      join(workBoot, 'esphelm_cur.bin'),
      cacheRecord(JSON.stringify(crashing), '"bad"'),
    );
    writeFileSync(join(workBoot, 'esphelm_lkg.bin'), cacheRecord(good, '"good"'));
    fwBoot.start(crashEnv);
    check('boot guard: first boot crashes', await fwBoot.waitExit());
    fwBoot.start(crashEnv);
    check(
      'boot guard: second boot tries the layout once more and crashes',
      (await fwBoot.waitLog(/trying it once more/)) && (await fwBoot.waitExit()),
    );
    fwBoot.start(crashEnv);
    check(
      'boot guard: third boot skips it and shows the last known good layout',
      (await fwBoot.waitLog(/crashed the display \(2 attempts\); skipping it/)) &&
        (await fwBoot.waitLog(/Showing last known good layout/)) &&
        fwBoot.count(/crashing at tile/) === 0,
    );
    await fwBoot.stop();
    fwBoot.start();
    check(
      'boot guard: a normal restart keeps skipping it',
      (await fwBoot.waitLog(/cached layout "bad" skipped/)) &&
        (await fwBoot.waitLog(/Showing last known good layout/)),
    );
  } finally {
    await fw.stop();
    await fw720.stop();
    await fwBoot.stop();
    if (sk) await sk.stop();
    if (failures > 0) {
      fw.saveLog();
      fw720.saveLog();
      fwBoot.saveLog();
      console.log(`\nkept ${work} (screenshots, firmware-*.log)`);
    } else {
      rmSync(work, { recursive: true, force: true });
    }
  }
  console.log(failures > 0 ? `\n${failures} check(s) failed` : '\nall checks passed');
  if (failures > 0) process.exitCode = 1;
}

await main();
