import { validateHello } from '@esphelm/schema';
import type { IRouter, Request, Response } from 'express';
import { authorizeDevice } from './auth.js';
import { ifNoneMatchHits } from './etag.js';
import { versionPath, type Service } from './service.js';
import type { Store } from './store.js';

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
    const { device, created } = store.upsertHello(result.value, service.clock);
    if (created) service.notify(device);
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

  return router;
}
