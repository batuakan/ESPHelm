"""`ota: - platform: esphelm_runtime`: firmware updates from the ESPHelm plugin (ADR-0036).

The display downloads an image the plugin offers (an admin pressed Update in the editor) with its
SignalK device token, and writes it through ESPHome's OTA backend, which checks its MD5. ESPHome's
`ota` loads `safe_mode`, so with ESP-IDF's rollback a new image that crashes in its first minute
gives way to the old one.
"""

import esphome.codegen as cg
from esphome.components.ota import BASE_OTA_SCHEMA, OTAComponent, ota_to_code
import esphome.config_validation as cv
from esphome.const import CONF_ID
from esphome.core import coroutine_with_priority
from esphome.coroutine import CoroPriority

from .. import EsphelmRuntime, esphelm_ns

CODEOWNERS = ["@batuakan"]
DEPENDENCIES = ["esphelm_runtime", "network"]
# The host build's id is the sha256 of the program (firmware_update.cpp).
AUTO_LOAD = ["sha256"]

CONF_RUNTIME_ID = "runtime_id"

EsphelmOta = esphelm_ns.class_("EsphelmOta", OTAComponent)

CONFIG_SCHEMA = (
    cv.Schema(
        {
            cv.GenerateID(): cv.declare_id(EsphelmOta),
            cv.GenerateID(CONF_RUNTIME_ID): cv.use_id(EsphelmRuntime),
        }
    )
    .extend(BASE_OTA_SCHEMA)
    .extend(cv.COMPONENT_SCHEMA)
)


@coroutine_with_priority(CoroPriority.OTA_UPDATES)
async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await ota_to_code(var, config)
    await cg.register_component(var, config)
    cg.add_define("USE_ESPHELM_OTA")
    runtime = await cg.get_variable(config[CONF_RUNTIME_ID])
    cg.add(runtime.set_ota(var))
