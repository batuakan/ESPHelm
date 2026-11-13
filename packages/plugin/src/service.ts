import type { Path } from '@signalk/server-api';
import { AlarmAcks } from './alarms.js';
import { FirmwareStore, GITHUB_RELEASES } from './firmware.js';
import { httpPort, securityMode, type PluginHost, type SecurityMode } from './host.js';
import { Store, type DeviceRecord, type StoredLayout } from './store.js';
import { resourcesChartSource, TileService, type ChartSource } from './tiles.js';

export const PLUGIN_ID = 'esphelm';

export interface PathInfo {
  path: string;
  /** SignalK meta.units (SI), e.g. "m/s"; null if the server has no metadata. */
  units: string | null;
  description: string | null;
  /** SignalK meta.zones as the server has them (SI), for the editor (ADR-0020). */
  zones: unknown;
  value: unknown;
  timestamp: string | null;
}

/** SignalK path a device subscribes to; its value is the ETag of the device's current layout. */
export function versionPath(deviceId: string): string {
  return `plugins.${PLUGIN_ID}.${deviceId}.version`;
}

/**
 * SignalK path with the firmware update offered to a device (ADR-0036):
 * {request, version, size, md5}, or null when there is nothing to do.
 */
export function firmwarePath(deviceId: string): string {
  return `plugins.${PLUGIN_ID}.${deviceId}.firmware`;
}

export interface FirmwareOffer {
  request: string;
  version: string;
  size: number;
  md5: string;
}

export interface ServiceOptions {
  now?: () => Date;
  charts?: ChartSource;
  /** Where Check GitHub looks (tests point it elsewhere). */
  releasesUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Shared state of a running plugin: the store and the change notifier. Routers are registered
 * before start(), so they reach the store through here and answer 503 until it is loaded.
 */
export class Service {
  private store: Store | undefined;
  private images: FirmwareStore | undefined;
  private readonly now: () => Date;
  readonly releasesUrl: string;
  readonly fetch: typeof fetch;
  /** RGB565 chart tiles for displays (ADR-0012). */
  readonly tiles: TileService;
  /** Alarm acknowledgements from displays (ADR-0014). */
  readonly alarms: AlarmAcks;
  private filtering = false;

  constructor(
    private readonly host: PluginHost,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.releasesUrl =
      options.releasesUrl ?? process.env.ESPHELM_FIRMWARE_RELEASES ?? GITHUB_RELEASES;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.tiles = new TileService(
      options.charts ?? resourcesChartSource(host.resourcesApi, () => httpPort(host)),
    );
    this.alarms = new AlarmAcks(host, PLUGIN_ID);
  }

  start(): void {
    const store = new Store(
      this.host.getDataDirPath(),
      (msg) => {
        this.host.error(msg);
        this.host.setPluginError(msg);
      },
      (msg) => this.host.debug(msg),
    );
    store.load();
    this.store = store;
    const images = new FirmwareStore(this.host.getDataDirPath(), (msg) => {
      this.host.error(msg);
      this.host.setPluginError(msg);
    });
    images.load();
    this.images = images;
    // signalk-server drops a plugin's delta input handlers when it stops; register once anyway.
    if (!this.filtering && this.host.registerDeltaInputHandler) {
      this.host.registerDeltaInputHandler((delta, next) =>
        next(this.alarms.filter(delta, this.host.selfContext)),
      );
      this.filtering = true;
    }
    // Publish every device's current version so a subscribing device gets it replayed.
    for (const device of store.listDevices()) {
      this.notify(device);
      this.notifyFirmware(device);
    }
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
    this.images = undefined;
    this.alarms.clear();
  }

  /** The loaded store, or undefined before start()/after stop(). */
  get loaded(): Store | undefined {
    return this.store;
  }

  /** The firmware images, or undefined before start()/after stop(). */
  get firmware(): FirmwareStore | undefined {
    return this.images;
  }

  get security(): SecurityMode {
    return securityMode(this.host);
  }

  get clock(): Date {
    return this.now();
  }

  /**
   * Self paths the server currently has, with SignalK units/description and the latest value,
   * for the editor's path picker.
   */
  listPaths(): PathInfo[] {
    return [...this.host.streambundle.getAvailablePaths()].sort().map((path) => {
      const meta = this.host.getMetadata(`vessels.self.${path}`) as
        { units?: unknown; description?: unknown; zones?: unknown } | undefined;
      const node = this.host.getSelfPath(path) as
        { value?: unknown; timestamp?: unknown } | undefined;
      return {
        path,
        units: typeof meta?.units === 'string' ? meta.units : null,
        description: typeof meta?.description === 'string' ? meta.description : null,
        zones: meta?.zones ?? null,
        value: node?.value ?? null,
        timestamp: typeof node?.timestamp === 'string' ? node.timestamp : null,
      };
    });
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

  /** The update offered to the device: only while it waits to be downloaded. */
  firmwareOffer(device: DeviceRecord): FirmwareOffer | null {
    const update = device.update;
    if (update?.state !== 'requested') return null;
    const image = this.images?.get(update.buildId);
    if (!image) return null;
    return { request: update.request, version: image.version, size: image.size, md5: image.md5 };
  }

  /** Emit the device's firmware offer (null when there is none). */
  notifyFirmware(device: DeviceRecord): void {
    this.host.handleMessage(PLUGIN_ID, {
      updates: [
        {
          values: [
            {
              path: firmwarePath(device.id) as Path,
              // A JSON object as a delta value (the version path carries a string).
              value: this.firmwareOffer(device) as unknown as string | null,
            },
          ],
        },
      ],
    });
  }
}
