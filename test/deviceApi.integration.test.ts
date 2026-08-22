import { describe, it, expect, afterEach } from 'vitest';
import { startMockBulb, MockBulbServer } from './mockBulbServer';
import { pingBulb, findLightEntity, getState, setState } from '../src/bulbs/deviceApi';

describe('deviceApi against a mock bulb HTTP server', () => {
  let mock: MockBulbServer;

  afterEach(async () => {
    if (mock) await mock.stop();
  });

  it('pings a real mock Kauf bulb and gets its identity', async () => {
    mock = await startMockBulb();

    const result = await pingBulb(`127.0.0.1:${mock.port}`);

    expect(result).toEqual({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
    });
  });

  it('returns null for a mock device with a non-Kauf project name', async () => {
    mock = await startMockBulb({ projectName: 'SomethingElse' });

    expect(await pingBulb(`127.0.0.1:${mock.port}`)).toBeNull();
  });

  it('finds the primary light entity, skipping hidden config lights', async () => {
    mock = await startMockBulb();

    expect(await findLightEntity(`127.0.0.1:${mock.port}`)).toBe('kauf_bulb_7d49e0');
  });

  it('reads real state from the mock bulb', async () => {
    mock = await startMockBulb();

    expect(await getState(`127.0.0.1:${mock.port}`, 'kauf_bulb_7d49e0')).toEqual({
      on: true,
      brightness: 55,
      r: 39,
      g: 183,
      b: 255,
    });
  });

  it('turns the mock bulb off and getState reflects it', async () => {
    mock = await startMockBulb();

    const success = await setState(`127.0.0.1:${mock.port}`, 'kauf_bulb_7d49e0', { on: false });
    expect(success).toBe(true);

    const state = await getState(`127.0.0.1:${mock.port}`, 'kauf_bulb_7d49e0');
    expect(state?.on).toBe(false);
  });

  it('sets brightness and color, and getState reflects the new values', async () => {
    mock = await startMockBulb();

    const success = await setState(`127.0.0.1:${mock.port}`, 'kauf_bulb_7d49e0', {
      on: true,
      brightness: 100,
      r: 255,
      g: 0,
      b: 0,
    });
    expect(success).toBe(true);

    expect(await getState(`127.0.0.1:${mock.port}`, 'kauf_bulb_7d49e0')).toEqual({
      on: true,
      brightness: 100,
      r: 255,
      g: 0,
      b: 0,
    });
  });

  it('returns null/false when nothing is listening on the port', async () => {
    mock = await startMockBulb();
    const deadPort = mock.port;
    await mock.stop();

    expect(await pingBulb(`127.0.0.1:${deadPort}`)).toBeNull();
    expect(await getState(`127.0.0.1:${deadPort}`, 'kauf_bulb_7d49e0')).toBeNull();
  });
});
