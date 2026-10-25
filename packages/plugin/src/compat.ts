import { LAYOUT_VERSION, type Layout } from '@esphelm/schema';
import type { DeviceRecord, StoredLayout } from './store.js';

export interface Compatibility {
  /** Reasons the device cannot use the layout at all (assignment is refused). */
  errors: { code: 'UNSUPPORTED_SCHEMA' | 'UNSUPPORTED_WIDGET'; message: string }[];
  /** Reasons the layout may not fit; the assignment still goes ahead (no hard limits in v1). */
  warnings: { code: 'LAYOUT_TOO_LARGE'; message: string }[];
}

/** Tile types a layout uses (what a device must list in `hello.widgets`). */
export function usedWidgets(layout: Layout): Set<string> {
  return new Set(layout.pages.flatMap((page) => page.tiles.map((t) => t.type)));
}

export function checkCompatibility(entry: StoredLayout, device: DeviceRecord): Compatibility {
  const result: Compatibility = { errors: [], warnings: [] };
  const { hello } = device;
  if (hello.schema.major < LAYOUT_VERSION) {
    result.errors.push({
      code: 'UNSUPPORTED_SCHEMA',
      message: `device parses layout v${hello.schema.major}, layout is v${LAYOUT_VERSION}`,
    });
  }
  const supported = new Set(hello.widgets);
  const missing = [...usedWidgets(entry.layout)].filter((w) => !supported.has(w)).sort();
  if (missing.length > 0) {
    result.errors.push({
      code: 'UNSUPPORTED_WIDGET',
      message: `device cannot render: ${missing.join(', ')}`,
    });
  }
  const max = hello.capacity.maxLayoutBytes;
  if (max !== undefined && entry.bytes.length > max) {
    result.warnings.push({
      code: 'LAYOUT_TOO_LARGE',
      message: `layout is ${entry.bytes.length} bytes; device reports at most ${max}`,
    });
  }
  return result;
}
