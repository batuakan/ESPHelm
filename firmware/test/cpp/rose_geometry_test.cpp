// Host test of the mono wind rose's geometry (esphelm_rose_geometry.h, ADR-0039).
// Prints "N failures"; run by rose_geometry.cpp.test.ts.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>

#include "esphelm_rose_geometry.h"

static int failures = 0;
#define CHECK(cond)                                              \
  do {                                                           \
    if (!(cond)) {                                               \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);        \
      failures++;                                                \
    }                                                            \
  } while (0)

static bool near(double a, double b, double eps = 1e-6) { return std::fabs(a - b) < eps; }

int main() {
  using namespace esphelm::rose_geometry;

  // Angles run clockwise from the bow (up).
  CHECK(near(polar(100, 100, 50, 0).x, 100) && near(polar(100, 100, 50, 0).y, 50));
  CHECK(near(polar(100, 100, 50, 90).x, 150) && near(polar(100, 100, 50, 90).y, 100));
  CHECK(near(polar(100, 100, 50, 180).x, 100) && near(polar(100, 100, 50, 180).y, 150));
  CHECK(near(polar(100, 100, 50, 270).x, 50) && near(polar(100, 100, 50, 270).y, 100));

  // The radii of a 280 px rose are the ones of the mock-up the layout was agreed on.
  const Radii r280 = radii(280);
  CHECK(r280.sector_out == 138 && r280.sector_in == 127);
  CHECK(r280.tick_out == 124 && r280.tick_in == 117 && r280.tick_in_long == 114);
  CHECK(r280.band_out == 113 && r280.band_in == 92);
  CHECK(r280.marker_tip == 114 && r280.marker_half == 15);

  // For every size from 40 to 1200 px the parts stay in order, from the outside in, each at least
  // a pixel inside the one before, and inside the rose.
  for (int32_t d = 40; d <= 1200; d += 1) {
    const Radii o = radii(d);
    if (d >= 150)
      CHECK(o.sector_out <= d / 2);
    CHECK(o.sector_out > o.sector_in);
    CHECK(o.sector_in > o.tick_out);
    CHECK(o.tick_out > o.tick_in);
    CHECK(o.tick_in > o.tick_in_long);
    CHECK(o.tick_in_long > o.band_out);
    CHECK(o.band_out > o.band_in);
    CHECK(o.band_in > 0);
    CHECK(o.marker_tip >= o.band_out && o.marker_tip < o.sector_in);
    CHECK(o.marker_half >= 1);
    if (failures > 0)
      break;
  }

  // A marker's tip points at the centre and its base is square to the radius, on the outer edge.
  for (int deg = 0; deg < 360; deg += 15) {
    Point p[3];
    marker_corners(200, 150, 140, 114, 15, deg, p);
    const auto dist = [](Point a, double cx, double cy) { return std::hypot(a.x - cx, a.y - cy); };
    CHECK(near(dist(p[0], 200, 150), 114));
    CHECK(near(dist(p[1], 200, 150), std::hypot(140.0, 15.0)));
    CHECK(near(dist(p[2], 200, 150), std::hypot(140.0, 15.0)));
    CHECK(near(std::hypot(p[1].x - p[2].x, p[1].y - p[2].y), 30));
  }

  // Letters: A has three strokes, T two, W four; another letter none.
  Stroke s[MAX_STROKES];
  CHECK(letter('A', s) == 3);
  CHECK(letter('T', s) == 2);
  CHECK(letter('W', s) == 4);
  CHECK(letter('Q', s) == 0);

  // At the bow the letter stands upright: T's bar is level, above its stem.
  {
    letter('T', s);
    const Point bar1 = letter_point(s[0].x1, s[0].y1, 200, 100, 80, 0, 20);
    const Point bar2 = letter_point(s[0].x2, s[0].y2, 200, 100, 80, 0, 20);
    const Point top = letter_point(s[1].x1, s[1].y1, 200, 100, 80, 0, 20);
    const Point foot = letter_point(s[1].x2, s[1].y2, 200, 100, 80, 0, 20);
    CHECK(near(bar1.y, bar2.y) && bar2.x > bar1.x);
    CHECK(near(top.x, foot.x) && top.y < foot.y);  // y grows downwards on screen
    CHECK(near(bar1.y, top.y));
  }

  // At 90 degrees (east) its top points east, away from the centre, and its right side points down.
  {
    letter('T', s);
    const Point bar1 = letter_point(s[0].x1, s[0].y1, 200, 150, 100, 90, 20);
    const Point bar2 = letter_point(s[0].x2, s[0].y2, 200, 150, 100, 90, 20);
    const Point top = letter_point(s[1].x1, s[1].y1, 200, 150, 100, 90, 20);
    const Point foot = letter_point(s[1].x2, s[1].y2, 200, 150, 100, 90, 20);
    CHECK(near(bar1.x, bar2.x) && bar2.y > bar1.y);
    CHECK(near(top.y, foot.y) && top.x > foot.x);
  }

  // A marker is as big as its letter needs (13 px) on a 215 px rose, and keeps 11 % of the radius
  // on a big one; on a very small rose it is held to 14 % of the radius.
  CHECK(radii(215).marker_half == 13);
  CHECK(radii(280).marker_half == 15);
  CHECK(radii(150).marker_half == 10);
  CHECK(radii(600).marker_half == 33);

  // Compass labels: the cardinals and the four two-letter points, nothing else.
  {
    Stroke l[MAX_STROKES];
    CHECK(label("N", l) == 3);
    CHECK(label("E", l) == 4);
    CHECK(label("S", l) == 5);
    CHECK(label("W", l) == 4);
    CHECK(label("NE", l) == 7);
    CHECK(label("SE", l) == 9);
    CHECK(label("SW", l) == 9);
    CHECK(label("NW", l) == 7);
    CHECK(label("", l) == 0);
    CHECK(label("X", l) == 0);
    CHECK(label("NX", l) == 0);
    CHECK(label("NNE", l) == 0);

    // Every label stays in its frame (about 1 high, up to 1.5 wide) and is centred on the origin.
    for (const char *name : {"N", "E", "S", "W", "NE", "SE", "SW", "NW"}) {
      const int n = label(name, l);
      double lo_x = 1e9, hi_x = -1e9, lo_y = 1e9, hi_y = -1e9;
      for (int i = 0; i < n; i++) {
        for (double x : {l[i].x1, l[i].x2}) {
          lo_x = std::min(lo_x, x);
          hi_x = std::max(hi_x, x);
        }
        for (double y : {l[i].y1, l[i].y2}) {
          lo_y = std::min(lo_y, y);
          hi_y = std::max(hi_y, y);
        }
      }
      CHECK(near(lo_y, -0.5) && near(hi_y, 0.5));
      CHECK(near(lo_x + hi_x, 0.0));
      CHECK(hi_x - lo_x <= 1.5 + 1e-9);
    }
    // Two letters do not overlap: the first ends left of where the second begins.
    Stroke a[MAX_STROKES], b[MAX_STROKES];
    const int na = label("N", a), nb = label("NE", b);
    CHECK(na == 3 && nb == 7);
    double right_of_first = -1e9, left_of_second = 1e9;
    for (int i = 0; i < 3; i++)
      right_of_first = std::max({right_of_first, b[i].x1, b[i].x2});
    for (int i = 3; i < nb; i++)
      left_of_second = std::min({left_of_second, b[i].x1, b[i].x2});
    CHECK(right_of_first < left_of_second);
  }

  // The letter's centre sits at the given radius.
  {
    const Point c = letter_point(0, 0, 200, 150, 100, 37, 20);
    CHECK(near(std::hypot(c.x - 200, c.y - 150), 100));
  }

  std::printf("%d failures\n", failures);
  return failures == 0 ? 0 : 1;
}
