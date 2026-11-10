#include "sound.h"

#ifdef USE_ESPHELM_SOUND

#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.sound";

using esphelm::sound::Action;
using esphelm::sound::Level;

static const char *level_name(Level l) {
  switch (l) {
    case Level::ALERT:
      return "alert";
    case Level::WARN:
      return "warn";
    case Level::ALARM:
      return "alarm";
    case Level::EMERGENCY:
      return "emergency";
    default:
      return "click";
  }
}

void SoundPlayer::set_volume(int percent) {
  if (percent == this->volume_)
    return;
  this->volume_ = percent;
  ESP_LOGI(TAG, "Volume %d %%", percent);
#ifdef USE_SPEAKER
  if (this->speaker_ != nullptr) {
    this->speaker_->set_volume(percent / 100.0f);
    return;
  }
#endif
  if (this->rtttl_ != nullptr)
    this->rtttl_->set_gain(percent / 100.0f);
}

void SoundPlayer::tick(Level level, uint32_t generation, bool online, uint32_t now) {
  if (this->rtttl_ == nullptr)
    return;
  // The alarm tune ended (or a click replaced it) since the last look.
  if (this->alarm_ != Level::NONE && !this->playing_())
    this->alarm_ = Level::NONE;
  esphelm::sound::Input in;
  in.level = level;
  in.generation = generation;
  in.online = online;
  in.playing = this->alarm_;
  in.played_generation = this->played_generation_;
  in.last_start_ms = this->last_start_ms_;
  in.now_ms = now;
  Level play;
  switch (esphelm::sound::alarm_sound(in, play)) {
    case Action::STOP:
      ESP_LOGD(TAG, "Alarm tone stopped");
      this->rtttl_->stop();
      this->alarm_ = Level::NONE;
      break;
    case Action::PLAY:
      if (this->played_generation_ != generation)
        ESP_LOGI(TAG, "Alarm tone: %s", level_name(play));
      this->played_generation_ = generation;
      this->last_start_ms_ = now;
      this->alarm_ = play;
      // rtttl ignores play() while a tune (a click, or a milder alarm's) is playing.
      if (this->rtttl_->is_playing())
        this->rtttl_->stop();
      this->rtttl_->play(this->tunes_[static_cast<int>(play)]);
      break;
    case Action::NONE:
      break;
  }
}

void SoundPlayer::click(bool force) {
  if (this->rtttl_ == nullptr || (!this->touch_ && !force) || this->alarm_ != Level::NONE)
    return;
  this->rtttl_->play(this->tunes_[0]);
}

}  // namespace esphelm_runtime
}  // namespace esphome

#endif  // USE_ESPHELM_SOUND
