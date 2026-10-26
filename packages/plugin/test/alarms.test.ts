import type { Delta, Path } from '@signalk/server-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANON_AUTO, device, startHarness, type Harness, type Principal } from './harness.js';

const ID = '3a2b1c0d-ef01-2345-0ba2-a1b2c3d4e5f6';
const DEPTH = 'notifications.environment.depth.belowTransducer';

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

const alarm = (path: string, value: unknown, context?: string): Delta => ({
  ...(context ? { context: context as never } : {}),
  updates: [{ values: [{ path: path as Path, value: value as never }] }],
});
const shallow = (state: string, method = ['visual', 'sound']) =>
  alarm(DEPTH, { state, method, message: 'Shallow water' });
/** `as: null` sends no principal. */
const ack = (path: unknown, as: Principal | null = device(ID)) =>
  h.call('POST', '/signalk/v1/api/esphelm/notifications/ack', {
    as: as ?? undefined,
    body: { path },
  });
const methodNow = (path = DEPTH) => (h.value(path) as { method?: string[] }).method;

describe('POST /notifications/ack', () => {
  it('silences the alarm: republishes it without sound, state and message unchanged', async () => {
    h.publish(shallow('alarm'));
    const res = await ack(DEPTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: DEPTH, state: 'alarm' });
    expect(h.value(DEPTH)).toEqual({
      state: 'alarm',
      method: ['visual'],
      message: 'Shallow water',
    });
    expect(h.service.alarms.isAcknowledged(DEPTH)).toBe(true);
  });

  it("republishes under the notification's own source, so no silenced copy lingers", async () => {
    h.publish({
      updates: [
        {
          $source: 'anchoralarm.plugin' as never,
          values: [{ path: DEPTH as Path, value: { state: 'alarm', method: ['sound'] } as never }],
        },
      ],
    });
    await ack(DEPTH);
    expect(h.deltas.at(-1)?.updates[0]).toMatchObject({ $source: 'anchoralarm.plugin' });
  });

  it('keeps it silent when the alarm plugin resends it with sound', async () => {
    h.publish(shallow('alarm'));
    await ack(DEPTH);
    h.publish(shallow('alarm'));
    expect(methodNow()).toEqual(['visual']);
  });

  it('ends the acknowledgement when the state changes (escalation sounds again)', async () => {
    h.publish(shallow('warn'));
    await ack(DEPTH);
    h.publish(shallow('alarm'));
    expect(methodNow()).toEqual(['visual', 'sound']);
    expect(h.service.alarms.isAcknowledged(DEPTH)).toBe(false);
    // ...and a later return to the acknowledged state is not silenced either.
    h.publish(shallow('warn'));
    expect(methodNow()).toEqual(['visual', 'sound']);
  });

  it('ends it when the alarm clears', async () => {
    h.publish(shallow('alarm'));
    await ack(DEPTH);
    h.publish(alarm(DEPTH, { state: 'normal', method: [], message: '' }));
    expect(h.service.alarms.isAcknowledged(DEPTH)).toBe(false);
  });

  it('leaves the same path of another vessel alone', async () => {
    h.publish(shallow('alarm'));
    await ack(DEPTH);
    const other = alarm(
      DEPTH,
      { state: 'alarm', method: ['sound'] },
      'vessels.urn:mrn:imo:mmsi:999',
    );
    h.publish(other);
    const last = h.deltas.at(-1)?.updates[0];
    expect(last && 'values' in last ? last.values[0]?.value : undefined).toEqual({
      state: 'alarm',
      method: ['sound'],
    });
  });

  it('filters deltas addressed to this vessel by its full context', async () => {
    h.publish(shallow('alarm'));
    await ack(DEPTH);
    h.publish(
      alarm(DEPTH, { state: 'alarm', method: ['sound'] }, 'vessels.urn:mrn:imo:mmsi:230000000'),
    );
    expect(methodNow()).toEqual([]);
  });

  it.each<[string, unknown, number, string]>([
    ['a path outside notifications', 'navigation.speedOverGround', 400, 'INVALID_PATH'],
    ['a wildcard', 'notifications.*', 400, 'INVALID_PATH'],
    ['no path', undefined, 400, 'INVALID_PATH'],
    ['an unknown notification', 'notifications.engine.overheat', 404, 'NO_ALARM'],
  ])('refuses %s', async (_label, path, status, error) => {
    const res = await ack(path);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error });
  });

  it('refuses a notification that is back to normal', async () => {
    h.publish(alarm(DEPTH, { state: 'normal', method: [], message: '' }));
    const res = await ack(DEPTH);
    expect(res.status).toBe(404);
  });

  it.each<[string, Principal | null, number]>([
    ['no principal', null, 401],
    ['anonymous AUTO readonly', ANON_AUTO, 401],
    ['readonly device token', device(ID, 'readonly'), 403],
  ])('needs a read/write token: %s -> %i', async (_label, as, status) => {
    h.publish(shallow('alarm'));
    const res = await ack(DEPTH, as);
    expect(res.status).toBe(status);
    expect(methodNow()).toEqual(['visual', 'sound']);
  });

  it('forgets acknowledgements when the plugin restarts', async () => {
    h.publish(shallow('alarm'));
    await ack(DEPTH);
    h.restart();
    h.publish(shallow('alarm'));
    expect(methodNow()).toEqual(['visual', 'sound']);
  });
});
