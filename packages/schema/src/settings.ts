import Type from 'typebox';
import { Id, SkPath } from './primitives.js';

/**
 * Display settings carried by the layout (Phase 6, ADR-0015). One layout per display, so they
 * are validated, cached and delivered with it, and apply offline too. Every field is optional.
 */
export const Settings = Type.Object(
  {
    brightness: Type.Optional(
      Type.Object(
        {
          day: Type.Optional(
            Type.Integer({ minimum: 5, maximum: 100, description: 'Backlight in %, day theme.' }),
          ),
          night: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 100, description: 'Backlight in %, night theme.' }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    /** Page shown at boot; must be a page of this layout. */
    startPage: Type.Optional(Id),
    autoTheme: Type.Optional(
      Type.Union([Type.Literal('off'), Type.Literal('sun')], {
        description:
          '"sun": night theme while autoThemePath says dusk or night, else the layout theme.',
      }),
    ),
    autoThemePath: Type.Optional(SkPath),
    screenTimeout: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 3600,
        description:
          'Seconds without a touch before the screen turns off; 0 = never. Displays treat values under 10 as 10.',
      }),
    ),
  },
  { additionalProperties: false },
);
export type Settings = Type.Static<typeof Settings>;

/** Values the display uses for omitted settings. */
export const SETTINGS_DEFAULTS = {
  brightnessDay: 100,
  brightnessNight: 30,
  autoTheme: 'off',
  autoThemePath: 'environment.sun',
  screenTimeout: 0,
  /** Shortest timeout a display applies (a smaller value would make it hard to use). */
  minScreenTimeout: 10,
} as const;

/** environment.sun values (derived-data plugin) that switch an autoTheme "sun" display to night. */
export const NIGHT_SUN_STATES = ['dusk', 'night'] as const;
