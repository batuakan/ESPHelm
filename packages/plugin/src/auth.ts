import type { Request } from 'express';
import type { SecurityMode } from './host.js';

/** Set by signalk-server's http_authorize on every request it lets through. */
interface Principal {
  identifier: string;
  permissions: string;
}

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 403;
      error: 'DEVICE_TOKEN_REQUIRED' | 'READWRITE_REQUIRED' | 'DEVICE_MISMATCH';
      message: string;
    };

/**
 * Device endpoints need an approved SignalK device token with read/write permission
 * (ADR-0003). Anonymous requests reach plugin API routes too, as the synthetic "AUTO"
 * readonly principal when allow_readonly is on, so they are rejected here.
 * With security disabled on the server there is nothing to check.
 */
export function authorizeDevice(req: Request, mode: SecurityMode, deviceId?: string): AuthResult {
  if (mode === 'disabled') return { ok: true };
  const principal = (req as Request & { skPrincipal?: Principal }).skPrincipal;
  if (!principal || principal.identifier === 'AUTO') {
    return {
      ok: false,
      status: 401,
      error: 'DEVICE_TOKEN_REQUIRED',
      message: 'an approved SignalK device token is required',
    };
  }
  if (principal.permissions !== 'readwrite' && principal.permissions !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: 'READWRITE_REQUIRED',
      message: `token has "${principal.permissions}" permission; approve the device with read/write`,
    };
  }
  if (
    deviceId !== undefined &&
    principal.permissions !== 'admin' &&
    principal.identifier !== deviceId
  ) {
    return {
      ok: false,
      status: 403,
      error: 'DEVICE_MISMATCH',
      message: 'token belongs to a different device',
    };
  }
  return { ok: true };
}
