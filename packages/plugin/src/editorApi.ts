import {
  LABEL_PATTERN,
  TILE_SLOTS,
  QUANTITIES,
  TILE_TYPES,
  UNITS,
  validateLayout,
} from '@esphelm/schema';
import type { IRouter, Request, Response } from 'express';
import { checkCompatibility, type Compatibility } from './compat.js';
import type { Service } from './service.js';
import type { DeviceRecord, DeviceState, Store } from './store.js';

/** Under /plugins/esphelm (registerWithRouter): admin-only when SignalK security is on. */
export const EDITOR_API_PREFIX = '/api';

const LABEL_RE = new RegExp(LABEL_PATTERN, 'u');

function requireStore(service: Service, res: Response): Store | undefined {
  const store = service.loaded;
  if (!store) res.status(503).json({ error: 'NOT_STARTED', message: 'plugin is not running' });
  return store;
}

function deviceView(service: Service, device: DeviceRecord) {
  return { ...device, servedEtag: service.servedLayout(device)?.etag ?? null };
}

/**
 * Editor API (used by the web editor, Phase 4):
 *   GET    /plugins/esphelm/api/widgets
 *   GET    /plugins/esphelm/api/paths
 *   GET    /plugins/esphelm/api/charts
 *   GET    /plugins/esphelm/api/layouts            GET|PUT|DELETE /plugins/esphelm/api/layouts/:id
 *   GET    /plugins/esphelm/api/devices            PUT|DELETE     /plugins/esphelm/api/devices/:id
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
