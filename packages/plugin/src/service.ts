import type { Path } from '@signalk/server-api';
import { securityMode, type PluginHost, type SecurityMode } from './host.js';
import { Store, type DeviceRecord, type StoredLayout } from './store.js';

export const PLUGIN_ID = 'esphelm';

/** SignalK path a device subscribes to; its value is the ETag of the device's current layout. */
export function versionPath(deviceId: string): string {
  return `plugins.${PLUGIN_ID}.${deviceId}.version`;
}

/**
 * Shared state of a running plugin: the store and the change notifier. Routers are registered
 * before start(), so they reach the store through here and answer 503 until it is loaded.
 */
export class Service {
  private store: Store | undefined;

  constructor(
    private readonly host: PluginHost,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    const store = new Store(this.host.getDataDirPath(), (msg) => {
      this.host.error(msg);
      this.host.setPluginError(msg);
    });
    store.load();
    this.store = store;
    // Publish every device's current version so a subscribing device gets it replayed.
    for (const device of store.listDevices()) this.notify(device);
    const mode = securityMode(this.host);
    this.host.setPluginStatus(
      `${store.listLayouts().length} layouts, ${store.listDevices().length} devices` +
        (mode === 'disabled'
          ? '. SignalK security is disabled: devices are not authenticated'
          : ''),
    );
  }

  stop(): void {
    this.store = undefined;
  }

  /** The loaded store, or undefined before start()/after stop(). */
  get loaded(): Store | undefined {
    return this.store;
  }

  get security(): SecurityMode {
    return securityMode(this.host);
  }

  get clock(): Date {
    return this.now();
  }

  /** The layout a device downloads: only adopted devices with an assigned, loaded layout. */
  servedLayout(device: DeviceRecord): StoredLayout | undefined {
    if (device.state !== 'adopted' || device.layoutId === undefined) return undefined;
    return this.store?.getLayout(device.layoutId);
  }

  /** Emit the device's current layout version (ETag, or null when nothing is served). */
  notify(device: DeviceRecord): void {
    this.host.handleMessage(PLUGIN_ID, {
      updates: [
        {
          values: [
            {
              path: versionPath(device.id) as Path,
              value: this.servedLayout(device)?.etag ?? null,
            },
          ],
        },
      ],
    });
  }
}
