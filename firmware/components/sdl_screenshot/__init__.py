import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID

sdl_screenshot_ns = cg.esphome_ns.namespace("sdl_screenshot")
Screenshot = sdl_screenshot_ns.class_("Screenshot", cg.Component)

CONFIG_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.declare_id(Screenshot),
}).extend(cv.COMPONENT_SCHEMA)

async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
