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
  this->base_volume = s.sound_volume;
  this->base_touch = s.sound_touch;
}

std::string encode_prefs(const DisplayPrefs &p) {
  char buf[128];
  std::snprintf(buf, sizeof(buf), "v=2;th=%d;bd=%d;bn=%d;vo=%d;to=%d;Bt=%d;Ba=%d;Bd=%d;Bn=%d;Bv=%d;Bo=%d", p.theme,
                p.brightness_day, p.brightness_night, p.volume, p.touch, static_cast<int>(p.base_theme),
                static_cast<int>(p.base_auto), p.base_day, p.base_night, p.base_volume, p.base_touch ? 1 : 0);
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
  int vo = -1, to = -1, bv = out.base_volume, bo = out.base_touch ? 1 : 0;
  if (!field(text, pos, "v", 1, 2, v) || !field(text, pos, "th", -1, 1, th) || !field(text, pos, "bd", -1, 100, bd) ||
      !field(text, pos, "bn", -1, 100, bn))
    return false;
  if (v == 2 && (!field(text, pos, "vo", -1, 100, vo) || !field(text, pos, "to", -1, 1, to)))
    return false;
  if (!field(text, pos, "Bt", 0, 1, bt) || !field(text, pos, "Ba", 0, 1, ba) ||
      !field(text, pos, "Bd", PREFS_MIN_DAY, 100, bday) || !field(text, pos, "Bn", PREFS_MIN_NIGHT, 100, bnight))
    return false;
  if (v == 2 && (!field(text, pos, "Bv", PREFS_MIN_VOLUME, 100, bv) || !field(text, pos, "Bo", 0, 1, bo)))
    return false;
  if (pos != text.size() || text.back() == ';' || !override_ok(bd, PREFS_MIN_DAY, 100) ||
      !override_ok(bn, PREFS_MIN_NIGHT, 100) || !override_ok(vo, PREFS_MIN_VOLUME, 100))
    return false;
  out.theme = static_cast<int8_t>(th);
  out.brightness_day = static_cast<int16_t>(bd);
  out.brightness_night = static_cast<int16_t>(bn);
  out.volume = static_cast<int16_t>(vo);
  out.touch = static_cast<int8_t>(to);
  out.base_theme = static_cast<Theme>(bt);
  out.base_auto = static_cast<AutoTheme>(ba);
  out.base_day = static_cast<uint8_t>(bday);
  out.base_night = static_cast<uint8_t>(bnight);
  out.base_volume = static_cast<uint8_t>(bv);
  out.base_touch = bo == 1;
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
  if (p.volume >= 0 && p.base_volume != s.sound_volume) {
    p.volume = -1;
    dropped = true;
  }
  if (p.touch >= 0 && p.base_touch != s.sound_touch) {
    p.touch = -1;
    dropped = true;
  }
  // What is kept was chosen against values equal to this layout's.
  p.set_base(s, layout_theme);
  return dropped;
}

}  // namespace esphelm
