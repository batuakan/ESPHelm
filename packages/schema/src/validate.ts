import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { Hello } from './hello.js';
import { Layout } from './layout.js';
import { GridPage } from './pages.js';
import { TILE_TYPES } from './tiles.js';

/**
 * Stable error codes. Structural codes come from the JSON Schema; semantic codes from the
 * checks below, which JSON Schema cannot express. Firmware mirrors both and logs the same codes.
 */
export const STRUCTURAL_CODES = [
  'INVALID_TYPE',
  'MISSING_FIELD',
  'UNKNOWN_FIELD',
  'INVALID_VALUE',
  'OUT_OF_RANGE',
  'INVALID_FORMAT',
  'TOO_FEW',
  'UNSUPPORTED_VERSION',
  'NO_PAGES',
  'EMPTY_PAGE',
  'INVALID_ID',
  'INVALID_LABEL',
  'INVALID_PATH',
  'INVALID_DEVICE_ID',
  'UNKNOWN_UNIT',
  'UNKNOWN_SLOT',
  'UNKNOWN_PAGE_KIND',
  'UNKNOWN_TILE_TYPE',
] as const;
export const SEMANTIC_CODES = [
  'DUPLICATE_ID',
  'TILE_OUT_OF_GRID',
  'TILE_OVERLAP',
  'INVALID_RANGE',
  'INVALID_ZONE',
  'ZONE_OUT_OF_RANGE',
] as const;
export type ErrorCode = (typeof STRUCTURAL_CODES)[number] | (typeof SEMANTIC_CODES)[number];

export interface ValidationError {
  /** JSON Pointer (RFC 6901) into the validated document. */
  pointer: string;
  code: ErrorCode;
  message: string;
}

export type ValidationResult<T> =
  { ok: true; value: T; errors: [] } | { ok: false; errors: ValidationError[] };

const KEYWORD_CODES: Record<string, ErrorCode> = {
  type: 'INVALID_TYPE',
  required: 'MISSING_FIELD',
  additionalProperties: 'UNKNOWN_FIELD',
  const: 'INVALID_VALUE',
  enum: 'INVALID_VALUE',
  anyOf: 'INVALID_VALUE',
  minimum: 'OUT_OF_RANGE',
  maximum: 'OUT_OF_RANGE',
  exclusiveMinimum: 'OUT_OF_RANGE',
  exclusiveMaximum: 'OUT_OF_RANGE',
  pattern: 'INVALID_FORMAT',
  minItems: 'TOO_FEW',
};

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true });
// Annotation keyword carrying our stable error code; it never affects validity.
ajv.addKeyword({ keyword: 'errorCode', schemaType: 'string' });

type JsonObject = Record<string, unknown>;

/** Copy of an object schema with one array property's items relaxed to "any object". */
function shell(schema: object, arrayProp: string): object {
  const { $id: _id, ...rest } = schema as JsonObject & { properties: JsonObject };
  void _id;
  const properties = (rest as { properties: JsonObject }).properties;
  const arr = properties[arrayProp] as JsonObject;
  return {
    ...rest,
    properties: { ...properties, [arrayProp]: { ...arr, items: { type: 'object' } } },
  };
}

const validators = {
  layoutShell: ajv.compile(shell(Layout, 'pages')),
  gridPageShell: ajv.compile(shell(GridPage, 'tiles')),
  tiles: Object.fromEntries(
    Object.entries(TILE_TYPES).map(([name, t]) => [name, ajv.compile(t)]),
  ) as Record<string, ValidateFunction>,
  hello: ajv.compile(Hello),
};

function mapAjvErrors(errors: ErrorObject[] | null | undefined, base: string): ValidationError[] {
  const out: ValidationError[] = [];
  for (const e of errors ?? []) {
    // A union of literals reports one `const` failure per branch plus the `anyOf`; keep the anyOf.
    if (e.keyword === 'const' && e.schemaPath.includes('/anyOf/')) continue;
    let pointer = base + e.instancePath;
    if (e.keyword === 'required') pointer += `/${String(e.params.missingProperty)}`;
    if (e.keyword === 'additionalProperties') pointer += `/${String(e.params.additionalProperty)}`;
    const schemaCode = (e.parentSchema as { errorCode?: ErrorCode } | undefined)?.errorCode;
    // errorCode describes a value constraint; plain structural failures keep their generic code.
    const code =
      schemaCode && e.keyword !== 'type' && e.keyword !== 'required'
        ? schemaCode
        : (KEYWORD_CODES[e.keyword] ?? 'INVALID_VALUE');
    out.push({ pointer, code, message: describe(e) });
  }
  return dedupe(out);
}

function describe(e: ErrorObject): string {
  if (e.keyword === 'anyOf') {
    const branches = (e.parentSchema as { anyOf?: { const?: unknown }[] } | undefined)?.anyOf ?? [];
    if (branches.length > 0 && branches.every((b) => b.const !== undefined)) {
      return `must be one of ${branches.map((b) => JSON.stringify(b.const)).join(', ')}`;
    }
  }
  return e.message ?? e.keyword;
}

/** Unions of literals report once per branch; keep one error per pointer and code. */
function dedupe(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.pointer}\u0000${e.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateStructure(input: unknown): ValidationError[] {
  if (!isObject(input)) {
    return [{ pointer: '', code: 'INVALID_TYPE', message: 'layout must be an object' }];
  }
  // Check the major first: other majors may be shaped differently, so stop there.
  if (input.version !== undefined && input.version !== 1) {
    return [
      {
        pointer: '/version',
        code: 'UNSUPPORTED_VERSION',
        message: `unsupported layout version ${JSON.stringify(input.version)}; this validator handles 1`,
      },
    ];
  }
  const errors: ValidationError[] = [];
  if (!validators.layoutShell(input)) {
    errors.push(...mapAjvErrors(validators.layoutShell.errors, ''));
  }
  const pages = Array.isArray(input.pages) ? input.pages : [];
  pages.forEach((page: unknown, i: number) => {
    const base = `/pages/${i}`;
    if (!isObject(page)) return; // already reported by the shell
    if (page.kind === 'grid') {
      if (!validators.gridPageShell(page)) {
        errors.push(...mapAjvErrors(validators.gridPageShell.errors, base));
      }
      const tiles = Array.isArray(page.tiles) ? page.tiles : [];
      tiles.forEach((tile: unknown, j: number) => {
        const tbase = `${base}/tiles/${j}`;
        if (!isObject(tile)) return;
        const validate = typeof tile.type === 'string' ? validators.tiles[tile.type] : undefined;
        if (!validate) {
          errors.push({
            pointer: `${tbase}/type`,
            code: 'UNKNOWN_TILE_TYPE',
            message: `unknown tile type ${JSON.stringify(tile.type)}`,
          });
          return;
        }
        if (!validate(tile)) errors.push(...mapAjvErrors(validate.errors, tbase));
      });
    } else {
      errors.push({
        pointer: `${base}/kind`,
        code: 'UNKNOWN_PAGE_KIND',
        message: `unknown page kind ${JSON.stringify(page.kind)}`,
      });
    }
  });
  return dedupe(errors);
}

function validateSemantics(layout: Layout): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = new Map<string, string>();
  const claimId = (id: string, pointer: string) => {
    const first = ids.get(id);
    if (first !== undefined) {
      errors.push({
        pointer,
        code: 'DUPLICATE_ID',
        message: `id "${id}" already used at ${first}`,
      });
    } else {
      ids.set(id, pointer);
    }
  };

  layout.pages.forEach((page, i) => {
    const base = `/pages/${i}`;
    claimId(page.id, `${base}/id`);
    const { cols, rows } = page.grid;
    const placed: { x: number; y: number; w: number; h: number; j: number }[] = [];
    page.tiles.forEach((tile, j) => {
      const tbase = `${base}/tiles/${j}`;
      claimId(tile.id, `${tbase}/id`);
      if (tile.x + tile.w > cols || tile.y + tile.h > rows) {
        errors.push({
          pointer: tbase,
          code: 'TILE_OUT_OF_GRID',
          message: `tile "${tile.id}" (${tile.x},${tile.y} ${tile.w}x${tile.h}) exceeds the ${cols}x${rows} grid`,
        });
      } else {
        const hit = placed.find(
          (p) =>
            tile.x < p.x + p.w &&
            p.x < tile.x + tile.w &&
            tile.y < p.y + p.h &&
            p.y < tile.y + tile.h,
        );
        if (hit) {
          errors.push({
            pointer: tbase,
            code: 'TILE_OVERLAP',
            message: `tile "${tile.id}" overlaps ${base}/tiles/${hit.j}`,
          });
        }
        placed.push({ x: tile.x, y: tile.y, w: tile.w, h: tile.h, j });
      }
      if (tile.type === 'gauge' || tile.type === 'bar') {
        if (!(tile.min < tile.max)) {
          errors.push({
            pointer: `${tbase}/max`,
            code: 'INVALID_RANGE',
            message: `max (${tile.max}) must be greater than min (${tile.min})`,
          });
          return;
        }
        (tile.zones ?? []).forEach((zone, k) => {
          const zp = `${tbase}/zones/${k}`;
          if (!(zone.from < zone.to)) {
            errors.push({
              pointer: zp,
              code: 'INVALID_ZONE',
              message: 'zone "to" must be greater than "from"',
            });
          } else if (zone.from < tile.min || zone.to > tile.max) {
            errors.push({
              pointer: zp,
              code: 'ZONE_OUT_OF_RANGE',
              message: `zone ${zone.from}..${zone.to} is outside ${tile.min}..${tile.max}`,
            });
          }
        });
      }
    });
  });
  return errors;
}

/**
 * Validate an untrusted layout: structure (JSON Schema) first, then semantic rules
 * (unique ids, grid bounds, overlaps, ranges). Semantic rules run only on structurally valid input.
 */
export function validateLayout(input: unknown): ValidationResult<Layout> {
  const structural = validateStructure(input);
  if (structural.length > 0) return { ok: false, errors: structural };
  const layout = input as Layout;
  const semantic = validateSemantics(layout);
  if (semantic.length > 0) return { ok: false, errors: semantic };
  return { ok: true, value: layout, errors: [] };
}

/** Validate an untrusted device hello message. */
export function validateHello(input: unknown): ValidationResult<Hello> {
  if (!validators.hello(input)) {
    return { ok: false, errors: mapAjvErrors(validators.hello.errors, '') };
  }
  return { ok: true, value: input as Hello, errors: [] };
}
