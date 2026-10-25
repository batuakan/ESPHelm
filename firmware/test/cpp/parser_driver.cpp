// Host driver for the firmware layout parser, used by firmware/test/parser.cpp.test.ts.
// Usage: parser_driver [--max-bytes N] [--max-string N] [--max-nesting N] file...
// Prints one JSON line per file: {"file":..., "ok":bool, "errors":[{"code":..,"pointer":..}],
// "pages":n, "tiles":n}.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "layout_parser.h"

int main(int argc, char **argv) {
  esphelm::ParserLimits limits;
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    auto next = [&](size_t &field) {
      if (i + 1 < argc)
        field = std::strtoul(argv[++i], nullptr, 10);
    };
    if (arg == "--max-bytes") {
      next(limits.max_bytes);
      continue;
    }
    if (arg == "--max-string") {
      next(limits.max_string);
      continue;
    }
    if (arg == "--max-nesting") {
      size_t n = limits.max_nesting;
      next(n);
      limits.max_nesting = static_cast<uint8_t>(n);
      continue;
    }

    std::ifstream in(arg, std::ios::binary);
    if (!in) {
      std::fprintf(stderr, "cannot read %s\n", arg.c_str());
      return 2;
    }
    std::stringstream ss;
    ss << in.rdbuf();
    const std::string data = ss.str();

    esphelm::ParseResult r = esphelm::parse_layout(data.data(), data.size(), limits);

    ArduinoJson::JsonDocument out;
    out["file"] = arg;
    out["ok"] = r.ok;
    ArduinoJson::JsonArray errors = out["errors"].to<ArduinoJson::JsonArray>();
    for (const auto &e : r.errors) {
      ArduinoJson::JsonObject o = errors.add<ArduinoJson::JsonObject>();
      o["code"] = e.code;
      o["pointer"] = e.pointer;
    }
    size_t tiles = 0;
    for (const auto &p : r.layout.pages)
      tiles += p.tiles.size();
    out["pages"] = r.layout.pages.size();
    out["tiles"] = tiles;
    serializeJson(out, std::cout);
    std::cout << "\n";
  }
  return 0;
}
