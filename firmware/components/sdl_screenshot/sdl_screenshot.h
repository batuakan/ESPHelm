#pragma once
#include "esphome.h"
#include <SDL.h>


namespace esphome {
namespace sdl_screenshot {

class Screenshot : public Component {
 public:
  void loop() override {}
  void take_screenshot();
  /// Save to an explicit path (BMP), e.g. for scripted tests.
  void take_screenshot(const std::string &path);
 private:
  std::string generate_filename();
};

}  // namespace sdl_screenshot
}  // namespace esphome
