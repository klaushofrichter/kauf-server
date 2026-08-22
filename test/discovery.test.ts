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
import { runDiscoveryScan, listCidrAddresses } from '../src/bulbs/discovery';

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
