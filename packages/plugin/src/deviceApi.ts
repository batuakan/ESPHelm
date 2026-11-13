import { createReadStream } from 'node:fs';
import { validateHello } from '@esphelm/schema';
import type { IRouter, Request, Response } from 'express';
import { authorizeDevice } from './auth.js';
import { ifNoneMatchHits } from './etag.js';
import { versionPath, type Service } from './service.js';
import { updateActive, type DeviceUpdate, type Store } from './store.js';

/** Prefix under /signalk/v1/api (mounted via the plugin's signalKApiRoutes). */
export const DEVICE_API_PREFIX = '/esphelm';

function requireStore(service: Service, res: Response): Store | undefined {
  const store = service.loaded;
  if (!store) res.status(503).json({ error: 'NOT_STARTED', message: 'plugin is not running' });
  return store;
}

/**
 * Device-facing API (read/write device token required, ADR-0003):
 *   POST /signalk/v1/api/esphelm/devices/hello
 *   GET  /signalk/v1/api/esphelm/devices/:id/layout   (ETag / If-None-Match -> 304)
 *   GET  /signalk/v1/api/esphelm/tiles/:chart/:z/:x/:y  (raw RGB565 chart tile, ADR-0012)
 *   POST /signalk/v1/api/esphelm/notifications/ack     { path } (silence an alarm, ADR-0014)
 *   GET  /signalk/v1/api/esphelm/devices/:id/firmware?request=  (the offered image, once; ADR-0036)
 *   POST /signalk/v1/api/esphelm/devices/:id/firmware/result    { request, error }
 */
export function registerDeviceApi(router: IRouter, service: Service): IRouter {
  router.post(`${DEVICE_API_PREFIX}/devices/hello`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const anyDevice = authorizeDevice(req, service.security);
    if (!anyDevice.ok) {
      res.status(anyDevice.status).json({ error: anyDevice.error, message: anyDevice.message });
      return;
    }
    const result = validateHello(req.body);
    if (!result.ok) {
      res.status(400).json({ error: 'INVALID_HELLO', errors: result.errors });
      return;
    }
    const auth = authorizeDevice(req, service.security, result.value.deviceId);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, message: auth.message });
      return;
    }
    const { device, created, updateSettled } = store.upsertHello(result.value, service.clock);
    if (created) service.notify(device);
    if (updateSettled) service.notifyFirmware(device);
    const served = service.servedLayout(device);
    res.json({
      state: device.state,
      versionPath: versionPath(device.id),
      layoutEtag: served?.etag ?? null,
      security: service.security,
    });
  });

  router.get(`${DEVICE_API_PREFIX}/devices/:id/layout`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const id = String(req.params.id);
    const auth = authorizeDevice(req, service.security, id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, message: auth.message });
      return;
    }
    const device = store.getDevice(id);
    if (!device) {
      res.status(404).json({ error: 'NOT_REGISTERED', message: 'send hello first' });
      return;
    }
    if (device.state !== 'adopted') {
      res.status(404).json({ error: 'NOT_ADOPTED', message: 'adopt the device in the editor' });
      return;
    }
    const served = service.servedLayout(device);
    if (!served) {
      res.status(404).json({ error: 'NO_LAYOUT', message: 'no layout assigned to this device' });
      return;
    }
    res.setHeader('ETag', served.etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (ifNoneMatchHits(req.header('If-None-Match'), served.etag)) {
      res.status(304).end();
      return;
    }
    res.status(200).type('application/json').send(served.bytes);
  });

  router.get(`${DEVICE_API_PREFIX}/tiles/:chart/:z/:x/:y`, async (req: Request, res: Response) => {
    const auth = authorizeDevice(req, service.security);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, message: auth.message });
      return;
    }
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map((v) =>
      /^\d{1,8}$/.test(String(v)) ? Number(v) : NaN,
    );
    const tile = await service.tiles.rgb565(
      String(req.params.chart),
      z!,
      x!,
      y!,
      req.header('Authorization'),
    );
    if (!tile.ok) {
      res.status(tile.status).json({ error: tile.error, message: tile.message });
      return;
    }
    res.setHeader('ETag', tile.etag);
    res.setHeader('Cache-Control', 'max-age=3600');
    if (ifNoneMatchHits(req.header('If-None-Match'), tile.etag)) {
      res.status(304).end();
      return;
    }
    res.status(200).type('application/octet-stream').send(tile.body);
  });

  router.post(`${DEVICE_API_PREFIX}/notifications/ack`, (req: Request, res: Response) => {
    if (!requireStore(service, res)) return;
    const auth = authorizeDevice(req, service.security);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, message: auth.message });
      return;
    }
    const path: unknown = (req.body as { path?: unknown } | undefined)?.path;
    const result = service.alarms.ack(typeof path === 'string' ? path : '');
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, message: result.message });
      return;
    }
    res.json({ path, state: result.state });
  });

  router.get(`${DEVICE_API_PREFIX}/devices/:id/firmware`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    const images = service.firmware;
    if (!store || !images) return;
    const id = String(req.params.id);
    const auth = authorizeDevice(req, service.security, id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, message: auth.message });
      return;
    }
    const device = store.getDevice(id);
    const update = device?.update;
    if (!device || !update || update.request !== String(req.query.request ?? '')) {
      res
        .status(404)
        .json({ error: 'NO_UPDATE', message: 'no such firmware update for this device' });
      return;
    }
    // Served once per request: a display that keeps restarting can't loop on one update.
    if (update.state !== 'requested') {
      res
        .status(409)
        .json({ error: 'ALREADY_SERVED', message: 'this update was downloaded already' });
      return;
    }
    const image = images.get(update.buildId);
    if (!image) {
      store.setUpdate(id, failed(update, 'the image was deleted', service.clock));
      res.status(410).json({ error: 'IMAGE_GONE', message: 'the image was deleted' });
      return;
    }
    const settle = (next: DeviceUpdate) => {
      // Only while this request is still the device's update in that state.
      const current = store.getDevice(id)?.update;
      if (current?.request === update.request && current.state === 'downloading') {
        store.setUpdate(id, next);
      }
    };
    const downloading: DeviceUpdate = {
      ...update,
      state: 'downloading',
      at: service.clock.toISOString(),
    };
    const updated = store.setUpdate(id, downloading);
    if (updated) service.notifyFirmware(updated); // no longer offered
    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(image.size));
    // no-transform: signalk-server's compression would gzip it and drop Content-Length, which
    // the display checks against the offer.
    res.setHeader('Cache-Control', 'no-store, no-transform');
    const stream = createReadStream(images.path(image.buildId));
    stream.on('error', () => {
      settle(failed(downloading, 'the image could not be read', service.clock));
      res.destroy();
    });
    res.on('close', () => {
      if (res.writableFinished) {
        settle({ ...downloading, state: 'installing', at: service.clock.toISOString() });
      } else {
        settle(failed(downloading, 'the download broke off', service.clock));
      }
    });
    stream.pipe(res);
  });

  router.post(`${DEVICE_API_PREFIX}/devices/:id/firmware/result`, (req: Request, res: Response) => {
    const store = requireStore(service, res);
    if (!store) return;
    const id = String(req.params.id);
    const auth = authorizeDevice(req, service.security, id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, message: auth.message });
      return;
    }
    const body = (req.body ?? {}) as { request?: unknown; error?: unknown };
    const update = store.getDevice(id)?.update;
    if (!update || typeof body.request !== 'string' || update.request !== body.request) {
      res
        .status(404)
        .json({ error: 'NO_UPDATE', message: 'no such firmware update for this device' });
      return;
    }
    if (!updateActive(update)) {
      res.json({ state: update.state });
      return;
    }
    // Shown in the editor: printable ASCII, bounded.
    const why =
      typeof body.error === 'string' && body.error.length > 0
        ? body.error.replace(/[^\x20-\x7e]/g, ' ').slice(0, 200)
        : 'the display reported a failure';
    const device = store.setUpdate(id, failed(update, why, service.clock));
    if (device) service.notifyFirmware(device);
    res.json({ state: 'failed' });
  });

  return router;
}

function failed(update: DeviceUpdate, error: string, now: Date): DeviceUpdate {
  return { ...update, state: 'failed', error, at: now.toISOString() };
}
