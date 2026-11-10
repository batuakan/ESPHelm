#pragma once
// Sound on displays with a speaker (ADR-0033): alarm tones and touch clicks, played by ESPHome's
// rtttl component (on an i2s_audio speaker, or any output it supports). Not a widget: it belongs
// to the runtime. What plays when is esphelm_sound.h (shared with packages/schema/src/sound.ts);
// this class only drives rtttl. Main loop only. Compiled only with `sound:` in the YAML
// (USE_ESPHELM_SOUND). Memory: the five tune strings and a few words of state.

#include "esphome/core/defines.h"

#ifdef USE_ESPHELM_SOUND

#include <cstdint>
#include <string>

#include "esphome/components/rtttl/rtttl.h"
#ifdef USE_SPEAKER
#include "esphome/components/speaker/speaker.h"
#endif
#include "esphelm_sound.h"

namespace esphome {
namespace esphelm_runtime {

class SoundPlayer {
 public:
  void set_rtttl(rtttl::Rtttl *rtttl) { this->rtttl_ = rtttl; }
#ifdef USE_SPEAKER
  void set_speaker(speaker::Speaker *speaker) { this->speaker_ = speaker; }
#endif
  /// The RTTTL tune of a level (ALERT .. EMERGENCY), or the touch click (NONE).
  void set_tune(esphelm::sound::Level level, const std::string &tune) {
    this->tunes_[static_cast<int>(level)] = tune;
  }

  /// Volume in % (10..100), applied to the speaker (or rtttl's gain without one).
  void set_volume(int percent);
  void set_touch(bool on) { this->touch_ = on; }

  /// The worst unacknowledged notification asking for sound, the banner's sound generation and
  /// whether the server's values are live; starts, repeats or stops the alarm tune.
  void tick(esphelm::sound::Level level, uint32_t generation, bool online, uint32_t now);
  /// A touch on something that reacts to it; skipped while an alarm tune plays or when off.
  /// `force`: play even with touch sounds off (the volume slider's preview).
  void click(bool force = false);

 protected:
  bool playing_() { return this->rtttl_ != nullptr && this->rtttl_->is_playing(); }

  rtttl::Rtttl *rtttl_{nullptr};
#ifdef USE_SPEAKER
  speaker::Speaker *speaker_{nullptr};
#endif
  std::string tunes_[5];  // click, alert, warn, alarm, emergency
  bool touch_{true};
  int volume_{-1};
  esphelm::sound::Level alarm_{esphelm::sound::Level::NONE};  // the alarm tune started last
  uint32_t played_generation_{0};
  uint32_t last_start_ms_{0};
};

}  // namespace esphelm_runtime
}  // namespace esphome

#endif  // USE_ESPHELM_SOUND
