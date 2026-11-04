#include "display_prefs.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace esphelm {

void DisplayPrefs::set_base(const Settings &s, Theme layout_theme) {
  this->base_theme = layout_theme;
  this->base_auto = s.auto_theme;
  this->base_day = s.brightness_day;
  this->base_night = s.brightness_night;
}

std::string encode_prefs(const DisplayPrefs &p) {
  char buf[96];
  std::snprintf(buf, sizeof(buf), "v=1;th=%d;bd=%d;bn=%d;Bt=%d;Ba=%d;Bd=%d;Bn=%d", p.theme, p.brightness_day,
                p.brightness_night, static_cast<int>(p.base_theme), static_cast<int>(p.base_auto), p.base_day,
                p.base_night);
  return buf;
}

/// "key=<int>" at `pos`, then ';' or the end; advances `pos`.
static bool field(const std::string &text, size_t &pos, const char *key, int lo, int hi, int &out) {
  const size_t n = std::strlen(key);
  if (text.compare(pos, n, key) != 0 || pos + n >= text.size() || text[pos + n] != '=')
    return false;
  pos += n + 1;
  const size_t start = pos;
  if (pos < text.size() && text[pos] == '-')
    pos++;
  const size_t digits = pos;
  while (pos < text.size() && pos - digits < 4 && text[pos] >= '0' && text[pos] <= '9')
    pos++;
  if (pos == digits || (pos < text.size() && text[pos] != ';'))
    return false;
  const int v = std::atoi(text.c_str() + start);
  if (v < lo || v > hi)
    return false;
  out = v;
  if (pos < text.size())
    pos++;  // ';'
  return true;
}

/// An override: -1, or lo..hi.
static bool override_ok(int v, int lo, int hi) { return v == -1 || (v >= lo && v <= hi); }

bool decode_prefs(const std::string &text, DisplayPrefs &out) {
  size_t pos = 0;
  int v, th, bd, bn, bt, ba, bday, bnight;
  if (!field(text, pos, "v", 1, 1, v) || !field(text, pos, "th", -1, 1, th) || !field(text, pos, "bd", -1, 100, bd) ||
      !field(text, pos, "bn", -1, 100, bn) || !field(text, pos, "Bt", 0, 1, bt) || !field(text, pos, "Ba", 0, 1, ba) ||
      !field(text, pos, "Bd", PREFS_MIN_DAY, 100, bday) || !field(text, pos, "Bn", PREFS_MIN_NIGHT, 100, bnight))
    return false;
  if (pos != text.size() || text.back() == ';' || !override_ok(bd, PREFS_MIN_DAY, 100) ||
      !override_ok(bn, PREFS_MIN_NIGHT, 100))
    return false;
  out.theme = static_cast<int8_t>(th);
  out.brightness_day = static_cast<int16_t>(bd);
  out.brightness_night = static_cast<int16_t>(bn);
  out.base_theme = static_cast<Theme>(bt);
  out.base_auto = static_cast<AutoTheme>(ba);
  out.base_day = static_cast<uint8_t>(bday);
  out.base_night = static_cast<uint8_t>(bnight);
  return true;
}

bool reconcile_prefs(DisplayPrefs &p, const Settings &s, Theme layout_theme) {
  bool dropped = false;
  if (p.theme >= 0 && (p.base_theme != layout_theme || p.base_auto != s.auto_theme)) {
    p.theme = -1;
    dropped = true;
  }
  if (p.brightness_day >= 0 && p.base_day != s.brightness_day) {
    p.brightness_day = -1;
    dropped = true;
  }
  if (p.brightness_night >= 0 && p.base_night != s.brightness_night) {
    p.brightness_night = -1;
    dropped = true;
  }
  // What is kept was chosen against values equal to this layout's.
  p.set_base(s, layout_theme);
  return dropped;
}

}  // namespace esphelm
