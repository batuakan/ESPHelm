import Type from 'typebox';

/** Sent by a device on every boot/reconnect (POST /signalk/v1/api/esphelm/devices/hello). */
export const Hello = Type.Object(
  {
    deviceId: Type.String({
      pattern: '^[0-9a-fA-F-]+$',
      errorCode: 'INVALID_DEVICE_ID',
      description: 'Same MAC-derived UUID the device uses as its SignalK access-request clientId.',
    }),
    fw: Type.Object({ version: Type.String() }, { additionalProperties: false }),
    schema: Type.Object(
      {
        major: Type.Integer({ minimum: 1, description: 'Highest layout major the device parses.' }),
      },
      { additionalProperties: false },
    ),
    board: Type.String({ description: 'Board/model name, e.g. "waveshare-esp32-p4-86".' }),
    display: Type.Object(
      {
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        rotation: Type.Union([
          Type.Literal(0),
          Type.Literal(90),
          Type.Literal(180),
          Type.Literal(270),
        ]),
      },
      { additionalProperties: false },
    ),
    widgets: Type.Array(Type.String(), {
      description: 'Tile types and full-page widgets this firmware can render.',
    }),
    fonts: Type.Optional(Type.Array(Type.String(), { description: 'Semantic font sizes.' })),
    fontLineHeights: Type.Optional(
      Type.Array(Type.Integer({ minimum: 1 }), {
        description:
          'Line heights in pixels of the fonts tile text can use, smallest first (ADR-0017). The editor sizes its preview text from them.',
      }),
    ),
    digitFontLineHeights: Type.Optional(
      Type.Array(Type.Integer({ minimum: 1 }), {
        description:
          "Line heights in pixels of the digits-only fonts (0-9 . -), smallest first; only a value tile's number uses them, while it is numeric (ADR-0017).",
      }),
    ),
    capacity: Type.Object(
      {
        psram: Type.Boolean(),
        maxLayoutBytes: Type.Optional(Type.Integer({ minimum: 0 })),
        freeHeapBytes: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      {
        additionalProperties: false,
        description:
          'Measured by the device; the editor warns before sending a layout that will not fit.',
      },
    ),
    capabilities: Type.Object(
      {
        touch: Type.Boolean(),
        put: Type.Boolean(),
        backlight: Type.Optional(
          Type.Boolean({
            description: 'The firmware can dim the backlight (settings.brightness).',
          }),
        ),
      },
      { additionalProperties: false },
    ),
    layoutEtag: Type.Optional(Type.String({ description: 'ETag of the cached layout, if any.' })),
    recovery: Type.Optional(
      Type.Object(
        {
          skippedLayoutEtag: Type.String({
            description:
              'A layout that crashed the display while it was shown; the device refuses it until a different one is sent (ADR-0013).',
          }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: 'https://github.com/batuakan/ESPHelm/schema/hello/v1.json',
    title: 'ESPHelm device hello v1',
  },
);
export type Hello = Type.Static<typeof Hello>;
