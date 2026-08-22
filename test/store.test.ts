import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadBulbs, upsertBulb, getBulb, renameBulb } from '../src/bulbs/store';

describe('bulbs store', () => {
  let dataPath: string;

  beforeEach(() => {
    dataPath = path.join(os.tmpdir(), `bulbs-test-${Date.now()}-${Math.random()}.json`);
    process.env.BULBS_DATA_PATH = dataPath;
  });

  afterEach(() => {
    if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
    if (fs.existsSync(`${dataPath}.tmp`)) fs.unlinkSync(`${dataPath}.tmp`);
    delete process.env.BULBS_DATA_PATH;
  });

  it('returns an empty array when the file does not exist', () => {
    expect(loadBulbs()).toEqual([]);
  });

  it('returns an empty array when the file contains valid JSON that is not an array (object)', () => {
    fs.writeFileSync(dataPath, JSON.stringify({}));
    expect(loadBulbs()).toEqual([]);
  });

  it('returns an empty array when the file contains valid JSON that is not an array (string)', () => {
    fs.writeFileSync(dataPath, JSON.stringify('not an array'));
    expect(loadBulbs()).toEqual([]);
  });

  it('does not leave a stale .tmp file after saving, and does not truncate on write', () => {
    upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    expect(fs.existsSync(`${dataPath}.tmp`)).toBe(false);
    expect(fs.existsSync(dataPath)).toBe(true);
    expect(loadBulbs()).toHaveLength(1);
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

  it('renameBulb updates the name and preserves everything else', () => {
    const created = upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    const renamed = renameBulb('kauf-bulb-7d49e0', 'Living Room Lamp');

    expect(renamed?.name).toBe('Living Room Lamp');
    expect(renamed?.id).toBe(created.id);
    expect(renamed?.mac).toBe(created.mac);
    expect(renamed?.objectId).toBe(created.objectId);
    expect(renamed?.firstDiscovered).toBe(created.firstDiscovered);
    expect(renamed?.lastSeen).toBe(created.lastSeen);
    expect(renamed?.lastIp).toBe(created.lastIp);
    expect(loadBulbs()[0].name).toBe('Living Room Lamp');
  });

  it('renameBulb returns null for an unknown id', () => {
    expect(renameBulb('nonexistent', 'New Name')).toBeNull();
  });
});
