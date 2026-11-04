/**
 * Clock text and time zones (ADR-0024), the one definition shared by the editor preview and the
 * firmware (firmware/components/esphelm_runtime/esphelm_clock.h mirrors everything here except
 * posixTz; fixtures/clock.cases.json proves they agree). Times are Unix seconds (UTC); "local
 * seconds" are Unix seconds plus the zone's offset.
 *
 * Time zones travel as a restricted POSIX TZ rule (settings.timeZone.posix), so the display
 * follows summer time offline without a zone database:
 *   <+01>-1<+02>,M3.5.0/2,M10.5.0/3    standard name, offset (west positive), DST name, rules
 *   <+0530>-5:30                       no DST
 * Names are `<...>` quoted (numeric, as the tz database writes them) or 3+ letters ("UTC0").
 * Rules are Mm.w.d[/time]: month, week 1-5 (5: the last), weekday 0-6 (Sunday 0), local time.
 */

/** Matches every rule localOffset() understands; the settings schema uses it as its pattern. */
export const POSIX_TZ_PATTERN = (() => {
  const name = '(?:<[A-Za-z0-9+-]{1,10}>|[A-Za-z]{3,10})';
  const offset = '[+-]?(?:[01]?[0-9]|2[0-4])(?::[0-5][0-9]){0,2}';
  const rule = 'M(?:[1-9]|1[0-2])\\.[1-5]\\.[0-6](?:/[+-]?[0-9]{1,3}(?::[0-5][0-9]){0,2})?';
  return `^${name}${offset}(?:${name}(?:${offset})?,${rule},${rule})?$`;
})();

/** How a clock tile writes the date (ADR-0024). */
export const CLOCK_DATE_FORMATS = ['ymd', 'dmy', 'mdy', 'weekday'] as const;
export type ClockDateFormat = (typeof CLOCK_DATE_FORMATS)[number];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Days since 1970-01-01 of a proleptic Gregorian date (month 1-12). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date of a day count since 1970-01-01. */
export function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The time of day at `local` seconds: "14:05" (24 h, zero-padded hour) or "2:05" with suffix
 * "PM" (12 h); with `seconds`, ":09" appended. The suffix is separate so the device can draw
 * the digits in its digits-only fonts.
 */
export function clockTime(
  local: number,
  hour12: boolean,
  seconds: boolean,
): { text: string; suffix: string } {
  const s = ((Math.floor(local) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const tail = `${pad2(Math.floor(s / 60) % 60)}${seconds ? `:${pad2(s % 60)}` : ''}`;
  if (!hour12) return { text: `${pad2(h)}:${tail}`, suffix: '' };
  return { text: `${h % 12 === 0 ? 12 : h % 12}:${tail}`, suffix: h < 12 ? 'AM' : 'PM' };
}

/** The date at `local` seconds: 2026-11-04, 04.11.2026, 11/04/2026 or "Wed 4 Nov". */
export function clockDate(local: number, format: ClockDateFormat): string {
  const days = Math.floor(local / 86400);
  const { y, m, d } = civilFromDays(days);
  switch (format) {
    case 'dmy':
      return `${pad2(d)}.${pad2(m)}.${y}`;
    case 'mdy':
      return `${pad2(m)}/${pad2(d)}/${y}`;
    case 'weekday':
      return `${WEEKDAYS[(((days + 4) % 7) + 7) % 7]} ${d} ${MONTHS[m - 1]}`;
    default:
      return `${y}-${pad2(m)}-${pad2(d)}`;
  }
}

/**
 * Unix seconds of an ISO 8601 date-time with a zone (navigation.datetime:
 * "2026-11-04T12:34:56.000Z", or "+01:00"); fractions are dropped. null when it isn't one.
 */
export function parseIsoUtc(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(
    text,
  );
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  let offset = 0;
  const z = m[7] as string;
  if (z !== 'Z') {
    const oh = Number(z.slice(1, 3));
    const om = Number(z.slice(-2));
    if (oh > 23 || om > 59) return null;
    offset = (z[0] === '-' ? -1 : 1) * (oh * 3600 + om * 60);
  }
  return daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s - offset;
}

interface TzRule {
  month: number;
  week: number;
  weekday: number;
  time: number; // seconds after local midnight
}

interface Tz {
  std: number; // seconds east of UTC
  dst?: { offset: number; start: TzRule; end: TzRule };
}

/** "[+-]h[:mm[:ss]]" in seconds. */
function parseHms(text: string): number {
  const sign = text.startsWith('-') ? -1 : 1;
  const [h = 0, m = 0, s = 0] = text.replace(/^[+-]/, '').split(':').map(Number);
  return sign * (h * 3600 + m * 60 + s);
}

function parseTz(posix: string): Tz | null {
  if (!new RegExp(POSIX_TZ_PATTERN).test(posix)) return null;
  const name = '(?:<[^>]*>|[A-Za-z]+)';
  const off = '([+-]?[0-9:]+)';
  const m = new RegExp(`^${name}${off}(?:${name}${off}?,([^,]+),([^,]+))?$`).exec(posix);
  if (!m) return null;
  const std = 0 - parseHms(m[1] as string); // not -x: no -0
  if (m[3] === undefined) return { std };
  const rule = (r: string): TzRule => {
    const [date, time] = r.slice(1).split('/') as [string, string | undefined];
    const [month, week, weekday] = date.split('.').map(Number) as [number, number, number];
    return { month, week, weekday, time: time === undefined ? 7200 : parseHms(time) };
  };
  return {
    std,
    dst: {
      offset: m[2] === undefined ? std + 3600 : 0 - parseHms(m[2]),
      start: rule(m[3]),
      end: rule(m[4] as string),
    },
  };
}

/** Days since the epoch of a rule's day in year `y`. */
function ruleDay(y: number, r: TzRule): number {
  const first = daysFromCivil(y, r.month, 1);
  const firstWeekday = (((first + 4) % 7) + 7) % 7;
  let day = 1 + ((r.weekday - firstWeekday + 7) % 7) + (r.week - 1) * 7;
  const next = r.month === 12 ? daysFromCivil(y + 1, 1, 1) : daysFromCivil(y, r.month + 1, 1);
  while (day > next - first) day -= 7;
  return first + day - 1;
}

/** Seconds east of UTC at Unix time `utc` under a POSIX TZ rule; 0 for one it can't read. */
export function localOffset(posix: string, utc: number): number {
  const tz = parseTz(posix);
  if (tz === null) return 0;
  if (tz.dst === undefined) return tz.std;
  const { y } = civilFromDays(Math.floor((utc + tz.std) / 86400));
  const start = ruleDay(y, tz.dst.start) * 86400 + tz.dst.start.time - tz.std;
  const end = ruleDay(y, tz.dst.end) * 86400 + tz.dst.end.time - tz.dst.offset;
  const inDst = start < end ? utc >= start && utc < end : utc >= start || utc < end;
  return inDst ? tz.dst.offset : tz.std;
}

/** True for a rule localOffset() reads. */
export function isPosixTz(posix: string): boolean {
  return parseTz(posix) !== null;
}

// ---- Building a rule from an IANA zone (the editor; needs Intl with time zone support) ----

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Seconds east of UTC in IANA zone `zone` at Unix time `utc`, from Intl. */
export function intlOffset(zone: string, utc: number): number {
  let format = formatters.get(zone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    formatters.set(zone, format);
  }
  const text =
    format.formatToParts(new Date(utc * 1000)).find((p) => p.type === 'timeZoneName')?.value ??
    'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0));
}

/** "-1", "5:30", "+0" style POSIX offset of `east` seconds east of UTC. */
function posixOffset(east: number): string {
  const west = -east;
  const a = Math.abs(west);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  return `${west < 0 ? '-' : ''}${h}${m ? `:${pad2(m)}` : ''}`;
}

/** "<+01>", "<+0530>", "<-03>": the tz database's numeric name for an offset. */
function posixName(east: number): string {
  const a = Math.abs(east);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  return `<${east < 0 ? '-' : '+'}${pad2(h)}${m ? pad2(m) : ''}>`;
}

/** The rule "Mm.w.d/time" of a transition at `utc`, in local time with `offset` before it. */
function posixRule(utc: number, offset: number): string {
  const local = utc + offset;
  const days = Math.floor(local / 86400);
  const { y, m, d } = civilFromDays(days);
  const monthDays =
    (m === 12 ? daysFromCivil(y + 1, 1, 1) : daysFromCivil(y, m + 1, 1)) - daysFromCivil(y, m, 1);
  const week = d > monthDays - 7 ? 5 : Math.ceil(d / 7);
  const weekday = (((days + 4) % 7) + 7) % 7;
  const t = local - days * 86400;
  const h = Math.floor(t / 3600);
  const min = Math.floor((t % 3600) / 60);
  return `M${m}.${week}.${weekday}${t === 7200 ? '' : `/${h}${min ? `:${pad2(min)}` : ''}`}`;
}

/** The instant (to the minute) in (lo, hi] where the offset changes from the one at lo. */
function findTransition(zone: string, lo: number, hi: number): number {
  const before = intlOffset(zone, lo);
  while (hi - lo > 60) {
    const mid = Math.floor((lo + hi) / 120) * 60;
    if (intlOffset(zone, mid) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * A POSIX TZ rule for IANA zone `zone`, built from Intl's offsets in `year`. A zone with no
 * change that year gets its fixed offset; one with two changes gets a DST rule if that rule
 * reproduces the whole year, else (zones whose rules don't fit POSIX) the offset at `now`.
 */
export function posixTz(zone: string, year: number, now = Date.now() / 1000): string {
  const startOfYear = daysFromCivil(year, 1, 1) * 86400;
  const changes: number[] = [];
  let prev = intlOffset(zone, startOfYear);
  for (let day = 1; day <= 366; day++) {
    const t = startOfYear + day * 86400;
    const o = intlOffset(zone, t);
    if (o !== prev) changes.push(findTransition(zone, t - 86400, t));
    prev = o;
  }
  const fixed = (east: number) => `${posixName(east)}${posixOffset(east)}`;
  if (changes.length !== 2)
    return fixed(intlOffset(zone, changes.length === 0 ? startOfYear : now));
  const [a, b] = changes as [number, number];
  const offA = intlOffset(zone, a); // in effect after the first change
  const offB = intlOffset(zone, b);
  // DST is the larger offset; the year starts in standard time in the north, in DST in the south.
  const [std, dst, start, end] = offA > offB ? [offB, offA, a, b] : [offA, offB, b, a];
  const rule = `${fixed(std)}${posixName(dst)}${dst === std + 3600 ? '' : posixOffset(dst)},${posixRule(start, std)},${posixRule(end, dst)}`;
  for (let day = 0; day < 366; day++) {
    const t = startOfYear + day * 86400 + 43200;
    if (localOffset(rule, t) !== intlOffset(zone, t)) return fixed(intlOffset(zone, now));
  }
  return rule;
}
