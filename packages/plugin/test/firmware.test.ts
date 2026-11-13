import { createHash } from 'node:crypto';
import type { Hello } from '@esphelm/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareVersions, parseImage } from '../src/firmware.js';
import { ADMIN, device, fixture, lastFirmware, startHarness, type Harness } from './harness.js';

const p4 = fixture<Hello>('hello/valid/p4-ota.json');
const ID = p4.deviceId;
const RUNNING = p4.fw.build!;

/** A made-up ESP32 app image: header, app descriptor with its ELF sha256, and the marker. */
function espImage(
  opts: { version?: string; board?: string; kind?: string; elf?: string; marker?: boolean } = {},
) {
  const b = Buffer.alloc(8192, 0x11);
  b[0] = 0xe9;
  b.writeUInt32LE(0xabcd5432, 0x20);
  Buffer.from(opts.elf ?? 'ab'.repeat(32), 'hex').copy(b, 0x20 + 0x90);
  if (opts.marker !== false) {
    const m = `ESPHELM-IMAGE/1 fw=${opts.version ?? '0.5.0'} board=${opts.board ?? p4.board} kind=${opts.kind ?? 'color'}\0`;
    b.write(m, 4000, 'latin1');
  }
  return b;
}

function elfImage(board = 'sdl-480') {
  const b = Buffer.alloc(4096, 0);
  b.writeUInt32BE(0x7f454c46, 0);
  b.write(`ESPHELM-IMAGE/1 fw=0.5.0 board=${board} kind=color\0`, 2000, 'latin1');
  return b;
}

describe('parseImage', () => {
  it('reads an ESP32 app image', () => {
    const r = parseImage(espImage());
    expect(r).toMatchObject({
      ok: true,
      image: {
        buildId: 'ab'.repeat(32),
        version: '0.5.0',
        board: p4.board,
        kind: 'color',
        format: 'esp32',
      },
    });
  });

  it('takes the sha256 of a host program as its build id', () => {
    const bytes = elfImage();
    const r = parseImage(bytes);
    expect(r.ok && r.image.buildId).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(r.ok && r.image.format).toBe('elf');
  });

  it('refuses a factory image, unknown files and images without a marker', () => {
    const factory = espImage();
    factory.writeUInt32LE(0x50, 0x20);
    expect(parseImage(factory)).toMatchObject({ ok: false, error: 'FACTORY_IMAGE' });
    expect(parseImage(Buffer.alloc(4096, 1))).toMatchObject({ ok: false, error: 'UNKNOWN_FORMAT' });
    expect(parseImage(espImage({ marker: false }))).toMatchObject({
      ok: false,
      error: 'NO_MARKER',
    });
    expect(parseImage(Buffer.alloc(10))).toMatchObject({ ok: false, error: 'TOO_SMALL' });
  });

  it('refuses an image naming two boards', () => {
    const b = espImage();
    b.write('ESPHELM-IMAGE/1 fw=0.5.0 board=other kind=color\0', 6000, 'latin1');
    expect(parseImage(b)).toMatchObject({ ok: false, error: 'AMBIGUOUS_MARKER' });
  });
});

it('compares versions numerically', () => {
  expect(compareVersions('0.10.0', '0.9.1')).toBe(1);
  expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
  expect(compareVersions('0.4', '0.4.1')).toBe(-1);
});

describe('updates from the editor', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(() => h.close());

  const hello = (body: Hello = p4) =>
    h.call('POST', '/signalk/v1/api/esphelm/devices/hello', { as: device(ID), body });
  const upload = (bytes: Buffer) =>
    h.call('POST', '/plugins/esphelm/api/firmware', { as: ADMIN, raw: bytes });
  const request = (buildId: string) =>
    h.call('POST', `/plugins/esphelm/api/devices/${ID}/update`, { as: ADMIN, body: { buildId } });
  const download = (req: string) =>
    h.call('GET', `/signalk/v1/api/esphelm/devices/${ID}/firmware?request=${req}`, {
      as: device(ID),
    });
  const devices = async () =>
    (await (await h.call('GET', '/plugins/esphelm/api/devices', { as: ADMIN })).json()) as {
      id: string;
      update?: { state: string; error?: string; request: string };
      updateAvailable: { version: string } | null;
    }[];

  async function adopted() {
    await hello();
    await h.call('PUT', `/plugins/esphelm/api/devices/${ID}`, {
      as: ADMIN,
      body: { state: 'adopted' },
    });
  }

  it('uploads an image, lists the displays that can take it and offers an update', async () => {
    await adopted();
    const res = await upload(espImage());
    expect(res.status).toBe(201);
    expect((await upload(espImage())).status).toBe(200); // the same build again
    const list = (await (
      await h.call('GET', '/plugins/esphelm/api/firmware', { as: ADMIN })
    ).json()) as {
      devices: string[];
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.devices).toEqual([ID]);
    expect((await devices())[0]!.updateAvailable).toMatchObject({ version: '0.5.0' });
  });

  it('refuses an upload that is not ESPHelm firmware', async () => {
    const res = await upload(espImage({ marker: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'NO_MARKER' });
  });

  it('refuses an image for another board, and one the display already runs', async () => {
    await adopted();
    await upload(espImage({ board: 'other-board', elf: 'cd'.repeat(32) }));
    expect(await (await request('cd'.repeat(32))).json()).toMatchObject({ error: 'WRONG_BOARD' });
    await upload(espImage({ elf: RUNNING }));
    expect(await (await request(RUNNING)).json()).toMatchObject({ error: 'ALREADY_RUNNING' });
  });

  it('refuses a display without OTA or one not adopted', async () => {
    await hello();
    await upload(espImage());
    expect(await (await request('ab'.repeat(32))).json()).toMatchObject({ error: 'NOT_ADOPTED' });
    const noOta = { ...p4, capabilities: { ...p4.capabilities, ota: false } };
    await hello(noOta);
    await h.call('PUT', `/plugins/esphelm/api/devices/${ID}`, {
      as: ADMIN,
      body: { state: 'adopted' },
    });
    expect(await (await request('ab'.repeat(32))).json()).toMatchObject({ error: 'NO_OTA' });
  });

  it('serves a request once and is done when hello reports the new build', async () => {
    await adopted();
    const image = espImage();
    await upload(image);
    expect((await request('ab'.repeat(32))).status).toBe(202);
    const offer = lastFirmware(h.deltas, ID) as { request: string; size: number; md5: string };
    expect(offer).toMatchObject({
      version: '0.5.0',
      size: image.length,
      md5: createHash('md5').update(image).digest('hex'),
    });

    expect((await download('wrong')).status).toBe(404);
    const res = await download(offer.request);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(image)).toBe(true);
    expect(lastFirmware(h.deltas, ID)).toBeNull(); // no longer offered
    expect((await download(offer.request)).status).toBe(409);
    await new Promise((r) => setTimeout(r, 20));
    expect((await devices())[0]!.update?.state).toBe('installing');

    await hello({ ...p4, fw: { version: '0.5.0', build: 'ab'.repeat(32) } });
    const d = (await devices())[0]!;
    expect(d.update?.state).toBe('done');
    expect(d.updateAvailable).toBeNull();
  });

  it('fails when the display comes back on its old build', async () => {
    await adopted();
    await upload(espImage());
    await request('ab'.repeat(32));
    const offer = lastFirmware(h.deltas, ID) as { request: string };
    await (await download(offer.request)).arrayBuffer();
    await new Promise((r) => setTimeout(r, 20));
    await hello();
    expect((await devices())[0]!.update).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('old firmware'),
    });
  });

  it('keeps waiting through a hello before the download', async () => {
    await adopted();
    await upload(espImage());
    await request('ab'.repeat(32));
    await hello();
    expect((await devices())[0]!.update?.state).toBe('requested');
  });

  it('records the error the display reports', async () => {
    await adopted();
    await upload(espImage());
    await request('ab'.repeat(32));
    const offer = lastFirmware(h.deltas, ID) as { request: string };
    await (await download(offer.request)).arrayBuffer();
    const res = await h.call('POST', `/signalk/v1/api/esphelm/devices/${ID}/firmware/result`, {
      as: device(ID),
      body: { request: offer.request, error: 'the image is damaged (MD5 mismatch)' },
    });
    expect(await res.json()).toEqual({ state: 'failed' });
    expect((await devices())[0]!.update).toMatchObject({
      state: 'failed',
      error: 'the image is damaged (MD5 mismatch)',
    });
  });

  it('replays the offer after a restart and cancels it', async () => {
    await adopted();
    await upload(espImage());
    await request('ab'.repeat(32));
    h.deltas.length = 0;
    h.restart();
    expect(lastFirmware(h.deltas, ID)).toMatchObject({ version: '0.5.0' });
    expect(
      (await h.call('DELETE', `/plugins/esphelm/api/devices/${ID}/update`, { as: ADMIN })).status,
    ).toBe(204);
    expect(lastFirmware(h.deltas, ID)).toBeNull();
  });

  it('keeps two images per board, never the target of an update', async () => {
    await adopted();
    await upload(espImage({ version: '0.5.0', elf: '01'.repeat(32) }));
    await request('01'.repeat(32));
    await upload(espImage({ version: '0.6.0', elf: '02'.repeat(32) }));
    await upload(espImage({ version: '0.7.0', elf: '03'.repeat(32) }));
    const res = await upload(espImage({ version: '0.8.0', elf: '04'.repeat(32) }));
    expect(((await res.json()) as { removed: string[] }).removed).toEqual(['02'.repeat(32)]);
    const ids = (
      (await (await h.call('GET', '/plugins/esphelm/api/firmware', { as: ADMIN })).json()) as {
        buildId: string;
      }[]
    ).map((i) => i.buildId);
    expect(ids).toContain('01'.repeat(32));
    expect(ids).toContain('04'.repeat(32));
    expect(
      (await h.call('DELETE', `/plugins/esphelm/api/firmware/${'01'.repeat(32)}`, { as: ADMIN }))
        .status,
    ).toBe(409);
  });
});

describe('Check GitHub', () => {
  let h: Harness;
  afterEach(() => h.close());

  it('fetches the images of the displays here and checks them against the manifest', async () => {
    const image = espImage();
    const files: Record<string, Buffer | object> = {
      'manifest.json': {
        version: '0.5.0',
        images: [
          {
            board: p4.board,
            kind: 'color',
            version: '0.5.0',
            file: 'esphelm-p4.ota.bin',
            size: image.length,
            md5: createHash('md5').update(image).digest('hex'),
            sha256: createHash('sha256').update(image).digest('hex'),
          },
          {
            board: 'other',
            kind: 'color',
            version: '0.5.0',
            file: 'x.bin',
            size: 1,
            md5: '',
            sha256: '0'.repeat(64),
          },
        ],
      },
      'esphelm-p4.ota.bin': image,
    };
    const fetched: string[] = [];
    const fakeFetch = (async (url: string) => {
      const name = String(url).split('/').pop()!;
      fetched.push(name);
      const f = files[name];
      if (!f) return new Response('', { status: 404 });
      return Buffer.isBuffer(f) ? new Response(f) : Response.json(f);
    }) as typeof fetch;
    h = await startHarness({ releasesUrl: 'https://example.invalid/rel/', fetch: fakeFetch });
    await h.call('POST', '/signalk/v1/api/esphelm/devices/hello', { as: device(ID), body: p4 });
    const res = await h.call('POST', '/plugins/esphelm/api/firmware/github', { as: ADMIN });
    const body = (await res.json()) as {
      added: { buildId: string }[];
      skipped: string[];
      errors: unknown[];
    };
    expect(body.added.map((i) => i.buildId)).toEqual(['ab'.repeat(32)]);
    expect(body.skipped).toEqual(['x.bin']);
    expect(body.errors).toEqual([]);
    expect(fetched).toEqual(['manifest.json', 'esphelm-p4.ota.bin']);
  });

  it('says so when there is no internet', async () => {
    const offline = (async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com');
    }) as typeof fetch;
    h = await startHarness({ fetch: offline });
    const res = await h.call('POST', '/plugins/esphelm/api/firmware/github', { as: ADMIN });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'GITHUB_UNREACHABLE' });
  });
});
