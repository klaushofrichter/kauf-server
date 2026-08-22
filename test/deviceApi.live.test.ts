// Exercises src/bulbs/deviceApi.ts against a REAL Kauf bulb on the local
// network, if one is reachable. Safe in CI: the reachability probe below
// runs once at module load (top-level await), and the whole suite is
// skipped via describe.skipIf if it times out or fails - this never fails
// a CI run where the LAN isn't reachable, it just skips silently.
//
// To run these against your own bulb, either rely on the default IP
// (192.168.1.26, the bulb this project was developed against) or set
// LIVE_BULB_IP to point at a different one on your network.
import { describe, it, expect } from 'vitest';
import { pingBulb, findLightEntity, getState, setState } from '../src/bulbs/deviceApi';

const LIVE_BULB_IP = process.env.LIVE_BULB_IP || '192.168.1.26';

const ping = await pingBulb(LIVE_BULB_IP);
const liveObjectId = ping ? await findLightEntity(LIVE_BULB_IP) : null;

describe.skipIf(!ping || !liveObjectId)('deviceApi against a real live bulb', () => {
  it('identifies the real device as a genuine Kauf bulb', () => {
    expect(ping?.mac).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i);
    expect(ping?.hostname).toMatch(/^kauf-bulb-/);
    expect(ping?.title.length).toBeGreaterThan(0);
  });

  it('finds a real, non-empty light entity objectId', () => {
    expect(liveObjectId).toMatch(/^[a-z0-9_]+$/);
  });

  it('reads real state within valid ranges', async () => {
    const state = await getState(LIVE_BULB_IP, liveObjectId as string);

    expect(state).not.toBeNull();
    expect(typeof state?.on).toBe('boolean');
    if (state?.brightness !== null) {
      expect(state?.brightness).toBeGreaterThanOrEqual(0);
      expect(state?.brightness).toBeLessThanOrEqual(100);
    }
    for (const channel of [state?.r, state?.g, state?.b]) {
      if (channel !== null && channel !== undefined) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('sets state on the real bulb and reads back the change, then restores the original state', async () => {
    const original = await getState(LIVE_BULB_IP, liveObjectId as string);
    expect(original).not.toBeNull();

    // The device's RGB color mode normalizes chrominance so the max
    // channel is always 255 (brightness is separate) - an arbitrary
    // low-value color like {r:10,g:20,b:30} comes back rescaled
    // (discovered by this test against the real device). Use a color
    // that's already normalized (max channel = 255) so the round-trip
    // is exact and doesn't depend on device-internal rescaling math.
    const testValue = { on: true, brightness: 42, r: 85, g: 170, b: 255 };
    const setSuccess = await setState(LIVE_BULB_IP, liveObjectId as string, testValue);
    expect(setSuccess).toBe(true);

    const afterSet = await getState(LIVE_BULB_IP, liveObjectId as string);
    expect(afterSet).toEqual(testValue);

    const restoreSuccess = await setState(LIVE_BULB_IP, liveObjectId as string, {
      on: original!.on,
      brightness: original!.brightness ?? undefined,
      r: original!.r ?? undefined,
      g: original!.g ?? undefined,
      b: original!.b ?? undefined,
    });
    expect(restoreSuccess).toBe(true);

    const afterRestore = await getState(LIVE_BULB_IP, liveObjectId as string);
    expect(afterRestore).toEqual(original);
  });

  it('returns null/false against a real closed port on the same host network (unreachable device simulation)', async () => {
    // Port 1 is reserved (tcpmux) and essentially never has anything
    // listening on a real device - a genuine connection-refused, not a
    // mocked failure.
    expect(await pingBulb(`${LIVE_BULB_IP}:1`)).toBeNull();
  });
});
