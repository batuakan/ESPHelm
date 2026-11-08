"""esphelm_runtime: renders layouts from the signalk-esphelm plugin (docs/firmware-runtime.md)."""

import esphome.codegen as cg
from esphome.components import font, light, time
import esphome.final_validate as fv
from esphome.components.lvgl.types import lv_obj_t
from esphome.components.lvgl.widgets import get_widgets
from esphome.components.signalk import signalk as SignalKComponent
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_ROTATION
from esphome.core import CORE

CODEOWNERS = ["@batuakan"]
DEPENDENCIES = ["lvgl", "signalk", "json"]

CONF_SIGNALK_ID = "signalk_id"
CONF_CONTAINER = "container"
CONF_FONTS = "fonts"
CONF_VALUE = "value"
CONF_LABEL = "label"
CONF_SMALL = "small"
CONF_EXTRA = "extra"
CONF_DIGITS = "digits"
CONF_BOARD = "board"
CONF_TOUCH = "touch"
CONF_STALE_AFTER = "stale_after"
CONF_MAX_LAYOUT_BYTES = "max_layout_bytes"
CONF_STORE_DIR = "store_dir"
CONF_BACKLIGHT = "backlight"
CONF_TIME_ID = "time_id"

# LVGL features the renderer needs. ESPHome only compiles what the YAML uses ("image": lv_scale
# links against it for image needles).
LVGL_FEATURES = (
    "label", "grid", "flex", "font", "scale", "line", "bar", "switch", "button", "image", "chart", "arc", "slider",
    "canvas", "qrcode",
)

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
                # Fonts with only the glyphs "0123456789.-:": value numbers and clock times only.
                cv.Optional(CONF_DIGITS, default=[]): cv.ensure_list(cv.use_id(font.Font)),
            }
        ),
        cv.Optional(CONF_BOARD, default=""): cv.string,
        cv.Optional(CONF_TOUCH, default=True): cv.boolean,
        cv.Optional(CONF_STALE_AFTER, default="15s"): cv.positive_time_period_milliseconds,
        cv.Optional(CONF_MAX_LAYOUT_BYTES): cv.int_range(min=1024),
        cv.Optional(CONF_STORE_DIR, default="."): cv.string,
        # A dimmable light driving the display backlight: layout brightness and screen timeout.
        cv.Optional(CONF_BACKLIGHT): cv.use_id(light.LightState),
        # A second source for the clock (ADR-0024), e.g. SNTP or HomeAssistant; SignalK's
        # navigation.datetime (GPS time) wins while it arrives.
        cv.Optional(CONF_TIME_ID): cv.use_id(time.RealTimeClock),
    }
).extend(cv.COMPONENT_SCHEMA)

def _final_validate(config):
    _enable_lvgl_features(config)
    # The setup network (ADR-0026) gets a password per display, made on the display and shown on
    # its screen: one written in the YAML would be the same on every display built from it.
    wifi_conf = fv.full_config.get().get("wifi")
    if wifi_conf is not None and "ap" in wifi_conf and wifi_conf["ap"].get("password"):
        raise cv.Invalid(
            "esphelm_runtime sets the setup network's password itself (one per display, shown on "
            "its screen); remove 'password' from 'wifi: ap:'"
        )
    return config


FINAL_VALIDATE_SCHEMA = _final_validate


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
    for digits in fonts[CONF_DIGITS]:
        cg.add(var.add_digit_font(await cg.get_variable(digits)))
    cg.add(var.set_board(config[CONF_BOARD]))
    cg.add(var.set_touch(config[CONF_TOUCH]))
    cg.add(var.set_stale_after(config[CONF_STALE_AFTER].total_milliseconds))
    if CONF_MAX_LAYOUT_BYTES in config:
        cg.add(var.set_max_layout_bytes(config[CONF_MAX_LAYOUT_BYTES]))
    cg.add(var.set_store_dir(config[CONF_STORE_DIR]))
    # No network in the YAML: it comes from the setup network's portal, and can be forgotten.
    wifi_conf = CORE.config.get("wifi")
    if wifi_conf is not None and not wifi_conf.get("networks") and "ap" in wifi_conf:
        cg.add_define("USE_ESPHELM_WIFI_SETUP")
    if CONF_BACKLIGHT in config:
        cg.add_define("USE_ESPHELM_BACKLIGHT")
        cg.add(var.set_backlight(await cg.get_variable(config[CONF_BACKLIGHT])))
    if CONF_TIME_ID in config:
        cg.add_define("USE_ESPHELM_TIME")
        cg.add(var.set_time(await cg.get_variable(config[CONF_TIME_ID])))
    # The layout's settings.rotation (ADR-0028): ESPHome's LVGL turns the picture and touch at
    # runtime once `rotation:` is in its config. Software rotation needs a second draw buffer, so
    # a board without the RAM leaves it out (the C3).
    lvgl_confs = CORE.config.get("lvgl") or []
    if lvgl_confs and CONF_ROTATION in lvgl_confs[0]:
        cg.add_define("USE_ESPHELM_ROTATION")
        cg.add(var.set_lvgl(await cg.get_variable(lvgl_confs[0][CONF_ID])))
