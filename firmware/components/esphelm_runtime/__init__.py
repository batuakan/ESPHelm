"""esphelm_runtime: renders layouts from the signalk-esphelm plugin (docs/firmware-runtime.md)."""

import esphome.codegen as cg
from esphome.components import font, light
from esphome.components.lvgl.types import lv_obj_t
from esphome.components.lvgl.widgets import get_widgets
from esphome.components.signalk import signalk as SignalKComponent
import esphome.config_validation as cv
from esphome.const import CONF_ID

CODEOWNERS = ["@batuakan"]
DEPENDENCIES = ["lvgl", "signalk", "json"]

CONF_SIGNALK_ID = "signalk_id"
CONF_CONTAINER = "container"
CONF_FONTS = "fonts"
CONF_VALUE = "value"
CONF_LABEL = "label"
CONF_SMALL = "small"
CONF_EXTRA = "extra"
CONF_BOARD = "board"
CONF_TOUCH = "touch"
CONF_STALE_AFTER = "stale_after"
CONF_MAX_LAYOUT_BYTES = "max_layout_bytes"
CONF_STORE_DIR = "store_dir"
CONF_BACKLIGHT = "backlight"

# LVGL features the renderer needs. ESPHome only compiles what the YAML uses ("image": lv_scale
# links against it for image needles).
LVGL_FEATURES = ("label", "grid", "flex", "font", "scale", "line", "bar", "switch", "button", "image")

esphelm_ns = cg.esphome_ns.namespace("esphelm_runtime")
EsphelmRuntime = esphelm_ns.class_("EsphelmRuntime", cg.Component)


def _enable_lvgl_features(config):
    try:
        from esphome.components.lvgl.defines import add_lv_use
    except ImportError:  # pragma: no cover - fallback for a changed ESPHome internal API
        return config
    add_lv_use(*LVGL_FEATURES)
    return config


CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(EsphelmRuntime),
        cv.GenerateID(CONF_SIGNALK_ID): cv.use_id(SignalKComponent),
        cv.Required(CONF_CONTAINER): cv.use_id(lv_obj_t),
        cv.Required(CONF_FONTS): cv.Schema(
            {
                cv.Required(CONF_VALUE): cv.use_id(font.Font),
                cv.Required(CONF_LABEL): cv.use_id(font.Font),
                cv.Required(CONF_SMALL): cv.use_id(font.Font),
                # More sizes for tile text to pick from (ADR-0017), in any order.
                cv.Optional(CONF_EXTRA, default=[]): cv.ensure_list(cv.use_id(font.Font)),
            }
        ),
        cv.Optional(CONF_BOARD, default=""): cv.string,
        cv.Optional(CONF_TOUCH, default=True): cv.boolean,
        cv.Optional(CONF_STALE_AFTER, default="15s"): cv.positive_time_period_milliseconds,
        cv.Optional(CONF_MAX_LAYOUT_BYTES): cv.int_range(min=1024),
        cv.Optional(CONF_STORE_DIR, default="."): cv.string,
        # A dimmable light driving the display backlight: layout brightness and screen timeout.
        cv.Optional(CONF_BACKLIGHT): cv.use_id(light.LightState),
    }
).extend(cv.COMPONENT_SCHEMA)

FINAL_VALIDATE_SCHEMA = _enable_lvgl_features


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    try:
        from esphome.components.lvgl.defines import add_lv_use  # noqa: F401
    except ImportError:  # pragma: no cover
        for feature in LVGL_FEATURES:
            cg.add_build_flag(f"-DLV_USE_{feature.upper()}=1")

    signalk = await cg.get_variable(config[CONF_SIGNALK_ID])
    cg.add(var.set_signalk(signalk))
    container = (await get_widgets(config, CONF_CONTAINER))[0]
    cg.add(var.set_container(container.obj))
    fonts = config[CONF_FONTS]
    cg.add(
        var.set_fonts(
            await cg.get_variable(fonts[CONF_VALUE]),
            await cg.get_variable(fonts[CONF_LABEL]),
            await cg.get_variable(fonts[CONF_SMALL]),
        )
    )
    for extra in fonts[CONF_EXTRA]:
        cg.add(var.add_font(await cg.get_variable(extra)))
    cg.add(var.set_board(config[CONF_BOARD]))
    cg.add(var.set_touch(config[CONF_TOUCH]))
    cg.add(var.set_stale_after(config[CONF_STALE_AFTER].total_milliseconds))
    if CONF_MAX_LAYOUT_BYTES in config:
        cg.add(var.set_max_layout_bytes(config[CONF_MAX_LAYOUT_BYTES]))
    cg.add(var.set_store_dir(config[CONF_STORE_DIR]))
    if CONF_BACKLIGHT in config:
        cg.add_define("USE_ESPHELM_BACKLIGHT")
        cg.add(var.set_backlight(await cg.get_variable(config[CONF_BACKLIGHT])))
