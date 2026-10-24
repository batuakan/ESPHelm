// Host test: the generated C++ unit table must reproduce fixtures/units.cases.json,
// exactly like the TS implementation does (see test/units.test.ts).
#include <cmath>
#include <cstdio>

#include "esphelm_units.h"
#include "units_cases.h"

using namespace esphelm::units;

int main() {
  int failures = 0;
  int count = 0;
  for (const auto &c : UNIT_CASES) {
    ++count;
    const UnitDef *u = find_unit(c.unit);
    if (u == nullptr) {
      std::printf("FAIL unknown unit %s\n", c.unit);
      ++failures;
      continue;
    }
    const double got = to_display(c.si, *u);
    const double tol = 1e-9 * std::fmax(1.0, std::fabs(c.expected));
    if (!(std::fabs(got - c.expected) <= tol)) {
      std::printf("FAIL %.17g SI -> %s: got %.17g expected %.17g\n", c.si, c.unit, got, c.expected);
      ++failures;
    }
  }
  if (find_unit("no-such-unit") != nullptr) {
    std::printf("FAIL find_unit returned a unit for an unknown id\n");
    ++failures;
  }
  std::printf("%d cases, %d failures\n", count, failures);
  return failures == 0 ? 0 : 1;
}
