// Display settings (ADR-0015): carried by the layout and sent with Save & send, like the theme.
import { SETTINGS_DEFAULTS, type Layout, type Settings } from '@esphelm/schema';
import type { PathInfo } from '../api';
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

type SettingsPatch = Omit<Partial<Settings>, 'brightness'> & {
  brightness?: Partial<NonNullable<Settings['brightness']>>;
};

export function SettingsDrawer(props: {
  layout: Layout;
  /** The display can dim its backlight (hello.capabilities.backlight). */
  backlight: boolean;
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
  const timeouts = TIMEOUTS.some((t) => t.s === timeout)
    ? TIMEOUTS
    : [...TIMEOUTS, { s: timeout, label: `${timeout} s` }].sort((a, b) => a.s - b.s);

  return (
    <Drawer title="Display settings" label="Display settings" onClose={props.onClose}>
      <p className="hint">Sent to the display with Save & send. They apply offline too.</p>

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
    </Drawer>
  );
}
