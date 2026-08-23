import fs from 'fs';
import path from 'path';
import { startMockBulb } from '../mockBulbServer';

const DATA_PATH = path.join(__dirname, '..', '..', '.e2e-data', 'bulbs.json');

export default async function globalSetup(): Promise<void> {
  const mock = await startMockBulb({
    mac: 'AA:BB:CC:DD:EE:FF',
    hostname: 'kauf-bulb-e2e',
    title: 'E2E Test Bulb',
    objectId: 'kauf_bulb_e2e',
  });

  const now = new Date().toISOString();
  const seedBulb = {
    id: 'kauf-bulb-e2e',
    mac: 'AA:BB:CC:DD:EE:FF',
    objectId: 'kauf_bulb_e2e',
    name: 'E2E Test Bulb',
    firstDiscovered: now,
    lastSeen: now,
    lastIp: `127.0.0.1:${mock.port}`,
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify([seedBulb], null, 2));

  // The mock server runs in this (the Playwright CLI's) process, which
  // stays alive for the whole test run and exits when `playwright test`
  // does - its OS socket closes automatically then, so no explicit
  // teardown/stop call is needed here.
}
