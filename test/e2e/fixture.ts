import fs from 'fs';
import path from 'path';
import { startMockBulb, MockBulbServer } from '../mockBulbServer';

// The one bulb every e2e run sees: a mock Kauf bulb on a fixed local port,
// and a bulbs.json that points the server at it. Fixed rather than random so
// a server started on its own (the Docker image, in CI) can be given the data
// file before it starts. Nothing here touches a real network or a real bulb.
export const MOCK_BULB_PORT = Number(process.env.MOCK_BULB_PORT) || 8098;
export const DATA_DIR = path.join(__dirname, '..', '..', '.e2e-data');
export const DATA_PATH = path.join(DATA_DIR, 'bulbs.json');
export const BULB_ID = 'kauf-bulb-e2e';
export const BULB_NAME = 'E2E Test Bulb';

export async function startFixture(): Promise<MockBulbServer> {
  const mock = await startMockBulb({
    mac: 'AA:BB:CC:DD:EE:FF',
    hostname: BULB_ID,
    title: BULB_NAME,
    objectId: 'kauf_bulb_e2e',
    port: MOCK_BULB_PORT,
  });

  const now = new Date().toISOString();
  const seedBulb = {
    id: BULB_ID,
    mac: 'AA:BB:CC:DD:EE:FF',
    objectId: 'kauf_bulb_e2e',
    name: BULB_NAME,
    firstDiscovered: now,
    lastSeen: now,
    lastIp: `127.0.0.1:${mock.port}`,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify([seedBulb], null, 2));
  return mock;
}
