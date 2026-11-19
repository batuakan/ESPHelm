import type { Hello } from '@esphelm/schema';

/**
 * Demo displays (ADR-0041): displays that only exist in the editor, so a boat with SignalK but no
 * ESPHelm display can try it. Their layouts are stored like any other; nothing receives them.
 *
 * The hellos are what real firmware reports. Font ladders were captured from the SDL builds of
 * the same sizes (`firmware/esphelm_sdl*.yaml`). The widget lists are the tile sets' own
 * (`tile_types()` in `esphelm_tiles_color/tiles_color.cpp` and `esphelm_tiles_mono/tiles_mono.cpp`,
 * checked by test/demo.test.ts). The capacity is the runtime's (`compute_capacity_()`).
 * There is no `ota` capability (no firmware updates) and no `build`.
 *
 * Ids are UUID-shaped like real ones, which are derived from MACs and never start like these.
 */
export const DEMO_ID_PREFIX = 'de300000-0000-4000-8000-';

/** The colour tile set: every tile, with chart only on displays with PSRAM (ADR-0030). */
export const COLOR_TILES = [
  'value',
  'gauge',
  'bar',
  'switch',
  'position',
  'wind_rose',
  'autopilot',
  'graph',
  'heading_tape',
  'clock',
  'engine',
  'alarms',
] as const;
export const MONO_TILES = [
  'value',
  'bar',
  'clock',
  'position',
  'wind_rose',
  'engine',
  'gauge',
  'heading_tape',
  'graph',
] as const;

const FONTS = ['value', 'label', 'small'];

export interface DemoDisplay {
  name: string;
  hello: Hello;
}

function demo(
  suffix: string,
  name: string,
  hello: Omit<Hello, 'deviceId' | 'fw' | 'schema' | 'board' | 'fonts'>,
): DemoDisplay {
  return {
    name,
    hello: {
      deviceId: `${DEMO_ID_PREFIX}${suffix}`,
      fw: { version: 'demo' },
      schema: { major: 1 },
      board: 'demo',
      fonts: FONTS,
      ...hello,
    },
  };
}

export const DEMO_DISPLAYS: readonly DemoDisplay[] = [
  // Guition 4848S040 / ESP32-S3 class: square, touch, PSRAM.
  demo('000000000480', 'Demo 480x480', {
    display: { width: 480, height: 480, rotation: 0 },
    widgets: [...COLOR_TILES, 'chart'],
    fontLineHeights: [26, 38, 56, 75, 113],
    digitFontLineHeights: [150, 225],
    capacity: { psram: true, maxLayoutBytes: 262144 },
    capabilities: { touch: true, put: true, backlight: true, rotation: true, darkTheme: true },
  }),
  // Waveshare ESP32-P4-86 class: large, with a speaker.
  demo('000000000720', 'Demo 720x720', {
    display: { width: 720, height: 720, rotation: 0 },
    widgets: [...COLOR_TILES, 'chart'],
    fontLineHeights: [33, 49, 75, 113, 169],
    digitFontLineHeights: [225, 338],
    capacity: { psram: true, maxLayoutBytes: 262144 },
    capabilities: {
      touch: true,
      put: true,
      backlight: true,
      rotation: true,
      sound: true,
      darkTheme: true,
    },
  }),
  // Waveshare ESP32-S3-RLCD-4.2: reflective black and white, buttons instead of touch.
  demo('000000000300', 'Demo 400x300 black and white', {
    display: { width: 400, height: 300, rotation: 0, kind: 'mono' },
    widgets: [...MONO_TILES],
    fontLineHeights: [19, 23, 33, 47, 66],
    digitFontLineHeights: [94, 131],
    capacity: { psram: true, maxLayoutBytes: 262144 },
    capabilities: { touch: false, put: true, backlight: false, rotation: true, darkTheme: true },
  }),
  // ESP32-2432S028R ("CYD"): small, no PSRAM, so no charts and a small layout budget.
  demo('000000000320', 'Demo 320x240, no PSRAM', {
    display: { width: 320, height: 240, rotation: 0 },
    widgets: [...COLOR_TILES],
    fontLineHeights: [14, 19, 28, 38, 56],
    digitFontLineHeights: [75, 113],
    capacity: { psram: false, maxLayoutBytes: 16384 },
    capabilities: { touch: true, put: true, backlight: true, darkTheme: true },
  }),
];

export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_ID_PREFIX);
}
