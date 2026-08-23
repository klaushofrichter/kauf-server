import { listBulbs, getBulb, renameBulb, StoredBulb } from './store';
import { getState, setState, pingBulb, SetStateOptions, DeviceRateLimitedError } from './deviceApi';

export interface BulbWithState {
  id: string;
  name: string;
  mac: string;
  lastIp: string;
  online: boolean;
  on: boolean | null;
  brightness: number | null;
  r: number | null;
  g: number | null;
  b: number | null;
}

export interface BulbDetail extends BulbWithState {
  firmwareVersion: string | null;
  esphomeVersion: string | null;
}

async function withLiveState(stored: StoredBulb | null): Promise<BulbWithState | null> {
  if (!stored) return null;

  const state = await getState(stored.lastIp, stored.objectId);

  return {
    id: stored.id,
    name: stored.name,
    mac: stored.mac,
    lastIp: stored.lastIp,
    online: state !== null,
    on: state?.on ?? null,
    brightness: state?.brightness ?? null,
    r: state?.r ?? null,
    g: state?.g ?? null,
    b: state?.b ?? null,
  };
}

export async function listWithLiveState(): Promise<BulbWithState[]> {
  const stored = listBulbs();
  const results = await Promise.all(stored.map((bulb) => withLiveState(bulb)));
  return results.filter((b): b is BulbWithState => b !== null);
}

export async function getWithLiveState(id: string): Promise<BulbWithState | null> {
  return withLiveState(getBulb(id));
}

export async function setBulbState(
  id: string,
  options: SetStateOptions
): Promise<{ success: boolean; notFound?: boolean; rateLimited?: boolean; bulb?: BulbWithState }> {
  const stored = getBulb(id);
  if (!stored) {
    return { success: false, notFound: true };
  }

  let success: boolean;
  try {
    success = await setState(stored.lastIp, stored.objectId, options);
  } catch (err) {
    if (err instanceof DeviceRateLimitedError) {
      return { success: false, rateLimited: true };
    }
    throw err;
  }

  if (!success) {
    return { success: false };
  }

  const bulb = await withLiveState(stored);
  return { success: true, bulb: bulb ?? undefined };
}

export async function renameBulbAndGetState(
  id: string,
  name: string
): Promise<{ success: boolean; notFound?: boolean; bulb?: BulbWithState }> {
  const stored = renameBulb(id, name);
  if (!stored) {
    return { success: false, notFound: true };
  }

  const bulb = await withLiveState(stored);
  return { success: true, bulb: bulb ?? undefined };
}

export async function getFullDetail(id: string): Promise<BulbDetail | null> {
  const stored = getBulb(id);
  if (!stored) return null;

  const [bulb, ping] = await Promise.all([withLiveState(stored), pingBulb(stored.lastIp)]);
  if (!bulb) return null;

  return {
    ...bulb,
    firmwareVersion: ping?.firmwareVersion ?? null,
    esphomeVersion: ping?.esphomeVersion ?? null,
  };
}

export async function setAllBulbsState(on: boolean): Promise<{ id: string; success: boolean }[]> {
  const stored = listBulbs();
  return Promise.all(
    stored.map(async (bulb) => {
      try {
        const success = await setState(bulb.lastIp, bulb.objectId, { on });
        return { id: bulb.id, success };
      } catch (err) {
        if (err instanceof DeviceRateLimitedError) {
          return { id: bulb.id, success: false };
        }
        throw err;
      }
    })
  );
}
