import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  migrateLayout,
  validateHello,
  validateLayout,
  type Hello,
  type Layout,
} from '@esphelm/schema';
import { etagOf, serializeLayout } from './etag.js';

export type DeviceState = 'pending' | 'adopted';

/**
 * A firmware update asked of a display (ADR-0036):
 *   requested   offered on plugins.esphelm.<id>.firmware, not downloaded yet
 *   downloading the display is downloading it (served once per request)
 *   installing  downloaded; waiting for the display to report the new build in hello
 *   done        hello reported the target build
 *   failed      the display reported an error, the download broke off, or it came back on the
 *               old build (the new one didn't start, or was rolled back)
 */
export type UpdateState = 'requested' | 'downloading' | 'installing' | 'done' | 'failed';

export interface DeviceUpdate {
  request: string;
  buildId: string;
  version: string;
  state: UpdateState;
  error?: string;
  /** When the state last changed. */
  at: string;
}

export function updateActive(update: DeviceUpdate | undefined): boolean {
  return (
    update !== undefined &&
    (update.state === 'requested' ||
      update.state === 'downloading' ||
      update.state === 'installing')
  );
}

export interface DeviceRecord {
  id: string;
  state: DeviceState;
  name?: string;
  layoutId?: string;
  hello: Hello;
  firstSeen: string;
  lastSeen: string;
  update?: DeviceUpdate;
}

export interface StoredLayout {
  layout: Layout;
  /** Exact bytes served to devices. */
  bytes: Buffer;
  etag: string;
}

/** Write via a temp file and rename, so a crash never leaves a half-written file. */
function writeAtomic(file: string, content: string | Buffer): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

/**
 * JSON file store under the plugin data dir:
 *   layouts/<layoutId>.json   one validated layout per file
 *   devices.json              device registry
 * Everything read from disk is validated again; invalid entries are skipped and reported.
 * Layouts in an older shape (the wind-rose page kind before Phase 5b) are migrated and
 * rewritten once.
 */
export class Store {
  private readonly layoutsDir: string;
  private readonly devicesFile: string;
  private layouts = new Map<string, StoredLayout>();
  private devices = new Map<string, DeviceRecord>();

  constructor(
    dataDir: string,
    private readonly reportProblem: (message: string) => void,
    private readonly log: (message: string) => void = () => undefined,
  ) {
    this.layoutsDir = join(dataDir, 'layouts');
    this.devicesFile = join(dataDir, 'devices.json');
  }

  load(): void {
    mkdirSync(this.layoutsDir, { recursive: true });
    this.layouts.clear();
    for (const file of readdirSync(this.layoutsDir).filter((f) => f.endsWith('.json'))) {
      const id = file.slice(0, -'.json'.length);
      try {
        const migrated = migrateLayout(
          JSON.parse(readFileSync(join(this.layoutsDir, file), 'utf8')),
        );
        const result = validateLayout(migrated.layout);
        if (!result.ok) {
          this.reportProblem(
            `layout ${file} is invalid (${result.errors.map((e) => e.code).join(', ')}); not served`,
          );
        } else if (result.value.id !== id) {
          this.reportProblem(`layout ${file} has id "${result.value.id}"; not served`);
        } else {
          const entry = stored(result.value);
          if (migrated.changed) {
            writeAtomic(join(this.layoutsDir, file), entry.bytes);
            this.log(
              `layout ${file}: wind-rose and chart pages migrated to tiles (ADR-0010, ADR-0030)`,
            );
          }
          this.layouts.set(id, entry);
        }
      } catch (e) {
        this.reportProblem(`layout ${file} could not be read: ${(e as Error).message}`);
      }
    }

    this.devices.clear();
    let raw: unknown = {};
    try {
      raw = JSON.parse(readFileSync(this.devicesFile, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.reportProblem(`devices.json could not be read: ${(e as Error).message}`);
      }
    }
    for (const [id, rec] of Object.entries(raw as Record<string, DeviceRecord>)) {
      if (rec?.id !== id || !validateHello(rec.hello).ok) {
        this.reportProblem(`device ${id} in devices.json is invalid; ignored`);
        continue;
      }
      this.devices.set(id, rec);
    }
  }

  // Layouts

  listLayouts(): StoredLayout[] {
    return [...this.layouts.values()];
  }

  getLayout(id: string): StoredLayout | undefined {
    return this.layouts.get(id);
  }

  /** Caller must have validated the layout. */
  saveLayout(layout: Layout): StoredLayout {
    const entry = stored(layout);
    writeAtomic(join(this.layoutsDir, `${layout.id}.json`), `${JSON.stringify(layout, null, 2)}\n`);
    this.layouts.set(layout.id, entry);
    return entry;
  }

  deleteLayout(id: string): void {
    rmSync(join(this.layoutsDir, `${id}.json`), { force: true });
    this.layouts.delete(id);
  }

  // Devices

  listDevices(): DeviceRecord[] {
    return [...this.devices.values()];
  }

  getDevice(id: string): DeviceRecord | undefined {
    return this.devices.get(id);
  }

  /**
   * Register or refresh a device from its hello. First contact creates a pending device.
   * A firmware update in progress is settled by the build the display reports.
   */
  upsertHello(
    hello: Hello,
    now: Date,
  ): { device: DeviceRecord; created: boolean; updateSettled: boolean } {
    const existing = this.devices.get(hello.deviceId);
    const update = existing?.update && settleUpdate(existing.update, hello, now);
    const device: DeviceRecord = existing
      ? {
          ...existing,
          hello,
          lastSeen: now.toISOString(),
          ...(update ? { update } : {}),
        }
      : {
          id: hello.deviceId,
          state: 'pending',
          hello,
          firstSeen: now.toISOString(),
          lastSeen: now.toISOString(),
        };
    this.devices.set(device.id, device);
    this.saveDevices();
    return { device, created: !existing, updateSettled: update !== undefined };
  }

  /** Set or clear (undefined) a device's firmware update. */
  setUpdate(id: string, update: DeviceUpdate | undefined): DeviceRecord | undefined {
    const existing = this.devices.get(id);
    if (!existing) return undefined;
    const device: DeviceRecord = { ...existing, update };
    if (update === undefined) delete device.update;
    this.devices.set(id, device);
    this.saveDevices();
    return device;
  }

  updateDevice(id: string, patch: Partial<Pick<DeviceRecord, 'state' | 'name' | 'layoutId'>>) {
    const existing = this.devices.get(id);
    if (!existing) return undefined;
    const device: DeviceRecord = { ...existing, ...patch };
    // `layoutId: undefined` in a patch unassigns; drop the key so JSON stays clean.
    if (device.layoutId === undefined) delete device.layoutId;
    if (device.name === undefined) delete device.name;
    this.devices.set(id, device);
    this.saveDevices();
    return device;
  }

  deleteDevice(id: string): boolean {
    const had = this.devices.delete(id);
    if (had) this.saveDevices();
    return had;
  }

  private saveDevices(): void {
    writeAtomic(this.devicesFile, `${JSON.stringify(Object.fromEntries(this.devices), null, 2)}\n`);
  }
}

/**
 * The update after a hello, or undefined when the hello changes nothing. Done when the display
 * runs the target build. A display that comes back on another build after it downloaded the image
 * didn't start it (or rolled back). A hello while the request waits or downloads changes nothing:
 * the display says hello when it reconnects, too.
 */
export function settleUpdate(
  update: DeviceUpdate,
  hello: Hello,
  now: Date,
): DeviceUpdate | undefined {
  if (!updateActive(update)) return undefined;
  if (hello.fw.build === update.buildId) {
    return {
      request: update.request,
      buildId: update.buildId,
      version: update.version,
      state: 'done',
      at: now.toISOString(),
    };
  }
  if (update.state === 'installing') {
    return {
      ...update,
      state: 'failed',
      error:
        'the display came back on its old firmware (the new one did not start, or was rolled back)',
      at: now.toISOString(),
    };
  }
  return undefined;
}

function stored(layout: Layout): StoredLayout {
  const bytes = serializeLayout(layout);
  return { layout, bytes, etag: etagOf(bytes) };
}
