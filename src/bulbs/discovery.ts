import { pingBulb, findLightEntity } from './deviceApi';
import { loadBulbs, upsertBulb } from './store';

const SCAN_CONCURRENCY = 40;

function getCidr(): string {
  return process.env.BULB_SCAN_CIDR || '192.168.1.0/24';
}

function getIntervalMs(): number {
  return Number(process.env.BULB_SCAN_INTERVAL_MS) || 20 * 60 * 1000;
}

export function listCidrAddresses(cidr: string): string[] {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const baseParts = base.split('.').map(Number);
  const baseInt = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3];
  const hostBits = 32 - prefix;
  const numHosts = Math.pow(2, hostBits);
  const networkInt = baseInt & (~0 << hostBits);

  const addresses: string[] = [];
  for (let offset = 1; offset < numHosts - 1; offset++) {
    const ipInt = networkInt + offset;
    addresses.push(
      [(ipInt >>> 24) & 255, (ipInt >>> 16) & 255, (ipInt >>> 8) & 255, ipInt & 255].join('.')
    );
  }
  return addresses;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function runDiscoveryScan(cidr: string = getCidr()): Promise<number> {
  const addresses = listCidrAddresses(cidr);
  const knownMacs = new Set(loadBulbs().map((b) => b.mac));
  let foundCount = 0;

  await runWithConcurrency(addresses, SCAN_CONCURRENCY, async (ip) => {
    const ping = await pingBulb(ip);
    if (!ping) return;

    foundCount++;

    if (knownMacs.has(ping.mac)) {
      upsertBulb({ mac: ping.mac, hostname: ping.hostname, title: ping.title, ip });
      return;
    }

    const objectId = await findLightEntity(ip);
    if (!objectId) return;

    upsertBulb({ mac: ping.mac, hostname: ping.hostname, title: ping.title, ip, objectId });
  });

  return foundCount;
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startDiscoveryLoop(): void {
  if (intervalHandle) return;
  runDiscoveryScan().catch((error) => console.error('Discovery scan failed:', error));
  intervalHandle = setInterval(() => {
    runDiscoveryScan().catch((error) => console.error('Discovery scan failed:', error));
  }, getIntervalMs());
}

export function stopDiscoveryLoop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
