import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadBulbs, upsertBulb, getBulb } from '../src/bulbs/store';

describe('bulbs store', () => {
  let dataPath: string;

  beforeEach(() => {
    dataPath = path.join(os.tmpdir(), `bulbs-test-${Date.now()}-${Math.random()}.json`);
    process.env.BULBS_DATA_PATH = dataPath;
  });

  afterEach(() => {
    if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
    delete process.env.BULBS_DATA_PATH;
  });

  it('returns an empty array when the file does not exist', () => {
    expect(loadBulbs()).toEqual([]);
  });

  it('creates a new bulb with immutable fields set', () => {
    const created = upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    expect(created.id).toBe('kauf-bulb-7d49e0');
    expect(created.mac).toBe('C4:5B:BE:7D:49:E0');
    expect(created.objectId).toBe('kauf_bulb_7d49e0');
    expect(created.firstDiscovered).toBe(created.lastSeen);
    expect(loadBulbs()).toHaveLength(1);
  });

  it('throws when creating a new bulb without objectId', () => {
    expect(() => upsertBulb({ mac: 'AA:BB', hostname: 'x', title: 'x', ip: '1.2.3.4' })).toThrow();
  });

  it('updates lastSeen and lastIp for an existing bulb without touching immutable fields', async () => {
    const first = upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.99',
    });

    expect(updated.id).toBe(first.id);
    expect(updated.objectId).toBe(first.objectId);
    expect(updated.firstDiscovered).toBe(first.firstDiscovered);
    expect(updated.lastIp).toBe('192.168.1.99');
    expect(updated.lastSeen).not.toBe(first.lastSeen);
    expect(loadBulbs()).toHaveLength(1);
  });

  it('getBulb returns null for an unknown id', () => {
    expect(getBulb('nonexistent')).toBeNull();
  });

  it('getBulb finds a known bulb by id', () => {
    upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    expect(getBulb('kauf-bulb-7d49e0')?.mac).toBe('C4:5B:BE:7D:49:E0');
  });
});
