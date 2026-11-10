#pragma once
// When a display with a speaker plays an alarm tone (ADR-0033). Mirrors alarmSound() in
// packages/schema/src/sound.ts; fixtures/sound.cases.json proves they agree (sound.cpp.test.ts).
// Plain C++ (no ESPHome, no LVGL).

#include <cstdint>

namespace esphelm {
namespace sound {

/// SignalK alarm states above normal, in rising severity; NONE: nothing.
enum class Level : uint8_t { NONE, ALERT, WARN, ALARM, EMERGENCY };

/// How often a level's tune repeats, ms from the start of the last play: -1 once, 0 back to back.
inline int32_t repeat_ms(Level l) {
  switch (l) {
    case Level::ALARM:
      return 5000;
    case Level::EMERGENCY:
      return 0;
    default:
      return -1;
  }
}

struct Input {
  Level level{Level::NONE};  // worst notification asking for sound, not acknowledged
  uint32_t generation{0};    // counts up whenever a notification starts asking for sound
  bool online{true};         // the server's values are live
  Level playing{Level::NONE};  // the alarm tune playing now (a touch click does not count)
  uint32_t played_generation{0};
  uint32_t last_start_ms{0};
  uint32_t now_ms{0};
};

enum class Action : uint8_t { NONE, STOP, PLAY };

/// What to do now; with PLAY, `play` is the level whose tune to (re)start.
inline Action alarm_sound(const Input &i, Level &play) {
  play = Level::NONE;
  if (!i.online || i.level == Level::NONE)
    return i.playing != Level::NONE ? Action::STOP : Action::NONE;
  if (i.generation != i.played_generation) {
    play = i.level;
    return Action::PLAY;
  }
  if (i.playing != Level::NONE && i.playing > i.level)
    return Action::STOP;
  if (i.playing != Level::NONE)
    return Action::NONE;
  const int32_t repeat = repeat_ms(i.level);
  if (repeat < 0 || i.now_ms - i.last_start_ms < static_cast<uint32_t>(repeat))
    return Action::NONE;
  play = i.level;
  return Action::PLAY;
}

}  // namespace sound
}  // namespace esphelm
