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
CONF_SOUND = "sound"
CONF_RTTTL = "rtttl"
CONF_SPEAKER = "speaker"
CONF_CLICK = "click"

def _rtttl(value):
    """An RTTTL tune as ESPHome's rtttl plays it: name:d=..,o=..,b=..:notes (d 1-32, o 4-7)."""
    value = cv.string_strict(value)
    parts = value.split(":")
    if len(parts) != 3 or not parts[2].strip():
        raise cv.Invalid("an RTTTL tune is 'name:d=8,o=6,b=180:notes'")
    for setting in parts[1].split(","):
        key, _, num = setting.strip().partition("=")
        if key == "d" and num not in ("1", "2", "4", "8", "16", "32"):
            raise cv.Invalid("RTTTL d= must be 1, 2, 4, 8, 16 or 32")
        if key == "o" and num not in ("4", "5", "6", "7"):
            raise cv.Invalid("RTTTL o= must be 4 to 7")
    return value


# Default tunes (RTTTL), replaceable in the YAML (ADR-0033). The click is one very short high note;
# the alarm levels rise in urgency, and the tune of `alarm` and `emergency` repeats until acknowledged.
SOUND_TUNES = {
    CONF_CLICK: "click:d=32,o=7,b=250:c",
    "alert": "alert:d=8,o=6,b=180:e",
    "warn": "warn:d=8,o=6,b=180:a,p,a",
    "alarm": "alarm:d=8,o=6,b=200:c7,p,c7,p,c7",
    "emergency": "emergency:d=16,o=6,b=220:c7,g,c7,g,c7,g,c7,g",
}

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
        # Alarm tones and touch clicks (ADR-0033), through ESPHome's rtttl component; with the
        # speaker it plays on, the layout's volume is the speaker's (else rtttl's gain).
        cv.Optional(CONF_SOUND): cv.Schema(
            {
                cv.Required(CONF_RTTTL): cv.use_id(cg.esphome_ns.namespace("rtttl").class_("Rtttl")),
                cv.Optional(CONF_SPEAKER): cv.use_id(cg.esphome_ns.namespace("speaker").class_("Speaker")),
                **{cv.Optional(name, default=tune): _rtttl for name, tune in SOUND_TUNES.items()},
            }
        ),
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
    if CONF_SOUND in config:
        sound = config[CONF_SOUND]
        cg.add_define("USE_ESPHELM_SOUND")
        cg.add(var.set_sound_rtttl(await cg.get_variable(sound[CONF_RTTTL])))
        if CONF_SPEAKER in sound:
            cg.add(var.set_sound_speaker(await cg.get_variable(sound[CONF_SPEAKER])))
        # In the order of esphelm::sound::Level: the click (NONE), then alert .. emergency.
        for index, name in enumerate(SOUND_TUNES):
            cg.add(var.set_sound_tune(index, sound[name]))
    # The layout's settings.rotation (ADR-0028): ESPHome's LVGL turns the picture and touch at
    # runtime once `rotation:` is in its config. Software rotation needs a second draw buffer, so
    # a board without the RAM leaves it out (the C3).
    lvgl_confs = CORE.config.get("lvgl") or []
    if lvgl_confs and CONF_ROTATION in lvgl_confs[0]:
        cg.add_define("USE_ESPHELM_ROTATION")
        cg.add(var.set_lvgl(await cg.get_variable(lvgl_confs[0][CONF_ID])))
