// A display's access in SignalK (ADR-0044): when its token runs out, from SignalK's own device list.

/** One entry of GET /skServer/security/devices (signalk-server's admin REST). */
export interface SignalkDevice {
  clientId: string;
  permissions?: string;
  description?: string;
  /** The token's expiry in Unix seconds; absent when approved with no expiration (and on 2.17/2.19). */
  tokenExpiry?: number;
}

/** Days before the expiry from which the display row warns. */
export const EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The line under a display about its SignalK token, or null when it never expires (or isn't known). */
export function accessLine(
  tokenExpiry: number | undefined,
  now: number,
): { warning: boolean; text: string } | null {
  if (typeof tokenExpiry !== 'number' || !Number.isFinite(tokenExpiry)) return null;
  const at = tokenExpiry * 1000;
  const date = formatDate(at);
  if (at <= now) {
    return {
      warning: true,
      text: `SignalK access expired on ${date}; the display has asked for access again`,
    };
  }
  const days = Math.ceil((at - now) / DAY_MS);
  if (days <= EXPIRY_WARNING_DAYS) {
    return {
      warning: true,
      text: `SignalK access ends in ${days} day${days === 1 ? '' : 's'} (${date}): remove the display and approve it again with no expiration`,
    };
  }
  return { warning: false, text: `SignalK access until ${date}` };
}
