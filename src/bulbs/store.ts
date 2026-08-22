import fs from 'fs';
import path from 'path';

export interface StoredBulb {
  id: string;
  mac: string;
  objectId: string;
  name: string;
  firstDiscovered: string;
  lastSeen: string;
  lastIp: string;
}

interface UpsertInfo {
  mac: string;
  hostname: string;
  title: string;
  ip: string;
  objectId?: string;
}

function getDataPath(): string {
  return process.env.BULBS_DATA_PATH || '/data/bulbs.json';
}

export function loadBulbs(): StoredBulb[] {
  const filePath = getDataPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

export const listBulbs = loadBulbs;

export function saveBulbs(bulbs: StoredBulb[]): void {
  const filePath = getDataPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(bulbs, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function upsertBulb(info: UpsertInfo): StoredBulb {
  const bulbs = loadBulbs();
  const now = new Date().toISOString();
  const existing = bulbs.find((b) => b.mac === info.mac);

  if (existing) {
    existing.lastSeen = now;
    existing.lastIp = info.ip;
    saveBulbs(bulbs);
    return existing;
  }

  if (!info.objectId) {
    throw new Error(`Cannot create new bulb ${info.mac} without an objectId`);
  }

  const created: StoredBulb = {
    id: info.hostname,
    mac: info.mac,
    objectId: info.objectId,
    name: info.title,
    firstDiscovered: now,
    lastSeen: now,
    lastIp: info.ip,
  };
  bulbs.push(created);
  saveBulbs(bulbs);
  return created;
}

export function getBulb(id: string): StoredBulb | null {
  return loadBulbs().find((b) => b.id === id) ?? null;
}

export function renameBulb(id: string, name: string): StoredBulb | null {
  const bulbs = loadBulbs();
  const existing = bulbs.find((b) => b.id === id);
  if (!existing) {
    return null;
  }

  existing.name = name;
  saveBulbs(bulbs);
  return existing;
}
