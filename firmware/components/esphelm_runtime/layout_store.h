#pragma once
// Persists the current and last-known-good layout (ADR-0002).
// ESP-IDF: one NVS blob per slot in namespace "esphelm". Host (SDL): one file per slot.
// Each record is self-checking (magic, length, CRC32), so a torn or corrupted write is
// detected on load and the record is ignored.

#include <cstdint>
#include <string>

namespace esphome {
namespace esphelm_runtime {

enum class Slot : uint8_t { CURRENT, LAST_KNOWN_GOOD };

struct StoredLayout {
  std::string etag;
  std::string body;
};

class LayoutStore {
 public:
  /// Host only: directory for the slot files.
  void set_dir(const std::string &dir) { this->dir_ = dir; }

  bool load(Slot slot, StoredLayout &out);
  bool save(Slot slot, const StoredLayout &layout);

  static uint32_t crc32(const uint8_t *data, size_t len, uint32_t crc = 0);

 protected:
  static std::string encode(const StoredLayout &layout);
  static bool decode(const std::string &record, StoredLayout &out);

  std::string dir_{"."};
};

}  // namespace esphelm_runtime
}  // namespace esphome
