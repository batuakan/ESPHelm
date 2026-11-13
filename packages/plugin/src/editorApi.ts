import {
  LABEL_PATTERN,
  TILE_SLOTS,
  QUANTITIES,
  TILE_TYPES,
  UNITS,
  validateLayout,
} from '@esphelm/schema';
import { createHash, randomBytes } from 'node:crypto';
import type { IRouter, Request, Response } from 'express';
import { checkCompatibility, type Compatibility } from './compat.js';
import {
  compareVersions,
  MAX_IMAGE_BYTES,
  parseImage,
  parseManifest,
  type FirmwareImage,
  type FirmwareStore,
} from './firmware.js';
import type { Service } from './service.js';
import { updateActive, type DeviceRecord, type DeviceState, type Store } from './store.js';

/** Under /plugins/esphelm (registerWithRouter): admin-only when SignalK security is on. */
export const EDITOR_API_PREFIX = '/api';

const LABEL_RE = new RegExp(LABEL_PATTERN, 'u');

function requireStore(service: Service, res: Response): Store | undefined {
  const store = service.loaded;
  if (!store) res.status(503).json({ error: 'NOT_STARTED', message: 'plugin is not running' });
  return store;
}

/** The display can take this image: same board and tile set, firmware with updates. */
export function canTake(image: FirmwareImage, device: DeviceRecord): boolean {
  return (
    device.hello.capabilities.ota === true &&
    image.board === device.hello.board &&
    image.kind === (device.hello.display.kind ?? 'color')
  );
}

/** The newest image the display can take that is newer than what it runs, if any. */
function updateAvailable(images: FirmwareStore | undefined, device: DeviceRecord) {
  const best = images
    ?.list()
    .find(
      (i) =>
        canTake(i, device) &&
        i.buildId !== device.hello.fw.build &&
        compareVersions(i.version, device.hello.fw.version) > 0,
    );
  return best ? { buildId: best.buildId, version: best.version } : null;
}

function deviceView(service: Service, device: DeviceRecord) {
  return {
    ...device,
    servedEtag: service.servedLayout(device)?.etag ?? null,
    updateAvailable: updateAvailable(service.firmware, device),
  };
}

/** Request body as bytes, up to `limit` (signalk-server only parses JSON bodies). */
function readBody(req: Request, limit: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(over ? 'too-large' : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Editor API (used by the web editor, Phase 4):
 *   GET    /plugins/esphelm/api/widgets
 *   GET    /plugins/esphelm/api/paths
 *   GET    /plugins/esphelm/api/charts
 *   GET    /plugins/esphelm/api/layouts            GET|PUT|DELETE /plugins/esphelm/api/layouts/:id
 *   GET    /plugins/esphelm/api/devices            PUT|DELETE     /plugins/esphelm/api/devices/:id
 *   GET|POST /plugins/esphelm/api/firmware          DELETE /plugins/esphelm/api/firmware/:buildId
 *   POST   /plugins/esphelm/api/firmware/github     (only when pressed in the editor)
 *   POST|DELETE /plugins/esphelm/api/devices/:id/update   { buildId }  (ADR-0036)
 */
export function registerEditorApi(router: IRouter, service: Service): void {
  router.get(`${EDITOR_API_PREFIX}/widgets`, (_req: Request, res: Response) => {
    res.json({
      tiles: Object.keys(TILE_TYPES),
      tileSlots: TILE_SLOTS,
      units: UNITS,
      quantities: QUANTITIES,
    });
  });

  // Charts the boat's SignalK charts plugin offers, for chart pages (ADR-0012)
  router.get(`${EDITOR_API_PREFIX}/charts`, async (_req: Request, res: Response) => {
    res.json(await service.tiles.listCharts());
  });

  // SignalK paths for the editor's path picker
  router.get(`${EDITOR_API_PREFIX}/paths`, (_req: Request, res: Response) => {
    res.json(service.listPaths());
  });

  // Layouts

  router.get(`${EDITOR_API_PREFIX}/layouts`, (_req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    res.json(
      store.listLayouts().map(({ layout, bytes, etag }) => ({
        id: layout.id,
        name: layout.name ?? null,
        pages: layout.pages.length,
        bytes: bytes.length,
        etag,
        devices: store
          .listDevices()
          .filter((d) => d.layoutId === layout.id)
          .map((d) => d.id),
      })),
    );
  });

  router.get(`${EDITOR_API_PREFIX}/layouts/:id`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const entry = store.getLayout(String(req.params.id));
    if (!entry) {
      res.status(404).json({ error: 'UNKNOWN_LAYOUT' });
      return;
    }
    res.setHeader('ETag', entry.etag);
    res.json(entry.layout);
  });

  router.put(`${EDITOR_API_PREFIX}/layouts/:id`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const id = String(req.params.id);
    const result = validateLayout(req.body);
    if (!result.ok) {
      res.status(400).json({ error: 'INVALID_LAYOUT', errors: result.errors });
      return;
    }
    if (result.value.id !== id) {
      res.status(400).json({
        error: 'ID_MISMATCH',
        message: `body id "${result.value.id}" does not match URL id "${id}"`,
      });
      return;
    }
    // Check every device using this layout before saving anything.
    const users = store.listDevices().filter((d) => d.layoutId === id);
    const candidate = { ...(store.getLayout(id) ?? {}), ...previewEntry(result.value) };
    const checks = users.map((d) => ({ device: d.id, ...checkCompatibility(candidate, d) }));
    const blocked = checks.filter((c) => c.errors.length > 0);
    if (blocked.length > 0) {
      res.status(409).json({ error: 'INCOMPATIBLE', devices: blocked });
      return;
    }
    const before = store.getLayout(id)?.etag;
    const entry = store.saveLayout(result.value);
    if (entry.etag !== before) users.forEach((d) => service.notify(d));
    res.json({
      id,
      etag: entry.etag,
      bytes: entry.bytes.length,
      warnings: checks.flatMap((c) => c.warnings.map((w) => ({ device: c.device, ...w }))),
    });
  });

  router.delete(`${EDITOR_API_PREFIX}/layouts/:id`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const id = String(req.params.id);
    if (!store.getLayout(id)) {
      res.status(404).json({ error: 'UNKNOWN_LAYOUT' });
      return;
    }
    const users = store
      .listDevices()
      .filter((d) => d.layoutId === id)
      .map((d) => d.id);
    if (users.length > 0) {
      res.status(409).json({ error: 'LAYOUT_IN_USE', devices: users });
      return;
    }
    store.deleteLayout(id);
    res.status(204).end();
  });

  // Devices

  router.get(`${EDITOR_API_PREFIX}/devices`, (_req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    res.json(store.listDevices().map((d) => deviceView(service, d)));
  });

  router.put(`${EDITOR_API_PREFIX}/devices/:id`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const device = store.getDevice(String(req.params.id));
    if (!device) {
      res.status(404).json({ error: 'UNKNOWN_DEVICE' });
      return;
    }
    const parsed = parseDevicePatch(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: 'INVALID_DEVICE_UPDATE', message: parsed.error });
      return;
    }
    const patch = parsed.patch;
    let compat: Compatibility = { errors: [], warnings: [] };
    if (typeof patch.layoutId === 'string') {
      const entry = store.getLayout(patch.layoutId);
      if (!entry) {
        res.status(404).json({ error: 'UNKNOWN_LAYOUT' });
        return;
      }
      compat = checkCompatibility(entry, device);
      if (compat.errors.length > 0) {
        res
          .status(409)
          .json({ error: 'INCOMPATIBLE', devices: [{ device: device.id, ...compat }] });
        return;
      }
    }
    const before = service.servedLayout(device)?.etag ?? null;
    const updated = store.updateDevice(device.id, {
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...('name' in patch ? { name: patch.name ?? undefined } : {}),
      ...('layoutId' in patch ? { layoutId: patch.layoutId ?? undefined } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: 'UNKNOWN_DEVICE' });
      return;
    }
    if ((service.servedLayout(updated)?.etag ?? null) !== before) service.notify(updated);
    res.json({ device: deviceView(service, updated), warnings: compat.warnings });
  });

  router.delete(`${EDITOR_API_PREFIX}/devices/:id`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const device = store.getDevice(String(req.params.id));
    if (!device || !store.deleteDevice(device.id)) {
      res.status(404).json({ error: 'UNKNOWN_DEVICE' });
      return;
    }
    // Tell a still-connected device it has nothing to show any more.
    service.notify({ ...device, state: 'pending' });
    res.status(204).end();
  });

  // Firmware updates (ADR-0036)

  router.get(`${EDITOR_API_PREFIX}/firmware`, (_req: Request, res: Response) => {
    const store = requireStore(service, res);
    const images = service.firmware;
    if (!store || !images) return;
    const devices = store.listDevices();
    res.json(
      images.list().map((image) => ({
        ...image,
        devices: devices.filter((d) => canTake(image, d)).map((d) => d.id),
      })),
    );
  });

  router.post(`${EDITOR_API_PREFIX}/firmware`, async (req: Request, res: Response) => {
    const store = requireStore(service, res);
    const images = service.firmware;
    if (!store || !images) return;
    const body = await readBody(req, MAX_IMAGE_BYTES);
    if (body === 'too-large') {
      res.status(413).json({ error: 'TOO_LARGE', message: 'the image is larger than 64 MB' });
      return;
    }
    const parsed = parseImage(body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error, message: parsed.message });
      return;
    }
    const added = images.add(parsed.image, body, 'upload', service.clock, activeTargets(store));
    refreshDevices(service, store);
    res.status(added.created ? 201 : 200).json({ ...added.image, removed: added.removed });
  });

  router.delete(`${EDITOR_API_PREFIX}/firmware/:buildId`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    const images = service.firmware;
    if (!store || !images) return;
    const buildId = String(req.params.buildId);
    if (!images.get(buildId)) {
      res.status(404).json({ error: 'UNKNOWN_IMAGE' });
      return;
    }
    const users = store
      .listDevices()
      .filter((d) => updateActive(d.update) && d.update?.buildId === buildId)
      .map((d) => d.id);
    if (users.length > 0) {
      res.status(409).json({ error: 'IMAGE_IN_USE', devices: users });
      return;
    }
    images.delete(buildId);
    res.status(204).end();
  });

  // Fetch the latest release's images for the displays here. Only ever when pressed.
  router.post(`${EDITOR_API_PREFIX}/firmware/github`, async (_req: Request, res: Response) => {
    const store = requireStore(service, res);
    const images = service.firmware;
    if (!store || !images) return;
    const base = service.releasesUrl.endsWith('/')
      ? service.releasesUrl
      : `${service.releasesUrl}/`;
    let manifest;
    try {
      const r = await service.fetch(`${base}manifest.json`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      manifest = parseManifest(await r.json());
    } catch (e) {
      res.status(502).json({
        error: 'GITHUB_UNREACHABLE',
        message: `could not read the latest release (${(e as Error).message}); is there an internet connection? Uploading an image works offline`,
      });
      return;
    }
    if (!manifest) {
      res
        .status(502)
        .json({ error: 'BAD_MANIFEST', message: 'the release has no valid manifest.json' });
      return;
    }
    const devices = store.listDevices();
    const have = new Set(images.list().map((i) => i.sha256));
    const added: FirmwareImage[] = [];
    const skipped: string[] = [];
    const errors: { file: string; message: string }[] = [];
    for (const entry of manifest) {
      const wanted = devices.some(
        (d) =>
          d.hello.capabilities.ota === true &&
          d.hello.board === entry.board &&
          (d.hello.display.kind ?? 'color') === entry.kind,
      );
      if (!wanted || have.has(entry.sha256)) {
        skipped.push(entry.file);
        continue;
      }
      try {
        const r = await service.fetch(`${base}${entry.file}`, {
          signal: AbortSignal.timeout(120000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length !== entry.size) throw new Error('wrong size');
        if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          throw new Error('sha256 does not match the manifest');
        }
        const parsed = parseImage(bytes);
        if (!parsed.ok) throw new Error(parsed.message);
        const p = parsed.image;
        if (p.board !== entry.board || p.kind !== entry.kind || p.version !== entry.version) {
          throw new Error('the image does not match its manifest entry');
        }
        added.push(images.add(p, bytes, 'github', service.clock, activeTargets(store)).image);
      } catch (e) {
        errors.push({ file: entry.file, message: (e as Error).message });
      }
    }
    refreshDevices(service, store);
    res.json({ added, skipped, errors });
  });

  router.post(`${EDITOR_API_PREFIX}/devices/:id/update`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    const images = service.firmware;
    if (!store || !images) return;
    const device = store.getDevice(String(req.params.id));
    if (!device) {
      res.status(404).json({ error: 'UNKNOWN_DEVICE' });
      return;
    }
    const buildId: unknown = (req.body as { buildId?: unknown } | undefined)?.buildId;
    const image = typeof buildId === 'string' ? images.get(buildId) : undefined;
    if (!image) {
      res.status(404).json({ error: 'UNKNOWN_IMAGE' });
      return;
    }
    if (device.state !== 'adopted') {
      res.status(409).json({ error: 'NOT_ADOPTED', message: 'adopt the display first' });
      return;
    }
    if (device.hello.capabilities.ota !== true) {
      res.status(409).json({
        error: 'NO_OTA',
        message: 'this display has no firmware updates over the network; flash it over USB once',
      });
      return;
    }
    if (!canTake(image, device)) {
      res.status(409).json({
        error: 'WRONG_BOARD',
        message: `the image is for ${image.board} (${image.kind}); this display is ${device.hello.board}`,
      });
      return;
    }
    if (device.hello.fw.build === image.buildId) {
      res.status(409).json({ error: 'ALREADY_RUNNING', message: 'the display runs this build' });
      return;
    }
    const updated = store.setUpdate(device.id, {
      request: randomBytes(8).toString('hex'),
      buildId: image.buildId,
      version: image.version,
      state: 'requested',
      at: service.clock.toISOString(),
    });
    if (!updated) {
      res.status(404).json({ error: 'UNKNOWN_DEVICE' });
      return;
    }
    service.notifyFirmware(updated);
    res.status(202).json({ device: deviceView(service, updated) });
  });

  // Cancel a request not downloaded yet, or clear a finished one from the list.
  router.delete(`${EDITOR_API_PREFIX}/devices/:id/update`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const device = store.getDevice(String(req.params.id));
    if (!device) {
      res.status(404).json({ error: 'UNKNOWN_DEVICE' });
      return;
    }
    const state = device.update?.state;
    if (state === 'downloading' || state === 'installing') {
      res.status(409).json({
        error: 'UPDATE_RUNNING',
        message: 'the display is installing it; wait for it to restart',
      });
      return;
    }
    const updated = store.setUpdate(device.id, undefined);
    if (updated) service.notifyFirmware(updated);
    res.status(204).end();
  });
}

/** Images that updates in progress point at (never removed to make room). */
function activeTargets(store: Store): Set<string> {
  return new Set(
    store
      .listDevices()
      .filter((d) => updateActive(d.update))
      .map((d) => d.update!.buildId),
  );
}

/** A removed image may have been an offer: publish every device's offer again. */
function refreshDevices(service: Service, store: Store): void {
  for (const d of store.listDevices())
    if (d.update?.state === 'requested') service.notifyFirmware(d);
}

/** Byte size and ETag of a layout that is not saved yet, for compatibility checks. */
function previewEntry(layout: Parameters<typeof checkCompatibility>[0]['layout']) {
  const bytes = Buffer.from(JSON.stringify(layout), 'utf8');
  return { layout, bytes, etag: '' };
}

interface DevicePatch {
  state?: DeviceState;
  name?: string | null;
  layoutId?: string | null;
}

function parseDevicePatch(body: unknown): { patch: DevicePatch } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'body must be an object' };
  }
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !['state', 'name', 'layoutId'].includes(k));
  if (unknown.length > 0) return { error: `unknown fields: ${unknown.join(', ')}` };
  const patch: DevicePatch = {};
  if ('state' in b) {
    if (b.state !== 'pending' && b.state !== 'adopted')
      return { error: 'state must be "pending" or "adopted"' };
    patch.state = b.state;
  }
  if ('name' in b) {
    if (b.name !== null && (typeof b.name !== 'string' || !LABEL_RE.test(b.name))) {
      return { error: 'name must be ASCII text (or null to clear)' };
    }
    patch.name = b.name as string | null;
  }
  if ('layoutId' in b) {
    if (b.layoutId !== null && typeof b.layoutId !== 'string') {
      return { error: 'layoutId must be a layout id (or null to unassign)' };
    }
    patch.layoutId = b.layoutId as string | null;
  }
  return { patch };
}
