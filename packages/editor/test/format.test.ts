import { describe, expect, it } from 'vitest';
import { ApiError, createApi } from '../src/api';
import { formatValue, preferredUnit } from '../src/format';

describe('formatValue (same rules as the firmware)', () => {
  it.each([
    [5.0, 'kn', undefined, '9.7'],
    [-0.35, 'deg180', 0, '-20'],
    [0.5, 'pct', 0, '50'],
    [12.345, undefined, 2, '12.35'],
    [true, undefined, undefined, 'on'],
    ['auto', undefined, undefined, 'auto'],
    [null, 'kn', undefined, '--'],
    [{ latitude: 1 }, undefined, undefined, '--'],
    [Number.NaN, 'kn', undefined, '--'],
  ] as const)('%j %s/%s -> %s', (value, unit, decimals, text) => {
    expect(formatValue(value, unit, decimals)).toBe(text);
  });

  it('picks a sailor-friendly default unit', () => {
    expect(preferredUnit('speed')).toBe('kn');
    expect(preferredUnit('temperature')).toBe('degC');
    expect(preferredUnit(undefined)).toBeUndefined();
  });
});

describe('api client', () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('turns 401 into a login hint', async () => {
    const api = createApi(respond(401, 'Unauthorized'));
    const err = await api.devices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).needsLogin).toBe(true);
    expect((err as ApiError).message).toMatch(/Log in to SignalK/);
  });

  it('keeps validation errors and per-device compatibility problems', async () => {
    const invalid = (await createApi(
      respond(400, {
        error: 'INVALID_LAYOUT',
        errors: [{ pointer: '/theme', code: 'INVALID_VALUE', message: 'x' }],
      }),
    )
      .saveLayout({ version: 1, id: 'x', theme: 'day', pages: [] })
      .catch((e: unknown) => e)) as ApiError;
    expect(invalid.code).toBe('INVALID_LAYOUT');
    expect(invalid.errors).toHaveLength(1);

    const incompatible = (await createApi(
      respond(409, {
        error: 'INCOMPATIBLE',
        devices: [
          {
            device: 'd1',
            errors: [{ code: 'UNSUPPORTED_WIDGET', message: 'device cannot render: gauge' }],
          },
        ],
      }),
    )
      .updateDevice('d1', { layoutId: 'x' })
      .catch((e: unknown) => e)) as ApiError;
    expect(incompatible.message).toBe('device cannot render: gauge');
    expect(incompatible.problems).toEqual([
      { code: 'UNSUPPORTED_WIDGET', message: 'device cannot render: gauge', device: 'd1' },
    ]);
  });
});
