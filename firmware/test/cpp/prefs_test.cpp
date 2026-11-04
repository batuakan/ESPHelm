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
  CHECK(text == "v=1;th=1;bd=-1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30");

  DisplayPrefs q;
  CHECK(esphelm::decode_prefs(text, q));
  CHECK(q.theme == 1 && q.brightness_day == -1 && q.brightness_night == 12);
  CHECK(q.base_theme == esphelm::Theme::DAY && q.base_day == 100 && q.base_night == 30);

  // Refused, and `out` left as it was.
  const char *bad[] = {
      "",
      "v=2;th=1;bd=-1;bn=12;Bt=0;Ba=0;Bd=100;Bn=30",   // unknown version
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

  // Another layout theme, or autoTheme switched on: the theme choice goes.
  k = q;
  CHECK(esphelm::reconcile_prefs(k, s, esphelm::Theme::NIGHT));
  CHECK(k.theme == -1 && k.brightness_night == 12);
  esphelm::Settings s3 = s;
  s3.auto_theme = esphelm::AutoTheme::SUN;
  k = q;
  CHECK(esphelm::reconcile_prefs(k, s3, esphelm::Theme::DAY));
  CHECK(k.theme == -1);

  // Nothing overridden: nothing to drop, whatever the layout says.
  DisplayPrefs e;
  CHECK(!esphelm::reconcile_prefs(e, s2, esphelm::Theme::NIGHT));
  CHECK(e.empty());

  std::printf("%d failures\n", failures);
  return failures == 0 ? 0 : 1;
}
