// The autopilot tile (ADR-0011). Shared helpers: widget_common.h.
#include "widget_common.h"

#include <algorithm>
#include <cstdlib>

#include "esphome/core/hal.h"
#include "esphelm_sizes.h"
#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.widget";

// Engage needs a second tap within this time (ADR-0011).
static const uint32_t ARM_MS = 3000;

static const char *mode_name(esphelm::AutopilotMode m) {
  switch (m) {
    case esphelm::AutopilotMode::WIND:
      return "wind";
    case esphelm::AutopilotMode::ROUTE:
      return "route";
    case esphelm::AutopilotMode::AUTO:
    default:
      return "auto";
  }
}

/// Display text for a steering.autopilot.state value.
static std::string state_title(const std::string &state) {
  if (state == "route")
    return "TRACK";
  std::string out;
  for (char c : state.substr(0, 12))
    out.push_back(c >= 'a' && c <= 'z' ? static_cast<char>(c - 'a' + 'A') : c);
  return out;
}

/// States in which the pilot is not steering (course changes would do nothing or surprise).
static bool disengaged(const std::string &state) {
  return state == "standby" || state == "off" || state == "disabled";
}

class AutopilotWidget : public Widget {
 public:
  AutopilotWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), put_(env.put), can_put_(env.can_put) {
    static const esphelm::AutopilotConfig DEFAULTS;
    const esphelm::AutopilotConfig &cfg = tile.autopilot ? *tile.autopilot : DEFAULTS;
    state_path_ = cfg.state_path;
    adjust_path_ = cfg.adjust_path;
    stale_ms_ = env.default_stale_ms;
    state_ms_ = millis();
    const esphelm::units::UnitDef *deg = esphelm::units::find_unit("deg");
    for (Binding *b : {&target_, &heading_}) {
      b->item.unit = deg;
      b->item.decimals = 0;
      b->stale_ms = env.default_stale_ms;
      b->last_value_ms = millis();
    }
    target_.item.path = cfg.target_path;
    heading_.item.path = cfg.heading_path;

    caption_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    state_label_ = make_label(cell, env.fonts.label, env.colors.muted, "--");
    course_label_ = make_label(cell, env.fonts.small, env.colors.muted, "TGT --   HDG --");
    note_label_ = make_label(cell, env.fonts.small, env.colors.muted, "");

    // Buttons exist in every tier but are only shown (and usable) in the controls tier.
    static const char *const ADJUST[] = {"-10", "-1", "+1", "+10"};
    for (const char *part : ADJUST)
      add_button_(part, part, Kind::ADJUST);
    for (esphelm::AutopilotMode m : cfg.modes)
      add_button_(mode_name(m), state_title(mode_name(m)), Kind::MODE);
    add_button_("standby", "STANDBY", Kind::STANDBY);
  }

  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {
    out.push_back(state_path_);
    out.push_back(target_.item.path);
    out.push_back(heading_.item.path);
  }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    controls_ = w >= esphelm::sizes::AUTOPILOT_CONTROLS_WIDTH && h >= esphelm::sizes::AUTOPILOT_CONTROLS_HEIGHT;
    narrow_ = w < esphelm::sizes::AUTOPILOT_CONTROLS_WIDTH;
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    // Status lines span the tile and centre their text, so they stay centred as the text changes.
    // The state takes the largest font in which its longest word fits (ADR-0017): with buttons up
    // to the value font in a third of the height, status only in what the other lines leave.
    const int32_t small_line = lv_font_get_line_height(fonts_.small);
    const lv_font_t *state_font =
        controls_ ? fit_font(fonts_, "STANDBY", w, h / 3, 1, fonts_.value)
                  : fit_font(fonts_, "STANDBY", w, h - 4 * small_line);
    lv_obj_set_style_text_font(state_label_, state_font, LV_PART_MAIN);
    for (lv_obj_t *l : {state_label_, course_label_, note_label_}) {
      lv_obj_set_width(l, w);
      lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
      lv_label_set_long_mode(l, LV_LABEL_LONG_MODE_DOTS);
    }
    const int32_t small_h = lv_font_get_line_height(fonts_.small);
    const int32_t state_h = lv_font_get_line_height(state_font);
    const int32_t caption_h = lv_label_get_text(caption_)[0] != '\0' ? small_h : 0;
    // TGT and HDG side by side, stacked when narrow, and HDG dropped when even that won't fit.
    show_heading_ = !narrow_ || caption_h + state_h + 3 * small_h <= h;
    const int32_t course_h = narrow_ && show_heading_ ? 2 * small_h : small_h;
    lv_obj_set_height(course_label_, course_h);
    course_shown_.clear();
    set_text(course_label_, course_shown_, course_text_("--", "--"));
    if (!controls_) {
      // Status only: nothing on this tile can command the pilot.
      for (auto &b : buttons_)
        lv_obj_add_flag(b.obj, LV_OBJ_FLAG_HIDDEN);
      const int32_t top = std::max(caption_h, (h - state_h - course_h - small_h) / 2);
      lv_obj_align(state_label_, LV_ALIGN_TOP_MID, 0, top);
      lv_obj_align(course_label_, LV_ALIGN_TOP_MID, 0, top + state_h);
      lv_obj_align(note_label_, LV_ALIGN_TOP_MID, 0, top + state_h + course_h);
      return;
    }
    lv_obj_align(state_label_, LV_ALIGN_TOP_MID, 0, 0);
    lv_obj_align(course_label_, LV_ALIGN_TOP_MID, 0, state_h);
    lv_obj_align(note_label_, LV_ALIGN_TOP_MID, 0, state_h + course_h);
    const int32_t status_h = state_h + course_h + small_h + 4;

    // Rows: the four course buttons; then the modes and STANDBY. STANDBY gets a row of its own
    // when its label would not fit a quarter of the width.
    const int32_t gap = 6;
    const size_t modes = buttons_.size() - 5;
    const int32_t quarter = (w - 3 * gap) / 4;
    lv_obj_update_layout(buttons_.back().label);
    const bool standby_row = lv_obj_get_width(buttons_.back().label) + 12 > quarter && modes > 0;
    const int32_t rows = standby_row ? 3 : 2;
    const int32_t btn_h = std::max<int32_t>(48, std::min<int32_t>(96, (h - status_h - rows * gap) / rows));
    for (size_t i = 0; i < buttons_.size(); i++) {
      int32_t row, n, k;
      if (i < 4) {
        row = 0, n = 4, k = static_cast<int32_t>(i);
      } else if (standby_row && i == buttons_.size() - 1) {
        row = 2, n = 1, k = 0;
      } else {
        row = 1, n = static_cast<int32_t>(standby_row ? modes : modes + 1), k = static_cast<int32_t>(i - 4);
      }
      const int32_t bw = (w - gap * (n - 1)) / n;
      lv_obj_remove_flag(buttons_[i].obj, LV_OBJ_FLAG_HIDDEN);  // hidden if the tile was small before
      lv_obj_set_size(buttons_[i].obj, bw, btn_h);
      lv_obj_align(buttons_[i].obj, LV_ALIGN_BOTTOM_LEFT, k * (bw + gap), -(rows - 1 - row) * (btn_h + gap));
    }
    dirty_ = true;
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == state_path_ && v.is<const char *>()) {
      state_ = v.as<const char *>();
      state_known_ = true;
      state_ms_ = now;
      if (pending_ && state_ == pending_state_)
        pending_ = false;
      dirty_ = true;
    }
    for (Binding *b : {&target_, &heading_}) {
      if (path == b->item.path)
        b->set(v, now);
    }
  }

  void tick(uint32_t now) override {
    if (armed_ >= 0 && now - armed_since_ >= ARM_MS) {
      ESP_LOGI(TAG, "Autopilot %s: arm expired (%s)", id_.c_str(), buttons_[armed_].part.c_str());
      armed_ = -1;
      dirty_ = true;
    }
    if (pending_ && now - pending_since_ >= PUT_CONFIRM_MS) {
      ESP_LOGW(TAG, "Autopilot %s: no confirmation for state %s", id_.c_str(), pending_state_.c_str());
      pending_ = false;
      failed_ = true;
      dirty_ = true;
    }
    const bool online = can_put_ && can_put_();
    const bool stale = !state_known_ || now - state_ms_ > stale_ms_;
    if (online != online_ || stale != stale_) {
      online_ = online;
      stale_ = stale;
      dirty_ = true;
    }
    bool s;
    if (target_.due(now, s) | heading_.due(now, s)) {
      const auto deg = [now](const Binding &b) {
        return b.has_number && now - b.last_value_ms <= b.stale_ms ? b.text + "\xC2\xB0" : std::string("--");
      };
      set_text(course_label_, course_shown_, course_text_(deg(target_), deg(heading_)));
    }
    if (!dirty_ || now - last_draw_ms_ < DRAW_INTERVAL_MS)
      return;
    dirty_ = false;
    last_draw_ms_ = now;
    redraw_();
  }

  void tap(const std::string &part) override {
    for (size_t i = 0; i < buttons_.size(); i++) {
      if (buttons_[i].part == part) {
        press_(i);
        return;
      }
    }
    ESP_LOGW(TAG, "Autopilot %s: no button \"%s\"", id_.c_str(), part.c_str());
  }

 protected:
  enum class Kind : uint8_t { ADJUST, MODE, STANDBY };
  struct Button {
    std::string part;
    std::string title;
    Kind kind;
    lv_obj_t *obj;
    lv_obj_t *label;
    std::string shown;
  };

  void add_button_(const std::string &part, const std::string &title, Kind kind) {
    lv_obj_t *btn = lv_button_create(cell_);
    lv_obj_set_style_radius(btn, 10, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(btn, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(btn, colors_.background, LV_PART_MAIN);
    // The default theme recolours disabled buttons grey, far too bright at night.
    lv_obj_set_style_recolor_opa(btn, LV_OPA_TRANSP, LV_STATE_DISABLED);
    lv_obj_set_style_bg_color(btn, colors_.background, LV_STATE_DISABLED);
    lv_obj_t *label = make_label(btn, fonts_.small, colors_.text, title);
    lv_obj_center(label);
    buttons_.push_back(Button{part, title, kind, btn, label, title});
    lv_obj_set_user_data(btn, reinterpret_cast<void *>(buttons_.size() - 1));
    lv_obj_add_event_cb(
        btn,
        [](lv_event_t *e) {
          auto *self = static_cast<AutopilotWidget *>(lv_event_get_user_data(e));
          auto *target = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
          self->press_(reinterpret_cast<uintptr_t>(lv_obj_get_user_data(target)));
        },
        LV_EVENT_CLICKED, this);
  }

  bool usable_(const Button &b) const {
    if (!controls_ || !online_)
      return false;
    if (b.kind == Kind::ADJUST)
      return !stale_ && !disengaged(state_);
    return true;
  }

  /// A touch or the test hook. The same rules as the enabled states, so the hook cannot do
  /// what a finger could not.
  void press_(size_t i) {
    Button &b = buttons_[i];
    const uint32_t now = millis();
    if (!usable_(b)) {
      ESP_LOGW(TAG, "Autopilot %s: %s ignored (%s)", id_.c_str(), b.part.c_str(),
               !controls_ ? "tile too small for controls" : !online_ ? "offline" : "not engaged");
      return;
    }
    const int was_armed = armed_;
    armed_ = -1;
    dirty_ = true;
    switch (b.kind) {
      case Kind::ADJUST: {
        const double delta = std::strtod(b.part.c_str(), nullptr);
        ESP_LOGI(TAG, "Autopilot %s: PUT %s = %+.0f", id_.c_str(), adjust_path_.c_str(), delta);
        put_(adjust_path_, PutValue{delta});
        break;
      }
      case Kind::STANDBY:
        send_state_("standby");
        break;
      case Kind::MODE:
        if (was_armed == static_cast<int>(i) && now - armed_since_ < ARM_MS) {
          send_state_(b.part);
        } else {
          armed_ = static_cast<int>(i);
          armed_since_ = now;
          ESP_LOGI(TAG, "Autopilot %s: armed %s, tap again to engage", id_.c_str(), b.part.c_str());
        }
        break;
    }
  }

  std::string course_text_(const std::string &target, const std::string &heading) const {
    if (!show_heading_)
      return "TGT " + target;
    return "TGT " + target + (narrow_ ? "\n" : "   ") + "HDG " + heading;
  }

  void send_state_(const std::string &state) {
    ESP_LOGI(TAG, "Autopilot %s: PUT %s = %s", id_.c_str(), state_path_.c_str(), state.c_str());
    pending_ = true;
    pending_state_ = state;
    pending_since_ = millis();
    failed_ = false;
    put_(state_path_, PutValue{state});
  }

  void redraw_() {
    const bool live = state_known_ && !stale_;
    set_text(state_label_, state_shown_, live ? state_title(state_) : "--");
    lv_obj_set_style_text_color(state_label_, live && !disengaged(state_) ? colors_.accent : colors_.text,
                                LV_PART_MAIN);
    std::string note;
    if (!online_)
      note = "offline";
    else if (armed_ >= 0)
      note = "tap " + buttons_[armed_].title + " again to engage";
    else if (pending_)
      note = "sending " + state_title(pending_state_) + "...";
    else if (failed_)
      note = "! no response from the autopilot";
    set_text(note_label_, note_shown_, note);
    if (!controls_)
      return;
    for (size_t i = 0; i < buttons_.size(); i++) {
      Button &b = buttons_[i];
      if (usable_(b))
        lv_obj_remove_state(b.obj, LV_STATE_DISABLED);
      else
        lv_obj_add_state(b.obj, LV_STATE_DISABLED);
      const bool armed = armed_ == static_cast<int>(i);
      const bool current = b.kind != Kind::ADJUST && live && state_ == b.part;
      lv_obj_set_style_bg_color(b.obj, armed ? colors_.accent : current ? colors_.tile : colors_.background,
                                LV_PART_MAIN);
      lv_obj_set_style_border_width(b.obj, current ? 2 : 0, LV_PART_MAIN);
      lv_obj_set_style_border_color(b.obj, colors_.accent, LV_PART_MAIN);
      lv_obj_set_style_text_color(b.label, armed ? colors_.background : usable_(b) ? colors_.text : colors_.muted,
                                  LV_PART_MAIN);
      set_text(b.label, b.shown, armed ? b.title + "?" : b.title);
    }
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  std::function<void(const std::string &, const PutValue &)> put_;
  std::function<bool()> can_put_;
  std::string state_path_, adjust_path_;
  uint32_t stale_ms_{0};
  Binding target_, heading_;
  lv_obj_t *caption_, *state_label_, *course_label_, *note_label_;
  std::string state_shown_{"--"}, course_shown_, note_shown_;
  std::vector<Button> buttons_;
  bool controls_{false}, narrow_{false}, show_heading_{true}, online_{false}, stale_{true}, dirty_{true};
  bool state_known_{false}, pending_{false}, failed_{false};
  std::string state_, pending_state_;
  uint32_t state_ms_{0}, pending_since_{0}, armed_since_{0}, last_draw_ms_{0};
  int armed_{-1};
};

std::unique_ptr<Widget> make_autopilot_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<AutopilotWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
