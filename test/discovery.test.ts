// test/discovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/bulbs/deviceApi', () => ({
  pingBulb: vi.fn(),
  findLightEntity: vi.fn(),
}));
vi.mock('../src/bulbs/store', () => ({
  loadBulbs: vi.fn(),
  upsertBulb: vi.fn(),
}));

import { pingBulb, findLightEntity } from '../src/bulbs/deviceApi';
import { loadBulbs, upsertBulb } from '../src/bulbs/store';
import { runDiscoveryScan, listCidrAddresses, getScanProgress } from '../src/bulbs/discovery';

describe('listCidrAddresses', () => {
  it('lists usable host addresses for a /30, excluding network and broadcast', () => {
    expect(listCidrAddresses('192.168.1.0/30')).toEqual(['192.168.1.1', '192.168.1.2']);
  });

  it('lists 254 addresses for a /24', () => {
    const addresses = listCidrAddresses('192.168.1.0/24');
    expect(addresses).toHaveLength(254);
    expect(addresses[0]).toBe('192.168.1.1');
    expect(addresses[253]).toBe('192.168.1.254');
  });
});

describe('runDiscoveryScan', () => {
  beforeEach(() => {
    vi.mocked(loadBulbs).mockClear().mockReturnValue([]);
    vi.mocked(pingBulb).mockClear().mockResolvedValue(null);
    vi.mocked(findLightEntity).mockClear().mockResolvedValue(null);
    vi.mocked(upsertBulb).mockClear();
  });

  it('does not upsert anything when no IP responds', async () => {
    const count = await runDiscoveryScan('192.168.1.0/30');

    expect(count).toBe(0);
    expect(upsertBulb).not.toHaveBeenCalled();
  });

  it('looks up the light entity and upserts a new bulb with objectId', async () => {
    vi.mocked(pingBulb).mockImplementation(async (ip: string) =>
      ip === '192.168.1.1'
        ? { mac: 'C4:5B:BE:7D:49:E0', hostname: 'kauf-bulb-7d49e0', title: 'Kauf Bulb 7d49e0' }
        : null
    );
    vi.mocked(findLightEntity).mockResolvedValue('kauf_bulb_7d49e0');

    const count = await runDiscoveryScan('192.168.1.0/30');

    expect(count).toBe(1);
    expect(findLightEntity).toHaveBeenCalledWith('192.168.1.1');
    expect(upsertBulb).toHaveBeenCalledWith({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.1',
      objectId: 'kauf_bulb_7d49e0',
    });
  });

  it('skips the light-entity lookup for an already-known bulb', async () => {
    vi.mocked(loadBulbs).mockReturnValue([
      {
        id: 'kauf-bulb-7d49e0',
        mac: 'C4:5B:BE:7D:49:E0',
        objectId: 'kauf_bulb_7d49e0',
        name: 'x',
        firstDiscovered: 'x',
        lastSeen: 'x',
        lastIp: 'x',
      },
    ]);
    vi.mocked(pingBulb).mockImplementation(async (ip: string) =>
      ip === '192.168.1.1'
        ? { mac: 'C4:5B:BE:7D:49:E0', hostname: 'kauf-bulb-7d49e0', title: 'Kauf Bulb 7d49e0' }
        : null
    );

    await runDiscoveryScan('192.168.1.0/30');

    expect(findLightEntity).not.toHaveBeenCalled();
    expect(upsertBulb).toHaveBeenCalledWith({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.1',
    });
  });

  it('does not upsert a new bulb if the light entity cannot be found', async () => {
    vi.mocked(pingBulb).mockImplementation(async (ip: string) =>
      ip === '192.168.1.1'
        ? { mac: 'C4:5B:BE:7D:49:E0', hostname: 'kauf-bulb-7d49e0', title: 'Kauf Bulb 7d49e0' }
        : null
    );
    vi.mocked(findLightEntity).mockResolvedValue(null);

    await runDiscoveryScan('192.168.1.0/30');

    expect(upsertBulb).not.toHaveBeenCalled();
  });
});

describe('scan progress', () => {
  it('reports zero before any scan has run', () => {
    // Whatever else is true, the meter must never claim progress it has not
    // made - a total of 0 is what the UI treats as "no bar yet".
    const p = getScanProgress();
    expect(p.scanned).toBeLessThanOrEqual(p.total);
  });

  it('counts every address and finishes not running', async () => {
    vi.mocked(pingBulb).mockResolvedValue(null);

    await runDiscoveryScan('10.0.0.0/29');

    const p = getScanProgress();
    // /29 = 8 addresses, minus network and broadcast = 6 scanned.
    expect(p.total).toBe(6);
    expect(p.scanned).toBe(6);
    expect(p.running).toBe(false);
    expect(p.cidr).toBe('10.0.0.0/29');
  });

  it('counts an address that matched a bulb, not just the misses', async () => {
    // The counter is incremented on several branches; an early return that
    // forgot one would silently stall the bar just short of complete.
    vi.mocked(pingBulb).mockResolvedValue({
      mac: 'AA:BB:CC:DD:EE:01',
      hostname: 'kauf',
      title: 'Kauf',
      firmwareVersion: null,
      esphomeVersion: null,
    });
    vi.mocked(findLightEntity).mockResolvedValue('kauf_light');

    await runDiscoveryScan('10.0.0.0/29');

    expect(getScanProgress().scanned).toBe(6);
  });

  it('stops reporting running if the scan throws', async () => {
    vi.mocked(pingBulb).mockRejectedValue(new Error('network gone'));

    await expect(runDiscoveryScan('10.0.0.0/30')).rejects.toThrow();

    // Otherwise the UI would poll a meter that never completes.
    expect(getScanProgress().running).toBe(false);
  });
});
