// Host test of the display's saved choices (display_prefs.cpp, ADR-0025): the record round-trips,
// anything malformed or out of range is refused, and a layout with other values drops what was
// overridden. Prints "N failures"; run by prefs.cpp.test.ts.
#include <cstdio>
#include <string>

#include "display_prefs.h"

using esphelm::DisplayPrefs;

static int failures = 0;
#define CHECK(cond)                                              \
  do {                                                           \
    if (!(cond)) {                                               \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);        \
      failures++;                                                \
    }                                                            \
  } while (0)

int main() {
  esphelm::Settings s;  // day 100, night 30, autoTheme off
  DisplayPrefs p;
  CHECK(p.empty());
  p.theme = 1;
  p.brightness_night = 12;
  p.set_base(s, esphelm::Theme::DAY);
  const std::string text = esphelm::encode_prefs(p);
  CHECK(text == "v=3;th=1;ds=-1;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1");

  DisplayPrefs q;
  CHECK(esphelm::decode_prefs(text, q));
  CHECK(q.theme == 1 && q.brightness_day == -1 && q.brightness_night == 12);
  CHECK(q.base_theme == esphelm::Theme::DAY && q.base_day == 100 && q.base_night == 30);
  CHECK(q.volume == -1 && q.touch == -1 && q.base_volume == 60 && q.base_touch);
  CHECK(q.day_side == -1);

  // The dark theme (ADR-0034): chosen, as the day side, and as the layout's theme, round-trips.
  DisplayPrefs dp;
  dp.theme = static_cast<int8_t>(esphelm::Theme::DARK);
  dp.day_side = static_cast<int8_t>(esphelm::Theme::DARK);
  dp.set_base(s, esphelm::Theme::DARK);
  DisplayPrefs dq;
  CHECK(esphelm::encode_prefs(dp) == "v=3;th=2;ds=2;bd=-1;bn=-1;vo=-1;to=-1;Bt=2;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1");
  CHECK(esphelm::decode_prefs(esphelm::encode_prefs(dp), dq));
  CHECK(dq.theme == 2 && dq.day_side == 2 && dq.base_theme == esphelm::Theme::DARK && !dq.empty());
  DisplayPrefs only_side;
  only_side.day_side = static_cast<int8_t>(esphelm::Theme::DAY);
  CHECK(!only_side.empty());

  // Sound overrides round-trip.
  DisplayPrefs sp = p;
  sp.volume = 25;
  sp.touch = 0;
  DisplayPrefs sq;
  CHECK(esphelm::decode_prefs(esphelm::encode_prefs(sp), sq));
  CHECK(sq.volume == 25 && sq.touch == 0 && sq.theme == 1 && sq.brightness_night == 12);
  CHECK(!sq.empty());

  // A record saved before the dark theme (version 2) still reads, with no day side.
  DisplayPrefs v2;
  CHECK(esphelm::decode_prefs("v=2;th=1;bd=-1;bn=12;vo=25;to=0;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1", v2));
  CHECK(v2.theme == 1 && v2.day_side == -1 && v2.volume == 25 && v2.touch == 0);

  // A record saved before sound (version 1) still reads, with no sound overrides.
  DisplayPrefs old;
  CHECK(esphelm::decode_prefs("v=1;th=1;bd=-1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30", old));
  CHECK(old.theme == 1 && old.brightness_night == 12 && old.volume == -1 && old.touch == -1);

  // Refused, and `out` left as it was.
  const char *bad[] = {
      "",
      "v=4;th=1;ds=-1;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",  // unknown version
      "v=3;th=1;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",        // version 3 without ds
      "v=3;th=1;ds=1;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",   // night as the day side
      "v=3;th=3;ds=-1;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",  // no such theme
      "v=3;th=1;ds=-1;bd=-1;bn=12;vo=-1;to=-1;Bt=3;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",  // no such base theme
      "v=2;th=2;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",        // dark before version 3
      "v=2;th=1;bd=-1;bn=12;vo=-1;to=-1;Bt=2;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",        // dark base before version 3
      "v=2;th=1;bd=-1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30",   // version 2 without the sound fields
      "v=1;th=1;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",  // version 1 with them
      "v=2;th=1;bd=-1;bn=12;vo=9;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",   // volume below 10 %
      "v=2;th=1;bd=-1;bn=12;vo=-1;to=2;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1",   // touch not 0/1
      "v=2;th=1;bd=-1;bn=12;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=5;Bo=1",   // base volume below 10 %
      "v=1;th=2;bd=-1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30",   // no such theme
      "v=1;th=1;bd=4;bn=12;Bt=0;Ba=0;Bd=100;Bn=30",    // day below 5 %
      "v=1;th=1;bd=-1;bn=0;Bt=0;Ba=0;Bd=100;Bn=30",    // night 0 %
      "v=1;th=1;bd=-1;bn=101;Bt=0;Ba=0;Bd=100;Bn=30",  // over 100 %
      "v=1;th=1;bd=-1;bn=12;Bt=0;Ba=0;Bd=100",         // a field missing
      "v=1;th=1;bd=-1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30;",  // trailing ;
      "v=1;th=1;bd=-1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30;x=1",
      "v=1;bd=-1;th=1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30",   // order
      "v=1;th=1;bd=-1;bn=1x;Bt=0;Ba=0;Bd=100;Bn=30",
      "v=1;th=1;bd=-1;bn=99999;Bt=0;Ba=0;Bd=100;Bn=30",
      "v=1;th=1;bd=-;bn=12;Bt=0;Ba=0;Bd=100;Bn=30",
  };
  for (const char *b : bad) {
    DisplayPrefs r;
    r.theme = 0;
    if (esphelm::decode_prefs(b, r) || r.theme != 0) {
      std::printf("FAIL: accepted \"%s\"\n", b);
      failures++;
    }
  }

  // The same layout values: everything kept.
  DisplayPrefs k = q;
  CHECK(!esphelm::reconcile_prefs(k, s, esphelm::Theme::DAY));
  CHECK(k.theme == 1 && k.brightness_night == 12);

  // Another night brightness from the editor: that override goes, the theme choice stays.
  esphelm::Settings s2 = s;
  s2.brightness_night = 20;
  k = q;
  CHECK(esphelm::reconcile_prefs(k, s2, esphelm::Theme::DAY));
  CHECK(k.theme == 1 && k.brightness_night == -1 && k.base_night == 20);

  // Another layout theme, or autoTheme switched on: the theme choice and the day side go.
  k = q;
  k.day_side = static_cast<int8_t>(esphelm::Theme::DARK);
  CHECK(esphelm::reconcile_prefs(k, s, esphelm::Theme::NIGHT));
  CHECK(k.theme == -1 && k.day_side == -1 && k.brightness_night == 12);
  // A day side alone goes too.
  k = DisplayPrefs();
  k.day_side = static_cast<int8_t>(esphelm::Theme::DARK);
  k.set_base(s, esphelm::Theme::DAY);
  CHECK(esphelm::reconcile_prefs(k, s, esphelm::Theme::DARK));
  CHECK(k.day_side == -1 && k.empty());
  esphelm::Settings s3 = s;
  s3.auto_theme = esphelm::AutoTheme::SUN;
  k = q;
  CHECK(esphelm::reconcile_prefs(k, s3, esphelm::Theme::DAY));
  CHECK(k.theme == -1);

  // Another volume from the editor: the volume override goes, touch stays; then touch changes.
  DisplayPrefs so = sq;
  esphelm::Settings s4 = s;
  s4.sound_volume = 80;
  CHECK(esphelm::reconcile_prefs(so, s4, esphelm::Theme::DAY));
  CHECK(so.volume == -1 && so.touch == 0 && so.base_volume == 80);
  s4.sound_touch = false;
  CHECK(esphelm::reconcile_prefs(so, s4, esphelm::Theme::DAY));
  CHECK(so.touch == -1 && !so.base_touch);

  // Nothing overridden: nothing to drop, whatever the layout says.
  DisplayPrefs e;
  CHECK(!esphelm::reconcile_prefs(e, s2, esphelm::Theme::NIGHT));
  CHECK(e.empty());

  std::printf("%d failures\n", failures);
  return failures == 0 ? 0 : 1;
}
