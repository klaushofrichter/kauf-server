import { listBulbs, getBulb, StoredBulb } from './store';
import { getState, setState, SetStateOptions } from './deviceApi';

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
): Promise<{ success: boolean; notFound?: boolean; bulb?: BulbWithState }> {
  const stored = getBulb(id);
  if (!stored) {
    return { success: false, notFound: true };
  }

  const success = await setState(stored.lastIp, stored.objectId, options);
  if (!success) {
    return { success: false };
  }

  const bulb = await withLiveState(stored);
  return { success: true, bulb: bulb ?? undefined };
}
