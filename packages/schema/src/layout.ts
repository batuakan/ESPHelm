import Type from 'typebox';
import { Id, Label } from './primitives.js';
import { Page } from './pages.js';
import { Settings } from './settings.js';

/** Major version of the layout format. Firmware rejects layouts with any other major. */
export const LAYOUT_VERSION = 1;

/** A complete display layout as stored by the plugin and fetched by a device. */
export const Layout = Type.Object(
  {
    version: Type.Literal(LAYOUT_VERSION, { errorCode: 'UNSUPPORTED_VERSION' }),
    id: Id,
    name: Type.Optional(Label),
    theme: Type.Union([Type.Literal('day'), Type.Literal('dark'), Type.Literal('night')], {
      description:
        'day: light, for sunlight; dark: dark page, full colours; night: red on black for night vision (ADR-0034).',
    }),
    pages: Type.Array(Page, { minItems: 1, errorCode: 'NO_PAGES' }),
    settings: Type.Optional(Settings),
  },
  {
    additionalProperties: false,
    $id: 'https://github.com/batuakan/ESPHelm/schema/layout/v1.json',
    title: 'ESPHelm layout v1',
  },
);
export type Layout = Type.Static<typeof Layout>;
