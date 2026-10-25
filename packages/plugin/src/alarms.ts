import type { Delta, Path } from '@signalk/server-api';
import type { PluginHost } from './host.js';

/** Notification states a display shows as an alarm (SignalK's alarm states above normal). */
export const ALARM_STATES = ['alert', 'warn', 'alarm', 'emergency'] as const;

const NOTIFICATION_PATH = /^notifications(\.[A-Za-z0-9_-]+)+$/;

interface NotificationValue {
  state?: unknown;
  method?: unknown;
  message?: unknown;
  [key: string]: unknown;
}

export type AckResult =
  | { ok: true; state: string }
  | {
      ok: false;
      status: 400 | 404;
      error: 'INVALID_PATH' | 'NO_ALARM';
      message: string;
    };

function isNotification(v: unknown): v is NotificationValue {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function silenced(v: NotificationValue): NotificationValue {
  return Array.isArray(v.method) ? { ...v, method: v.method.filter((m) => m !== 'sound') } : v;
}

/**
 * Acknowledging alarms from a display (ADR-0014). signalk-server has no acknowledge API, so the
 * plugin silences the notification itself: it republishes the current value without "sound"
 * in `method`, and its delta input handler keeps later deltas of that notification silent
 * while its state stays the same. A different state (escalation, or back to normal) ends the
 * acknowledgement. The state and message are never changed, so the alarm stays visible.
 */
export class AlarmAcks {
  /** Notification path -> the state that was acknowledged. In memory: a restart forgets them. */
  private readonly acked = new Map<string, string>();

  constructor(
    private readonly host: PluginHost,
    private readonly source: string,
  ) {}

  ack(path: string): AckResult {
    if (!NOTIFICATION_PATH.test(path)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_PATH',
        message: 'path must be a notifications.* path',
      };
    }
    const node = this.host.getSelfPath(path) as { value?: unknown } | undefined;
    const value = node?.value;
    const state = isNotification(value) ? value.state : undefined;
    if (!isNotification(value) || !(ALARM_STATES as readonly unknown[]).includes(state)) {
      return { ok: false, status: 404, error: 'NO_ALARM', message: `no active alarm at ${path}` };
    }
    this.acked.set(path, state as string);
    this.host.handleMessage(this.source, {
      updates: [{ values: [{ path: path as Path, value: silenced(value) as never }] }],
    });
    return { ok: true, state: state as string };
  }

  isAcknowledged(path: string): boolean {
    return this.acked.has(path);
  }

  /** Delta input handler: keeps acknowledged notifications of this vessel silent. */
  filter(delta: Delta, selfContext: string | undefined): Delta {
    if (this.acked.size === 0) return delta;
    if (
      delta.context !== undefined &&
      delta.context !== 'vessels.self' &&
      delta.context !== selfContext
    )
      return delta;
    for (const update of delta.updates ?? []) {
      if (!('values' in update)) continue;
      for (const pv of update.values ?? []) {
        const state = this.acked.get(pv.path);
        if (state === undefined) continue;
        const v: unknown = pv.value;
        if (!isNotification(v) || v.state !== state) {
          this.acked.delete(pv.path);
          continue;
        }
        pv.value = silenced(v) as never;
      }
    }
    return delta;
  }

  clear(): void {
    this.acked.clear();
  }
}
