#pragma once
// Clock text and time zones (ADR-0024), mirroring localOffset(), clockTime(), clockDate() and
// parseIsoUtc() in packages/schema/src/clock.ts; fixtures/clock.cases.json proves they agree.
// Pure C++ (no ESPHome or LVGL), so g++ tests it on the host. Times are Unix seconds; "local"
// seconds are Unix seconds plus the zone's offset. Nothing here allocates.

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <initializer_list>

namespace esphelm {
namespace wallclock {

/// How a clock writes the date (CLOCK_DATE_FORMATS in the schema).
enum class DateFormat : uint8_t { YMD, DMY, MDY, WEEKDAY };

/// Days since 1970-01-01 of a proleptic Gregorian date (month 1-12).
inline int64_t days_from_civil(int64_t y, int m, int d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const int64_t yoe = y - era * 400;
  const int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

/// The date of a day count since 1970-01-01.
inline void civil_from_days(int64_t z, int64_t &y, int &m, int &d) {
  z += 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const int64_t doe = z - era * 146097;
  const int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const int64_t mp = (5 * doy + 2) / 153;
  d = (int) (doy - (153 * mp + 2) / 5 + 1);
  m = (int) (mp < 10 ? mp + 3 : mp - 9);
  y = yoe + era * 400 + (m <= 2);
}

inline int64_t floor_div(int64_t a, int64_t b) { return a / b - ((a % b != 0) && ((a < 0) != (b < 0))); }
inline int weekday(int64_t days) { return (int) (((days + 4) % 7 + 7) % 7); }

/// The time of day at `local`: "14:05" (24 h) or "2:05" with `suffix` "PM" (12 h); with
/// `seconds`, ":09" appended. `out` needs 9 bytes.
inline void time_text(int64_t local, bool hour12, bool seconds, char *out, size_t n, const char *&suffix) {
  const int s = (int) ((local % 86400 + 86400) % 86400);
  const int h = s / 3600, m = s / 60 % 60, sec = s % 60;
  suffix = "";
  int hh = h;
  if (hour12) {
    hh = h % 12 == 0 ? 12 : h % 12;
    suffix = h < 12 ? "AM" : "PM";
  }
  if (seconds)
    std::snprintf(out, n, hour12 ? "%d:%02d:%02d" : "%02d:%02d:%02d", hh, m, sec);
  else
    std::snprintf(out, n, hour12 ? "%d:%02d" : "%02d:%02d", hh, m);
}

/// The date at `local`: 2026-11-04, 04.11.2026, 11/04/2026 or "Wed 4 Nov". `out` needs 16 bytes.
inline void date_text(int64_t local, DateFormat format, char *out, size_t n) {
  static const char *const WEEKDAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
  static const char *const MONTHS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  const int64_t days = floor_div(local, 86400);
  int64_t y;
  int m, d;
  civil_from_days(days, y, m, d);
  switch (format) {
    case DateFormat::DMY:
      std::snprintf(out, n, "%02d.%02d.%lld", d, m, (long long) y);
      break;
    case DateFormat::MDY:
      std::snprintf(out, n, "%02d/%02d/%lld", m, d, (long long) y);
      break;
    case DateFormat::WEEKDAY:
      std::snprintf(out, n, "%s %d %s", WEEKDAYS[weekday(days)], d, MONTHS[m - 1]);
      break;
    default:
      std::snprintf(out, n, "%lld-%02d-%02d", (long long) y, m, d);
  }
}

namespace detail {
inline bool digit(char c) { return c >= '0' && c <= '9'; }
inline bool alpha(char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }

/// `count` digits (1..max) at p as a number; advances p. False without one.
inline bool number(const char *&p, int max_digits, int &value, int &count) {
  value = 0;
  count = 0;
  while (digit(*p) && count < max_digits) {
    value = value * 10 + (*p++ - '0');
    count++;
  }
  return count > 0 && !digit(*p);
}

/// ":mm" groups (0..2) after an hour; adds them to `seconds`.
inline bool minutes(const char *&p, int &seconds) {
  for (int i = 0; i < 2 && *p == ':'; i++) {
    if (!digit(p[1]) || !digit(p[2]) || p[1] > '5' || digit(p[3]))
      return false;
    seconds += ((p[1] - '0') * 10 + (p[2] - '0')) * (i == 0 ? 60 : 1);
    p += 3;
  }
  return *p != ':';
}

/// "[+-]h[:mm[:ss]]" in seconds (west positive, as written): hours 0-24 for an offset,
/// or any 1-3 digits for a rule's time.
inline bool hms(const char *&p, bool rule_time, int &out) {
  int sign = 1;
  if (*p == '+' || *p == '-')
    sign = *p++ == '-' ? -1 : 1;
  int h, count;
  if (!number(p, rule_time ? 3 : 2, h, count) || (!rule_time && h > 24))
    return false;
  int s = h * 3600;
  if (!minutes(p, s))
    return false;
  out = sign * s;
  return true;
}

inline bool name(const char *&p) {
  if (*p == '<') {
    int n = 0;
    for (p++; *p != '>'; p++, n++) {
      const char c = *p;
      if (!(alpha(c) || digit(c) || c == '+' || c == '-') || n >= 10)
        return false;
    }
    p++;
    return n >= 1;
  }
  int n = 0;
  while (alpha(*p) && n <= 10) {
    p++;
    n++;
  }
  return n >= 3 && n <= 10;
}
}  // namespace detail

/// A rule's day: month 1-12, week 1-5 (5: the last), weekday 0-6 (Sunday 0), local time.
struct Rule {
  int month{0}, week{0}, weekday{0};
  int32_t time{7200};
};

/// A parsed POSIX TZ rule (the restricted form of POSIX_TZ_PATTERN). Offsets east of UTC.
struct Tz {
  int32_t std_offset{0};
  bool has_dst{false};
  int32_t dst_offset{0};
  Rule start, end;
};

/// Parses the restricted POSIX TZ form clock.ts writes and its POSIX_TZ_PATTERN accepts.
inline bool parse_tz(const char *posix, Tz &tz) {
  using namespace detail;
  tz = Tz{};
  const char *p = posix;
  int west;
  if (!name(p) || !hms(p, false, west))
    return false;
  tz.std_offset = 0 - west;
  if (*p == '\0')
    return true;
  if (!name(p))
    return false;
  tz.has_dst = true;
  tz.dst_offset = tz.std_offset + 3600;
  if (*p != ',') {
    if (!hms(p, false, west))
      return false;
    tz.dst_offset = 0 - west;
  }
  for (Rule *r : {&tz.start, &tz.end}) {
    int count;
    if (*p++ != ',' || *p++ != 'M' || *p == '0' || !number(p, 2, r->month, count) || r->month < 1 ||
        r->month > 12 || *p++ != '.' || !number(p, 1, r->week, count) || r->week < 1 || r->week > 5 ||
        *p++ != '.' || !number(p, 1, r->weekday, count) || r->weekday > 6)
      return false;
    if (*p == '/') {
      p++;
      int t;
      if (!hms(p, true, t))
        return false;
      r->time = t;
    }
  }
  return *p == '\0';
}

/// Days since the epoch of a rule's day in year `y`.
inline int64_t rule_day(int64_t y, const Rule &r) {
  const int64_t first = days_from_civil(y, r.month, 1);
  const int64_t next = r.month == 12 ? days_from_civil(y + 1, 1, 1) : days_from_civil(y, r.month + 1, 1);
  int64_t day = 1 + (r.weekday - weekday(first) + 7) % 7 + (r.week - 1) * 7;
  while (day > next - first)
    day -= 7;
  return first + day - 1;
}

/// Seconds east of UTC at Unix time `utc`.
inline int32_t offset(const Tz &tz, int64_t utc) {
  if (!tz.has_dst)
    return tz.std_offset;
  int64_t y;
  int m, d;
  civil_from_days(floor_div(utc + tz.std_offset, 86400), y, m, d);
  const int64_t start = rule_day(y, tz.start) * 86400 + tz.start.time - tz.std_offset;
  const int64_t end = rule_day(y, tz.end) * 86400 + tz.end.time - tz.dst_offset;
  const bool in_dst = start < end ? (utc >= start && utc < end) : (utc >= start || utc < end);
  return in_dst ? tz.dst_offset : tz.std_offset;
}

/// localOffset() of the TS copy: 0 for a rule it can't read.
inline int32_t local_offset(const char *posix, int64_t utc) {
  Tz tz;
  return parse_tz(posix, tz) ? offset(tz, utc) : 0;
}

/// Unix seconds of an ISO 8601 date-time with a zone ("2026-11-04T12:34:56.000Z", "+01:00",
/// "-0530"); fractions are dropped. False when it isn't one.
inline bool parse_iso_utc(const char *s, int64_t &out) {
  using detail::digit;
  auto two = [](const char *p, int &v) {
    if (!digit(p[0]) || !digit(p[1]))
      return false;
    v = (p[0] - '0') * 10 + (p[1] - '0');
    return true;
  };
  int y1, y2, mo, d, h, mi, sec;
  if (!two(s, y1) || !two(s + 2, y2) || s[4] != '-' || !two(s + 5, mo) || s[7] != '-' || !two(s + 8, d) ||
      s[10] != 'T' || !two(s + 11, h) || s[13] != ':' || !two(s + 14, mi) || s[16] != ':' || !two(s + 17, sec))
    return false;
  const char *p = s + 19;
  if (*p == '.') {
    if (!digit(*++p))
      return false;
    while (digit(*p))
      p++;
  }
  int zone = 0;
  if (*p == 'Z') {
    p++;
  } else if (*p == '+' || *p == '-') {
    const int sign = *p == '-' ? -1 : 1;
    int oh, om;
    if (!two(p + 1, oh))
      return false;
    p += 3;
    if (*p == ':')
      p++;
    if (!two(p, om) || oh > 23 || om > 59)
      return false;
    p += 2;
    zone = sign * (oh * 3600 + om * 60);
  } else {
    return false;
  }
  if (*p != '\0' || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 60)
    return false;
  out = days_from_civil(y1 * 100 + y2, mo, d) * 86400 + h * 3600 + mi * 60 + sec - zone;
  return true;
}

}  // namespace wallclock
}  // namespace esphelm
