import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Writable } from 'stream';
import express from 'express';
import request from 'supertest';
import { createHttpLogger, levelFor, logger, responseBodyLogger } from '../src/logger';

// Collects the JSON lines pino actually emits, so these assert on real output
// rather than on the configuration that was passed in.
function capture(): { lines: Record<string, unknown>[]; raw: string[]; stream: Writable } {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) {
          raw.push(line);
          lines.push(JSON.parse(line));
        }
      }
      cb();
    },
  });
  return { lines, raw, stream };
}

// Counts a key in the RAW line. JSON.parse silently keeps the last value of a
// duplicated key, so parsed-object assertions cannot see duplication at all.
function keyCount(line: string, key: string): number {
  return line.split(`"${key}":`).length - 1;
}

function appWith(stream: Writable) {
  const app = express();
  app.set('trust proxy', ['loopback', '10.42.0.0/16', '10.43.0.0/16']);
  app.use(createHttpLogger(stream));
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.get('/bulbs', (_req, res) => {
    res.status(200).json({ bulbs: [] });
  });
  app.post('/unauthorised', (_req, res) => {
    res.status(401).json({ error: 'unauthorized' });
  });
  app.post('/forbidden', (_req, res) => {
    res.status(403).json({ error: 'cross-origin request rejected' });
  });
  app.post('/limited', (_req, res) => {
    res.status(429).json({ error: 'rate limited' });
  });
  app.get('/sets-cookie', (_req, res) => {
    res.cookie('session', 'super-secret-jwt').status(200).end();
  });
  return app;
}

let lines: Record<string, unknown>[];
let raw: string[];
let stream: Writable;

beforeEach(() => {
  process.env.LOG_LEVEL = 'info';
  ({ lines, raw, stream } = capture());
});

describe('credential redaction', () => {
  it('never emits the Authorization header', async () => {
    await request(appWith(stream))
      .get('/bulbs')
      .set('Authorization', 'Bearer super-secret-token');

    expect(lines).toHaveLength(1);
    // Asserted against the whole serialised line, not just the field we
    // expect it in: the point is that the token is nowhere in what ships.
    expect(JSON.stringify(lines[0])).not.toContain('super-secret-token');
    expect(JSON.stringify(lines[0])).not.toContain('Bearer');
  });

  it('never emits the session cookie', async () => {
    await request(appWith(stream)).get('/bulbs').set('Cookie', 'session=super-secret-jwt');

    expect(JSON.stringify(lines[0])).not.toContain('super-secret-jwt');
  });

  it('never emits a set-cookie the response is minting', async () => {
    await request(appWith(stream)).get('/sets-cookie');

    expect(JSON.stringify(lines[0])).not.toContain('super-secret-jwt');
  });
});

describe('the api_request line', () => {
  it('carries the fields the Grafana panel selects on', async () => {
    await request(appWith(stream)).get('/bulbs');

    expect(lines).toHaveLength(1);
    const line = lines[0] as Record<string, never>;
    expect(line.msg).toBe('api_request');
    expect(line.kind).toBe('api_request');
    expect(line.method).toBe('GET');
    expect(line.path).toBe('/bulbs');
    expect(line.status).toBe(200);
    expect(typeof line.durationMs).toBe('number');
    expect(typeof line.reqId).toBe('string');
  });

  it('strips the query string from the logged path', async () => {
    await request(appWith(stream)).get('/bulbs?id=kauf-bulb-7d49e0&secret=leaky');

    expect(lines[0].path).toBe('/bulbs');
    expect(JSON.stringify(lines[0])).not.toContain('leaky');
  });

  it('honours an inbound x-request-id so a request can be traced end to end', async () => {
    await request(appWith(stream)).get('/bulbs').set('x-request-id', 'trace-me-123');

    expect(lines[0].reqId).toBe('trace-me-123');
  });
});

describe('log levels', () => {
  it('keeps health checks off the default stream', async () => {
    await request(appWith(stream)).get('/health');

    // debug, and the default level is info - so probe traffic ships nothing.
    expect(lines).toHaveLength(0);
  });

  it.each([
    ['/unauthorised', 401],
    ['/forbidden', 403],
    ['/limited', 429],
  ])('logs %s (%i) at warn so rejections are visible', async (path, status) => {
    await request(appWith(stream)).post(path);

    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe(40); // pino: warn
    expect(lines[0].status).toBe(status);
  });

  it('logs ordinary success at info', async () => {
    await request(appWith(stream)).get('/bulbs');

    expect(lines[0].level).toBe(30); // pino: info
  });
});

describe('levelFor', () => {
  it('maps statuses to levels', () => {
    expect(levelFor(200, '/bulbs')).toBe('info');
    expect(levelFor(401, '/bulbs')).toBe('warn');
    expect(levelFor(403, '/bulbs')).toBe('warn');
    expect(levelFor(429, '/bulbs')).toBe('warn');
    expect(levelFor(500, '/bulbs')).toBe('error');
    expect(levelFor(404, '/bulbs')).toBe('info');
  });

  it('treats /health as debug regardless of query string', () => {
    expect(levelFor(200, '/health')).toBe('debug');
    expect(levelFor(200, '/health?probe=1')).toBe('debug');
  });
});

describe('the emitted line is well formed', () => {
  // Regression: customProps was evaluated twice - at request start, where
  // res.statusCode is still 200, and again on response - so any non-2xx line
  // carried every field twice, with a stale status:200 copy first. Every
  // parsed-object assertion above still passed, because JSON.parse keeps the
  // last duplicate. Only the raw line shows it.
  it.each([
    ['/bulbs', 'get', 200],
    ['/unauthorised', 'post', 401],
    ['/forbidden', 'post', 403],
    ['/limited', 'post', 429],
  ])('emits each key exactly once for %s (%s -> %i)', async (path, method, status) => {
    const agent = request(appWith(stream));
    await (method === 'get' ? agent.get(path) : agent.post(path));

    expect(raw).toHaveLength(1);
    for (const key of ['kind', 'reqId', 'method', 'path', 'status', 'ip', 'durationMs']) {
      expect(keyCount(raw[0], key), `key "${key}" duplicated in: ${raw[0]}`).toBe(1);
    }
    expect(lines[0].status).toBe(status);
  });
});

describe('the client address is logged', () => {
  // Restored once the Traefik Service moved to externalTrafficPolicy: Local,
  // so a real address reaches the app instead of a constant in-cluster one.
  // The app under test here sets the same trust proxy list as createApp().
  it('reports the client from the forwarded chain, not a proxy hop', async () => {
    await request(appWith(stream))
      .get('/bulbs')
      .set('X-Forwarded-For', '72.177.88.245, 10.42.0.15, 10.43.0.1');

    expect(lines).toHaveLength(1);
    expect(lines[0].ip).toBe('72.177.88.245');
    expect(raw[0]).not.toContain('10.42.');
  });
});


describe('response body logging', () => {
  function bodyApp(stream: Writable) {
    const app = express();
    app.use(createHttpLogger(stream));
    app.use(responseBodyLogger);
    app.get('/json', (_req, res) => {
      res.status(200).json({ secret: 'payload-contents', n: 1 });
    });
    app.get('/big', (_req, res) => {
      res.status(200).type('text/plain').send('x'.repeat(20 * 1024));
    });
    app.get('/binary', (_req, res) => {
      res.status(200).type('image/png').send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    return app;
  }

  // The module-level logger reads LOG_LEVEL once, at import, so setting the
  // env var here would do nothing - test/setup.ts has already pinned it to
  // silent. pino allows the level to be changed at runtime, which is what
  // actually gates the capture.
  const originalLevel = logger.level;
  afterEach(() => {
    logger.level = originalLevel;
  });
  it('emits the body at debug, never above it', async () => {
    logger.level = 'debug';
    const captured: Record<string, unknown>[] = [];
    const spy = vi.spyOn(logger, 'debug').mockImplementation(((obj: unknown) => {
      captured.push(obj as Record<string, unknown>);
    }) as never);
    const warn = vi.spyOn(logger, 'warn');
    const info = vi.spyOn(logger, 'info');

    await request(bodyApp(stream)).get('/json');

    const bodyLine = captured.find((l) => l.kind === 'api_response_body');
    expect(bodyLine).toBeDefined();
    expect(bodyLine!.body).toContain('payload-contents');

    // The whole safety mechanism: the collector drops debug before anything
    // leaves the cluster. A body at info/warn would ship to a third party.
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    spy.mockRestore();
    warn.mockRestore();
    info.mockRestore();
  });

  it('captures nothing at all when debug is off', async () => {
    logger.level = 'info';
    const spy = vi.spyOn(logger, 'debug');

    await request(bodyApp(stream)).get('/json');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('truncates a large body rather than holding all of it', async () => {
    logger.level = 'debug';
    const captured: Record<string, unknown>[] = [];
    const spy = vi.spyOn(logger, 'debug').mockImplementation(((obj: unknown) => {
      captured.push(obj as Record<string, unknown>);
    }) as never);

    await request(bodyApp(stream)).get('/big');

    const line = captured.find((l) => l.kind === 'api_response_body');
    expect(line!.truncated).toBe(true);
    expect((line!.body as string).length).toBeLessThanOrEqual(8 * 1024);
    spy.mockRestore();
  });

  it('does not try to capture a binary body', async () => {
    logger.level = 'debug';
    const captured: Record<string, unknown>[] = [];
    const spy = vi.spyOn(logger, 'debug').mockImplementation(((obj: unknown) => {
      captured.push(obj as Record<string, unknown>);
    }) as never);

    await request(bodyApp(stream)).get('/binary');

    const line = captured.find((l) => l.kind === 'api_response_body');
    expect(line!.body).toContain('not captured');
    spy.mockRestore();
  });
});
