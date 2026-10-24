import type { Plugin, ServerAPI } from '@signalk/server-api';
import type { IRouter } from 'express';
import { registerDeviceApi } from './deviceApi.js';
import { registerEditorApi } from './editorApi.js';
import type { PluginHost } from './host.js';
import { PLUGIN_ID, Service } from './service.js';

export { versionPath, PLUGIN_ID } from './service.js';

/**
 * signalk-esphelm: stores ESPHelm display layouts, registers devices and serves each device
 * its layout. Editor API under /plugins/esphelm/api (admin), device API under
 * /signalk/v1/api/esphelm (device token), change notification via plugins.esphelm.<id>.version.
 */
export default function esphelmPlugin(app: ServerAPI): Plugin {
  // ServerAPI provides everything PluginHost names; securityStrategy is present at runtime.
  const service = new Service(app as unknown as PluginHost);

  return {
    id: PLUGIN_ID,
    name: 'ESPHelm',
    description: 'Runtime-configurable ESP32 displays: layouts, device registry and delivery',
    schema: () => ({ type: 'object', properties: {} }),
    start: () => service.start(),
    stop: () => service.stop(),
    registerWithRouter: (router) => registerEditorApi(router, service),
    signalKApiRoutes: (router: IRouter) => registerDeviceApi(router, service),
  };
}
