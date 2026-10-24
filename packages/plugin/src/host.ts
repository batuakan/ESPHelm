import type { ServerAPI } from '@signalk/server-api';

/** The part of the SignalK server API this plugin uses (tests provide a fake). */
export type PluginHost = Pick<
  ServerAPI,
  'getDataDirPath' | 'handleMessage' | 'setPluginStatus' | 'setPluginError' | 'debug' | 'error'
> & {
  /**
   * Not part of @signalk/server-api's public types, but present on every server: the dummy
   * strategy (security disabled) answers `isDummy() === true`.
   */
  securityStrategy?: { isDummy?: () => boolean };
};

export type SecurityMode = 'enabled' | 'disabled';

/** Fails closed: anything other than an explicit dummy strategy counts as security enabled. */
export function securityMode(host: PluginHost): SecurityMode {
  return host.securityStrategy?.isDummy?.() === true ? 'disabled' : 'enabled';
}
