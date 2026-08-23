import { describe, it, expect, beforeEach, vi } from 'vitest';
import { allowDeviceCall, resetDeviceRateLimit } from '../src/bulbs/deviceRateLimit';

describe('allowDeviceCall', () => {
  beforeEach(() => {
    resetDeviceRateLimit();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('allows up to 3 calls to the same IP within a 1-second window', () => {
    expect(allowDeviceCall('192.168.1.26')).toBe(true);
    expect(allowDeviceCall('192.168.1.26')).toBe(true);
    expect(allowDeviceCall('192.168.1.26')).toBe(true);
  });

  it('denies the 4th call to the same IP within a 1-second window', () => {
    allowDeviceCall('192.168.1.26');
    allowDeviceCall('192.168.1.26');
    allowDeviceCall('192.168.1.26');

    expect(allowDeviceCall('192.168.1.26')).toBe(false);
  });

  it('allows calls again once the window has elapsed', () => {
    allowDeviceCall('192.168.1.26');
    allowDeviceCall('192.168.1.26');
    allowDeviceCall('192.168.1.26');
    expect(allowDeviceCall('192.168.1.26')).toBe(false);

    vi.setSystemTime(new Date('2026-01-01T00:00:01.100Z'));

    expect(allowDeviceCall('192.168.1.26')).toBe(true);
  });

  it('tracks separate budgets per IP', () => {
    allowDeviceCall('192.168.1.26');
    allowDeviceCall('192.168.1.26');
    allowDeviceCall('192.168.1.26');
    expect(allowDeviceCall('192.168.1.26')).toBe(false);

    expect(allowDeviceCall('192.168.1.99')).toBe(true);
  });
});
