"""esphelm_tiles_mono: the black-and-white tile set for esphelm_runtime (ADR-0035).

For 1-bit panels such as reflective LCDs: two colours only, no anti-aliasing, zones shown as a
style (a heavy frame for warn, an inverted tile for alarm and emergency). A firmware is built with
exactly one tile set: `esphelm_tiles_mono:` in its YAML next to `esphelm_runtime:`. Its fonts
should be built with `bpp: 1`, so text has no grey edges either.
"""

import esphome.codegen as cg
import esphome.config_validation as cv

CODEOWNERS = ["@batuakan"]
DEPENDENCIES = ["esphelm_runtime"]

# LVGL features the mono tiles need on top of the core's (esphelm_runtime LVGL_FEATURES).
LVGL_FEATURES = ("bar", "label")

CONF_INK_ON = "ink_on"

CONFIG_SCHEMA = cv.Schema(
    {
        # The panel's driver is an ESPHome binary display (DISPLAY_TYPE_BINARY), which draws any
        # colour but black in ink: the pixels sent are flipped so black text stays black.
        cv.Optional(CONF_INK_ON, default=False): cv.boolean,
    }
)


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
    # The core turns every flushed pixel black or white (esphelm_mono.h).
    cg.add_define("USE_ESPHELM_MONO")
    if config[CONF_INK_ON]:
        cg.add_define("USE_ESPHELM_MONO_INK_ON")
