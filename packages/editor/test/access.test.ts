import { describe, expect, it } from 'vitest';
import { EXPIRY_WARNING_DAYS, accessLine, formatDate } from '../src/access';

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const DAY = 24 * 60 * 60;
const at = (days: number) => Math.round(NOW / 1000) + days * DAY;

describe('accessLine (ADR-0044)', () => {
  it('says nothing for a token that never expires, or an unreadable expiry', () => {
    expect(accessLine(undefined, NOW)).toBeNull();
    expect(accessLine(Number.NaN, NOW)).toBeNull();
  });

  it('shows the date quietly when it is far away', () => {
    expect(accessLine(at(365), NOW)).toEqual({
      warning: false,
      text: 'SignalK access until 22 Nov 2027',
    });
    expect(accessLine(at(EXPIRY_WARNING_DAYS + 1), NOW)?.warning).toBe(false);
  });

  it('warns within the last 30 days, with what to do', () => {
    const line = accessLine(at(5), NOW)!;
    expect(line.warning).toBe(true);
    expect(line.text).toBe(
      'SignalK access ends in 5 days (27 Nov 2026): remove the display and approve it again with no expiration',
    );
    expect(accessLine(at(EXPIRY_WARNING_DAYS), NOW)?.warning).toBe(true);
    expect(accessLine(Math.round(NOW / 1000) + 3600, NOW)?.text).toMatch(/ends in 1 day \(/);
  });

  it('says when it has run out', () => {
    expect(accessLine(at(-2), NOW)).toEqual({
      warning: true,
      text: 'SignalK access expired on 20 Nov 2026; the display has asked for access again',
    });
    expect(accessLine(Math.round(NOW / 1000), NOW)?.text).toMatch(/expired/);
  });

  it('formats dates the same everywhere', () => {
    expect(formatDate(Date.UTC(2027, 0, 3, 12))).toBe('3 Jan 2027');
  });
});
