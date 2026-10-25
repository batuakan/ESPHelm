#include "layout_store.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "esphome/core/log.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <nvs.h>
#include <nvs_flash.h>
#endif

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.store";

// Record layout: magic(4) | body_len(4) | crc32(4, over etag_len..body) | etag_len(1) | etag | body
static const uint32_t MAGIC = 0x4C484845;  // "EHHL"
static const size_t HEADER = 13;

static const char *slot_key(Slot slot) {
  switch (slot) {
    case Slot::CURRENT:
      return "cur";
    case Slot::LAST_KNOWN_GOOD:
      return "lkg";
    default:
      return "boot";
  }
}

static void put_u32(std::string &s, uint32_t v) {
  for (int i = 0; i < 4; i++)
    s.push_back(static_cast<char>((v >> (8 * i)) & 0xFF));
}

static uint32_t get_u32(const std::string &s, size_t at) {
  uint32_t v = 0;
  for (int i = 0; i < 4; i++)
    v |= static_cast<uint32_t>(static_cast<uint8_t>(s[at + i])) << (8 * i);
  return v;
}

uint32_t LayoutStore::crc32(const uint8_t *data, size_t len, uint32_t crc) {
  crc = ~crc;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int k = 0; k < 8; k++)
      crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

std::string LayoutStore::encode(const StoredLayout &layout) {
  std::string payload;
  const size_t etag_len = std::min<size_t>(layout.etag.size(), 255);
  payload.push_back(static_cast<char>(etag_len));
  payload.append(layout.etag, 0, etag_len);
  payload.append(layout.body);
  std::string record;
  record.reserve(HEADER - 1 + payload.size());
  put_u32(record, MAGIC);
  put_u32(record, static_cast<uint32_t>(layout.body.size()));
  put_u32(record, crc32(reinterpret_cast<const uint8_t *>(payload.data()), payload.size()));
  record.append(payload);
  return record;
}

bool LayoutStore::decode(const std::string &record, StoredLayout &out) {
  if (record.size() < HEADER || get_u32(record, 0) != MAGIC)
    return false;
  const uint32_t body_len = get_u32(record, 4);
  const uint32_t crc = get_u32(record, 8);
  const size_t etag_len = static_cast<uint8_t>(record[12]);
  if (record.size() != HEADER + etag_len + body_len)
    return false;
  if (crc32(reinterpret_cast<const uint8_t *>(record.data()) + 12, record.size() - 12) != crc)
    return false;
  out.etag.assign(record, HEADER, etag_len);
  out.body.assign(record, HEADER + etag_len, body_len);
  return true;
}

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF

bool LayoutStore::load(Slot slot, StoredLayout &out) {
  nvs_handle_t handle;
  if (nvs_open("esphelm", NVS_READONLY, &handle) != ESP_OK)
    return false;
  size_t len = 0;
  bool ok = false;
  if (nvs_get_blob(handle, slot_key(slot), nullptr, &len) == ESP_OK && len > 0) {
    std::string record(len, '\0');
    if (nvs_get_blob(handle, slot_key(slot), &record[0], &len) == ESP_OK) {
      ok = decode(record, out);
      if (!ok)
        ESP_LOGW(TAG, "Stored %s layout is corrupted; ignoring it", slot_key(slot));
    }
  }
  nvs_close(handle);
  return ok;
}

bool LayoutStore::save(Slot slot, const StoredLayout &layout) {
  nvs_handle_t handle;
  esp_err_t err = nvs_open("esphelm", NVS_READWRITE, &handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "nvs_open failed: %s", esp_err_to_name(err));
    return false;
  }
  const std::string record = encode(layout);
  err = nvs_set_blob(handle, slot_key(slot), record.data(), record.size());
  if (err == ESP_OK)
    err = nvs_commit(handle);
  nvs_close(handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Saving %s layout (%u bytes) failed: %s", slot_key(slot), (unsigned) record.size(),
             esp_err_to_name(err));
    return false;
  }
  return true;
}

#else  // host (SDL) build: files in the working directory

bool LayoutStore::load(Slot slot, StoredLayout &out) {
  const std::string path = this->dir_ + "/esphelm_" + slot_key(slot) + ".bin";
  FILE *f = std::fopen(path.c_str(), "rb");
  if (f == nullptr)
    return false;
  std::string record;
  char buf[4096];
  size_t n;
  while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0)
    record.append(buf, n);
  std::fclose(f);
  if (!decode(record, out)) {
    ESP_LOGW(TAG, "Stored %s layout is corrupted; ignoring it", slot_key(slot));
    return false;
  }
  return true;
}

bool LayoutStore::save(Slot slot, const StoredLayout &layout) {
  const std::string path = this->dir_ + "/esphelm_" + slot_key(slot) + ".bin";
  const std::string tmp = path + ".tmp";
  const std::string record = encode(layout);
  FILE *f = std::fopen(tmp.c_str(), "wb");
  if (f == nullptr)
    return false;
  const bool written = std::fwrite(record.data(), 1, record.size(), f) == record.size();
  const bool closed = std::fclose(f) == 0;
  if (!written || !closed || std::rename(tmp.c_str(), path.c_str()) != 0) {
    ESP_LOGE(TAG, "Saving %s layout to %s failed", slot_key(slot), path.c_str());
    return false;
  }
  return true;
}

#endif

}  // namespace esphelm_runtime
}  // namespace esphome
