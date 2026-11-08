import Type from 'typebox';
import { POSIX_TZ_PATTERN } from './clock.js';
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
    timeZone: Type.Optional(
      Type.Object(
        {
          name: Type.String({
            pattern: '^[A-Za-z0-9_+/-]{1,64}$',
            description: 'IANA zone the editor built the rule from, e.g. "Europe/Stockholm".',
          }),
          posix: Type.String({
            pattern: POSIX_TZ_PATTERN,
            description:
              'The zone as a POSIX TZ rule (clock.ts), which the display uses: "<+01>-1<+02>,M3.5.0,M10.5.0/3".',
          }),
        },
        {
          additionalProperties: false,
          description: 'Time zone of clocks (ADR-0024). Absent: UTC.',
        },
      ),
    ),
    clockPath: Type.Optional(SkPath),
    screenSaver: Type.Optional(
      Type.Union(
        [Type.Literal('off'), Type.Literal('time'), Type.Literal('date'), Type.Literal('both')],
        {
          description:
            'What the screen shows, faintly, after screenTimeout instead of turning off (ADR-0024). Absent: off.',
        },
      ),
    ),
    rotation: Type.Optional(
      Type.Union([Type.Literal(0), Type.Literal(90), Type.Literal(180), Type.Literal(270)], {
        description:
          'How the display is mounted: the picture is turned this many degrees clockwise (ADR-0028). The layout is designed for the turned screen. Displays that cannot turn ignore it. Absent: 0.',
      }),
    ),
    screenSaverBrightness: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description:
          'Backlight in % while the screen saver shows. Some panels are dark below about 30 %.',
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
  clockPath: 'navigation.datetime',
  screenSaver: 'off',
  screenSaverBrightness: 30,
  rotation: 0,
  /** Shortest timeout a display applies (a smaller value would make it hard to use). */
  minScreenTimeout: 10,
} as const;

/** environment.sun values (derived-data plugin) that switch an autoTheme "sun" display to night. */
export const NIGHT_SUN_STATES = ['dusk', 'night'] as const;
