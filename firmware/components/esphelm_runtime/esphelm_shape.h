#pragma once
// Screen shapes (ADR-0028), as displayShape() in packages/schema/src/shape.ts; both reproduce
// packages/schema/fixtures/shape.cases.json. Plain C++, so packages/schema/test checks it with g++.

#include <cstdint>

#include "esphelm_sizes.h"

namespace esphelm {

enum class Shape : uint8_t { SQUARE, LANDSCAPE, PORTRAIT };
static const int SHAPE_COUNT = 3;
/// The layout's names, by Shape.
static const char *const SHAPE_NAMES[SHAPE_COUNT] = {"square", "landscape", "portrait"};

/// The shape of a width x height screen: 480x480 and 800x720 are square, 1280x800 landscape.
inline Shape display_shape(int32_t width, int32_t height) {
  const int64_t w = width, h = height;
  if (w * 100 >= h * sizes::SHAPE_RATIO_PERCENT)
    return Shape::LANDSCAPE;
  if (h * 100 >= w * sizes::SHAPE_RATIO_PERCENT)
    return Shape::PORTRAIT;
  return Shape::SQUARE;
}

}  // namespace esphelm
