import http from 'http';
import type { AddressInfo } from 'net';

export interface MockBulbOptions {
  mac?: string;
  hostname?: string;
  title?: string;
  projectName?: string;
  objectId?: string;
}

export interface MockBulbServer {
  port: number;
  stop: () => Promise<void>;
  getLastSetParams: () => URLSearchParams | null;
}

export function startMockBulb(options: MockBulbOptions = {}): Promise<MockBulbServer> {
  const mac = options.mac ?? 'C4:5B:BE:7D:49:E0';
  const hostname = options.hostname ?? 'kauf-bulb-7d49e0';
  const title = options.title ?? 'Kauf Bulb 7d49e0';
  const projectName = options.projectName ?? 'Kauf.RGBWW';
  const objectId = options.objectId ?? 'kauf_bulb_7d49e0';

  const state = { on: true, brightness: 55, r: 39, g: 183, b: 255 };
  let lastSetParams: URLSearchParams | null = null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ping = {
        title,
        esph_v: '2026.3.0',
        proj_n: projectName,
        proj_v: '2.00(u)',
        mac_addr: mac,
        hostname,
      };
      res.write(`event: ping\ndata: ${JSON.stringify(ping)}\n\n`);
      res.write(
        `event: state\ndata: ${JSON.stringify({ id: 'binary_sensor-4mib', domain: 'binary_sensor', entity_category: 2 })}\n\n`
      );
      res.write(
        `event: state\ndata: ${JSON.stringify({ id: 'light-warm_rgb', domain: 'light', entity_category: 1 })}\n\n`
      );
      res.write(
        `event: state\ndata: ${JSON.stringify({ id: 'light-cold_rgb', domain: 'light', entity_category: 1 })}\n\n`
      );
      res.write(
        `event: state\ndata: ${JSON.stringify({
          id: `light-${objectId}`,
          domain: 'light',
          state: state.on ? 'ON' : 'OFF',
          brightness: Math.round((state.brightness / 100) * 255),
          color: { r: state.r, g: state.g, b: state.b },
        })}\n\n`
      );
      // Deliberately never call res.end() here - a real bulb keeps this
      // connection open indefinitely. The client (deviceApi.ts) closes it
      // early via reader.cancel() once it has what it needs.
      return;
    }

    if (url.pathname === `/light/${objectId}` && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          state: state.on ? 'ON' : 'OFF',
          brightness: Math.round((state.brightness / 100) * 255),
          color: { r: state.r, g: state.g, b: state.b },
        })
      );
      return;
    }

    if (url.pathname === `/light/${objectId}/turn_on` && req.method === 'POST') {
      lastSetParams = url.searchParams;
      state.on = true;
      if (url.searchParams.has('brightness')) {
        state.brightness = Math.round((Number(url.searchParams.get('brightness')) / 255) * 100);
      }
      if (url.searchParams.has('r')) state.r = Number(url.searchParams.get('r'));
      if (url.searchParams.has('g')) state.g = Number(url.searchParams.get('g'));
      if (url.searchParams.has('b')) state.b = Number(url.searchParams.get('b'));
      res.writeHead(200);
      res.end();
      return;
    }

    if (url.pathname === `/light/${objectId}/turn_off` && req.method === 'POST') {
      lastSetParams = url.searchParams;
      state.on = false;
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        stop: () => new Promise((r) => server.close(() => r())),
        getLastSetParams: () => lastSetParams,
      });
    });
  });
}
