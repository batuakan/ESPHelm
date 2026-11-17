#pragma once
// Values in a mono tile's corners, outside its round drawing: the wind rose's corner slots
// (ADR-0039). A copy of the colour set's CornerValues
// (esphelm_tiles_color/widget_common.h) that uses the core's helpers only, so this set does not
// depend on the colour one. Each is a value over its caption (label and unit).

#include <string>
#include <vector>

#include "mono_common.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

class CornerValues {
 public:
  /// A value in `corner` (0 top left, 1 top right, 2 bottom left, 3 bottom right) of `cell`.
  void add(lv_obj_t *cell, int corner, const esphelm::DataItem &item, const WidgetEnv &env);
  bool empty() const { return corners_.empty(); }
  void paths(std::vector<std::string> &out) const;
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now);
  /// Shows new values (throttled) and "--" once a value goes stale.
  void tick(uint32_t now);
  /// Shows each value (in the label font, else the small one) whose box clears the circle of
  /// radius `r` around the middle of the w x h cell; hides it when it doesn't or when !allowed.
  /// A drawing open at the bottom (the engine tile) passes `open_below` >= 0: a bottom corner's box
  /// whose top is at least that far under the centre need only clear radius `open_r`.
  void layout(int32_t w, int32_t h, double r, bool allowed, double open_below = -1, double open_r = 0);

 private:
  struct Corner {
    Binding b;
    int corner{0};
    lv_obj_t *box{nullptr};  // the value over its caption
    lv_obj_t *value{nullptr};
    lv_obj_t *caption{nullptr};
    std::string shown{"--"};
  };
  std::vector<Corner> corners_;
  Colors colors_;
  Fonts fonts_;
};

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
