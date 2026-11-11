"""esphelm_tiles_color: the colour tile set for esphelm_runtime (ADR-0035).

A firmware is built with exactly one tile set: `esphelm_tiles_color:` in its YAML next to
`esphelm_runtime:`. It defines the tile set functions declared in esphelm_runtime/widgets.h
(colors_for, make_tile_widget, tile_types); no other tile set's code is compiled in.
"""

import esphome.codegen as cg
import esphome.config_validation as cv

CODEOWNERS = ["@batuakan"]
DEPENDENCIES = ["esphelm_runtime"]

# LVGL features the colour tiles need on top of the core's (esphelm_runtime LVGL_FEATURES).
# "image": lv_scale links against it for image needles.
LVGL_FEATURES = ("scale", "line", "bar", "switch", "button", "image", "chart", "arc", "canvas")

CONFIG_SCHEMA = cv.Schema({})


def _enable_lvgl_features(config):
    try:
        from esphome.components.lvgl.defines import add_lv_use
    except ImportError:  # pragma: no cover - fallback for a changed ESPHome internal API
        return config
    add_lv_use(*LVGL_FEATURES)
    return config


FINAL_VALIDATE_SCHEMA = _enable_lvgl_features


async def to_code(config):
    try:
        from esphome.components.lvgl.defines import add_lv_use  # noqa: F401
    except ImportError:  # pragma: no cover
        for feature in LVGL_FEATURES:
            cg.add_build_flag(f"-DLV_USE_{feature.upper()}=1")
    # Chart tiles (ADR-0030): the core's map tile store and its worker are compiled in.
    cg.add_define("USE_ESPHELM_CHARTS")
