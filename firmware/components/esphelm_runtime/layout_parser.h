#pragma once
// Bounded parser and validator for untrusted layout JSON (schema v1).
//
// Reports the same error codes and JSON pointers as validateLayout() in packages/schema
// (verified against every fixture by firmware/test/parser.cpp.test.ts), with two documented
// differences: unknown fields are ignored (forward compatibility within a major), and the
// device-only codes INVALID_JSON and CAPACITY_EXCEEDED exist.
//
// Pure C++ on top of ArduinoJson; no ESPHome or LVGL dependencies.

#include <cstddef>
#include <string>
#include <vector>

#include <ArduinoJson.h>

#include "layout_model.h"

namespace esphelm {

/// Device capacity guards (there are no size limits in the schema itself).
struct ParserLimits {
  size_t max_bytes{64 * 1024};
  size_t max_string{128};
  uint8_t max_nesting{12};
  size_t max_errors{16};
};

struct ParseError {
  std::string pointer;
  const char *code;
};

struct ParseResult {
  bool ok{false};
  Layout layout;
  std::vector<ParseError> errors;
};

/// Parse and validate `len` bytes of JSON. `allocator` (optional) places the temporary
/// JsonDocument, e.g. in PSRAM; the document is freed before returning.
ParseResult parse_layout(const char *data, size_t len, const ParserLimits &limits = {},
                         ArduinoJson::Allocator *allocator = nullptr);

}  // namespace esphelm
