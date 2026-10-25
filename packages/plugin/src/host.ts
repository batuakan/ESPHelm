import type { ServerAPI } from '@signalk/server-api';

/** The part of the SignalK server API this plugin uses (tests provide a fake). */
export type PluginHost = Pick<
  ServerAPI,
  | 'getDataDirPath'
  | 'handleMessage'
  | 'setPluginStatus'
  | 'setPluginError'
  | 'debug'
  | 'error'
  | 'getSelfPath'
  | 'getMetadata'
> &
  Partial<Pick<ServerAPI, 'resourcesApi' | 'registerDeltaInputHandler' | 'selfContext'>> & {
    streambundle: Pick<ServerAPI['streambundle'], 'getAvailablePaths'>;
  } & {
    /**
     * Not part of @signalk/server-api's public types, but present on every server: the dummy
     * strategy (security disabled) answers `isDummy() === true`.
     */
    securityStrategy?: { isDummy?: () => boolean };
    /** Not in the public types either; used to reach this server's own chart tiles. */
    config?: { settings?: { port?: number } };
  };

/** This server's HTTP port, as signalk-server itself works it out (src/ports.ts). */
export function httpPort(host: PluginHost): number {
  return Number(process.env.PORT) || host.config?.settings?.port || 3000;
}

export type SecurityMode = 'enabled' | 'disabled';

/** Fails closed: anything other than an explicit dummy strategy counts as security enabled. */
export function securityMode(host: PluginHost): SecurityMode {
  return host.securityStrategy?.isDummy?.() === true ? 'disabled' : 'enabled';
}
