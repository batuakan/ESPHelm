// Display settings (ADR-0015): carried by the layout and sent with Save & send, like the theme.
import { useMemo } from 'react';
import {
  clockTime,
  localOffset,
  SETTINGS_DEFAULTS,
  type Layout,
  type Settings,
} from '@esphelm/schema';
import type { PathInfo } from '../api';
import { ROTATIONS, type Rotation } from '../rotation';
import { browserTimeZone, timeZoneSetting } from '../layoutOps';
import { Drawer, PathPicker } from './TileDrawer';

/** Screen timeout choices in seconds (0 = never). */
const TIMEOUTS: { s: number; label: string }[] = [
  { s: 0, label: 'Never' },
  { s: 30, label: '30 s' },
  { s: 60, label: '1 min' },
  { s: 120, label: '2 min' },
  { s: 300, label: '5 min' },
  { s: 600, label: '10 min' },
  { s: 1800, label: '30 min' },
  { s: 3600, label: '1 hour' },
];

const SCREEN_SAVERS: { key: NonNullable<Settings['screenSaver']>; label: string }[] = [
  { key: 'off', label: 'Off: the screen goes dark' },
  { key: 'time', label: 'The time' },
  { key: 'date', label: 'The date' },
  { key: 'both', label: 'The time and date' },
];

/** Every IANA zone the browser knows, UTC first (none: only the browser's own). */
function zoneNames(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const all = intl.supportedValuesOf?.('timeZone') ?? [browserTimeZone()].filter((z): z is string => !!z);
  return all.filter((z) => z !== 'UTC');
}

/** "UTC+01:00" for an offset in seconds east of UTC. */
function utcOffset(east: number): string {
  const a = Math.abs(east);
  const hh = String(Math.floor(a / 3600)).padStart(2, '0');
  const mm = String(Math.floor((a % 3600) / 60)).padStart(2, '0');
  return `UTC${east < 0 ? '-' : '+'}${hh}:${mm}`;
}

type SettingsPatch = Omit<Partial<Settings>, 'brightness'> & {
  brightness?: Partial<NonNullable<Settings['brightness']>>;
};

export function SettingsDrawer(props: {
  layout: Layout;
  /** The display can dim its backlight (hello.capabilities.backlight). */
  backlight: boolean;
  /** The display can turn its picture (hello.capabilities.rotation). */
  canRotate: boolean;
  paths: PathInfo[];
  values: Map<string, unknown>;
  onChange(patch: SettingsPatch): void;
  onClose(): void;
}) {
  const s = props.layout.settings ?? {};
  const day = s.brightness?.day ?? SETTINGS_DEFAULTS.brightnessDay;
  const night = s.brightness?.night ?? SETTINGS_DEFAULTS.brightnessNight;
  const timeout = s.screenTimeout ?? SETTINGS_DEFAULTS.screenTimeout;
  const auto = (s.autoTheme ?? SETTINGS_DEFAULTS.autoTheme) === 'sun';
  const sunPath = s.autoThemePath ?? SETTINGS_DEFAULTS.autoThemePath;
  const sunNow = props.values.get(sunPath);
  const zones = useMemo(zoneNames, []);
  const zone = s.timeZone;
  const nowUtc = Math.floor(Date.now() / 1000);
  const offset = zone ? localOffset(zone.posix, nowUtc) : 0;
  const saver = s.screenSaver ?? SETTINGS_DEFAULTS.screenSaver;
  const saverBrightness = s.screenSaverBrightness ?? SETTINGS_DEFAULTS.screenSaverBrightness;
  const clockPath = s.clockPath ?? SETTINGS_DEFAULTS.clockPath;
  const timeouts = TIMEOUTS.some((t) => t.s === timeout)
    ? TIMEOUTS
    : [...TIMEOUTS, { s: timeout, label: `${timeout} s` }].sort((a, b) => a.s - b.s);

  return (
    <Drawer title="Display settings" label="Display settings" onClose={props.onClose}>
      <p className="hint">Sent to the display with Save & send. They apply offline too.</p>

      <label className="field">
        <span>Mounted</span>
        <select
          value={s.rotation ?? SETTINGS_DEFAULTS.rotation}
          disabled={!props.canRotate && (s.rotation ?? 0) === 0}
          onChange={(e) => {
            const degrees = Number(e.target.value) as Rotation;
            props.onChange({ rotation: degrees === 0 ? undefined : degrees });
          }}
          aria-label="Rotation"
        >
          {ROTATIONS.map((r) => (
            <option key={r} value={r}>
              {r === 0 ? 'As built (0°)' : `Turned ${r}° clockwise`}
            </option>
          ))}
        </select>
        <small className={props.canRotate ? 'hint' : 'warn'}>
          {props.canRotate
            ? 'How the display is mounted: its picture is turned, and the pages are laid out for the turned screen.'
            : "This display can't turn its picture."}
        </small>
      </label>

      <fieldset className="settings-group">
        <legend>Brightness</legend>
        {!props.backlight && (
          <p className="warn">This display can't dim its backlight; brightness is ignored.</p>
        )}
        <label className="field">
          <span>
            Day theme <output>{day} %</output>
          </span>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={day}
            disabled={!props.backlight}
            onChange={(e) => props.onChange({ brightness: { day: Number(e.target.value) } })}
            aria-label="Day brightness"
          />
        </label>
        <label className="field">
          <span>
            Night theme <output>{night} %</output>
          </span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={night}
            disabled={!props.backlight}
            onChange={(e) => props.onChange({ brightness: { night: Number(e.target.value) } })}
            aria-label="Night brightness"
          />
        </label>
      </fieldset>

      <label className="field">
        <span>Start page</span>
        <select
          value={s.startPage ?? ''}
          onChange={(e) => props.onChange({ startPage: e.target.value || undefined })}
          aria-label="Start page"
        >
          <option value="">First page</option>
          {props.layout.pages.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}. {p.title ?? p.id}
            </option>
          ))}
        </select>
        <small className="hint">Shown when the display starts, and when you change it here.</small>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) =>
            props.onChange({ autoTheme: e.target.checked ? 'sun' : undefined })
          }
          aria-label="Auto day/night"
        />
        Auto day/night: the night theme at dusk and night
      </label>
      {auto && (
        <div className="settings-sub">
          <PathPicker
            label="Sun state path"
            path={sunPath}
            paths={props.paths}
            values={props.values}
            onPick={(path) =>
              props.onChange({
                autoThemePath: path && path !== SETTINGS_DEFAULTS.autoThemePath ? path : undefined,
              })
            }
          />
          <small className="hint">
            {typeof sunNow === 'string'
              ? `Now: ${sunNow}. `
              : 'No value yet: the derived-data plugin provides environment.sun. '}
            Without a value the display keeps the theme chosen above the page.
          </small>
        </div>
      )}

      <label className="field">
        <span>Screen off without a touch</span>
        <select
          value={String(timeout)}
          onChange={(e) => {
            const v = Number(e.target.value);
            props.onChange({ screenTimeout: v === 0 ? undefined : v });
          }}
          aria-label="Screen timeout"
        >
          {timeouts.map((t) => (
            <option key={t.s} value={t.s}>
              {t.label}
            </option>
          ))}
        </select>
        <small className="hint">
          The first touch only switches the screen on. A new alarm switches it on too. Use Never
          for a display you only look at.
        </small>
      </label>
      {timeout > 0 && (
        <div className="settings-sub">
          <label className="field">
            <span>Screen saver</span>
            <select
              value={saver}
              onChange={(e) =>
                props.onChange({ screenSaver: e.target.value === 'off' ? undefined : (e.target.value as Settings['screenSaver']) })
              }
              aria-label="Screen saver"
            >
              {SCREEN_SAVERS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <small className="hint">
              Instead of turning off, the screen shows the clock faintly. Until the display knows
              the time, it goes dark.
            </small>
          </label>
          {saver !== 'off' && props.backlight && (
            <label className="field">
              <span>
                Brightness while it shows <output>{saverBrightness} %</output>
              </span>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={saverBrightness}
                onChange={(e) => props.onChange({ screenSaverBrightness: Number(e.target.value) })}
                aria-label="Screen saver brightness"
              />
            </label>
          )}
        </div>
      )}

      <fieldset className="settings-group">
        <legend>Clock</legend>
        <label className="field">
          <span>Time zone</span>
          <select
            value={zone?.name ?? ''}
            onChange={(e) =>
              props.onChange({ timeZone: e.target.value ? timeZoneSetting(e.target.value) : undefined })
            }
            aria-label="Time zone"
          >
            <option value="">UTC</option>
            {zone && !zones.includes(zone.name) && <option value={zone.name}>{zone.name}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <small className="hint">
            Now {clockTime(nowUtc + offset, false, false).text} ({utcOffset(offset)}). The display
            follows summer time by itself, offline too. Clocks and the screen saver use it.
          </small>
        </label>
        <PathPicker
          label="Time from"
          path={clockPath}
          paths={props.paths}
          values={props.values}
          onPick={(path) =>
            props.onChange({
              clockPath: path && path !== SETTINGS_DEFAULTS.clockPath ? path : undefined,
            })
          }
        />
        <small className="hint">
          {typeof props.values.get(clockPath) === 'string'
            ? `Now: ${String(props.values.get(clockPath))}. `
            : 'No value yet: a GPS gives navigation.datetime. '}
          A display whose firmware has NTP or HomeAssistant time uses that when SignalK has none.
        </small>
      </fieldset>
    </Drawer>
  );
}
