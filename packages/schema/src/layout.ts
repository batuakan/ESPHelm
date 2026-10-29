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
    theme: Type.Union([Type.Literal('day'), Type.Literal('night')]),
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
