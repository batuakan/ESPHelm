/**
 * When a display with a speaker plays an alarm tone (ADR-0033), the one definition shared with the
 * firmware (firmware/components/esphelm_runtime/esphelm_sound.h mirrors it;
 * fixtures/sound.cases.json proves they agree). The display calls it on every loop and acts on the
 * answer; the tunes themselves are RTTTL strings in the firmware's YAML.
 *
 * Only notifications that ask for sound (SignalK `method` contains "sound") and are not yet
 * acknowledged count; `level` is the worst of them.
 */

/** SignalK alarm states above normal, in rising severity. */
export const ALARM_LEVELS = ['alert', 'warn', 'alarm', 'emergency'] as const;
export type AlarmLevel = (typeof ALARM_LEVELS)[number];

/**
 * How often a level's tune repeats while it is the worst unacknowledged one, in ms from the start
 * of the last play: -1 plays once, 0 repeats as soon as the tune ends.
 */
export const ALARM_REPEAT_MS: Record<AlarmLevel, number> = {
  alert: -1,
  warn: -1,
  alarm: 5000,
  emergency: 0,
};

export interface AlarmSoundInput {
  /** The worst notification asking for sound and not acknowledged; null: none. */
  level: AlarmLevel | null;
  /** Counts up whenever a notification starts asking for sound (new, or a new state). */
  generation: number;
  /** The server's values are live. Offline, alarm states are unknown and can't be acknowledged. */
  online: boolean;
  /** The alarm tune playing now; null: none (a touch click does not count). */
  playing: AlarmLevel | null;
  /** `generation` when the last alarm tune started. */
  playedGeneration: number;
  /** When the last alarm tune started, ms (uint32 milliseconds, wrapping). */
  lastStartMs: number;
  nowMs: number;
}

/** What to do now: nothing, stop the alarm tune, or (re)start a level's tune. */
export type AlarmSoundAction = 'none' | 'stop' | AlarmLevel;

const rank = (l: AlarmLevel) => ALARM_LEVELS.indexOf(l);

export function alarmSound(i: AlarmSoundInput): AlarmSoundAction {
  if (!i.online || i.level === null) return i.playing !== null ? 'stop' : 'none';
  // Something new asks for sound: play the worst tune now, even over one that is playing.
  if (i.generation !== i.playedGeneration) return i.level;
  // The tune playing is for an alarm that was acknowledged or cleared.
  if (i.playing !== null && rank(i.playing) > rank(i.level)) return 'stop';
  if (i.playing !== null) return 'none';
  const repeat = ALARM_REPEAT_MS[i.level];
  if (repeat < 0) return 'none';
  // uint32 arithmetic, as on the display, so a wrapped millis() still counts right.
  return (i.nowMs - i.lastStartMs) >>> 0 >= repeat ? i.level : 'none';
}
