import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/bulbs/store', () => ({
  listBulbs: vi.fn(),
  getBulb: vi.fn(),
}));
vi.mock('../src/bulbs/deviceApi', () => ({
  getState: vi.fn(),
  setState: vi.fn(),
}));

import { listBulbs, getBulb } from '../src/bulbs/store';
import { getState, setState } from '../src/bulbs/deviceApi';
import { listWithLiveState, getWithLiveState, setBulbState } from '../src/bulbs/service';

const STORED = {
  id: 'kauf-bulb-7d49e0',
  mac: 'C4:5B:BE:7D:49:E0',
  objectId: 'kauf_bulb_7d49e0',
  name: 'Kauf Bulb 7d49e0',
  firstDiscovered: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-01-01T00:00:00.000Z',
  lastIp: '192.168.1.26',
};

describe('listWithLiveState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges persisted identity with live state', async () => {
    vi.mocked(listBulbs).mockReturnValue([STORED]);
    vi.mocked(getState).mockResolvedValue({ on: true, brightness: 55, r: 39, g: 183, b: 255 });

    const result = await listWithLiveState();

    expect(result).toEqual([
      {
        id: 'kauf-bulb-7d49e0',
        name: 'Kauf Bulb 7d49e0',
        mac: 'C4:5B:BE:7D:49:E0',
        lastIp: '192.168.1.26',
        online: true,
        on: true,
        brightness: 55,
        r: 39,
        g: 183,
        b: 255,
      },
    ]);
  });

  it('reports a non-responding bulb as offline with null state', async () => {
    vi.mocked(listBulbs).mockReturnValue([STORED]);
    vi.mocked(getState).mockResolvedValue(null);

    const result = await listWithLiveState();

    expect(result[0].online).toBe(false);
    expect(result[0].on).toBeNull();
    expect(result[0].brightness).toBeNull();
  });
});

describe('getWithLiveState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for an unknown id', async () => {
    vi.mocked(getBulb).mockReturnValue(null);

    expect(await getWithLiveState('nonexistent')).toBeNull();
  });

  it('returns the merged bulb for a known id', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(getState).mockResolvedValue({ on: false, brightness: null, r: null, g: null, b: null });

    const result = await getWithLiveState('kauf-bulb-7d49e0');

    expect(result?.online).toBe(true);
    expect(result?.on).toBe(false);
  });
});

describe('setBulbState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports notFound for an unknown id', async () => {
    vi.mocked(getBulb).mockReturnValue(null);

    expect(await setBulbState('nonexistent', { on: true })).toEqual({ success: false, notFound: true });
  });

  it('reports failure when the device does not respond', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(setState).mockResolvedValue(false);

    expect(await setBulbState('kauf-bulb-7d49e0', { on: true })).toEqual({ success: false });
  });

  it('returns the re-fetched state on success', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(setState).mockResolvedValue(true);
    vi.mocked(getState).mockResolvedValue({ on: true, brightness: 100, r: 255, g: 0, b: 0 });

    const result = await setBulbState('kauf-bulb-7d49e0', {
      on: true,
      brightness: 100,
      r: 255,
      g: 0,
      b: 0,
    });

    expect(result.success).toBe(true);
    expect(result.bulb?.on).toBe(true);
    expect(setState).toHaveBeenCalledWith('192.168.1.26', 'kauf_bulb_7d49e0', {
      on: true,
      brightness: 100,
      r: 255,
      g: 0,
      b: 0,
    });
  });
});
