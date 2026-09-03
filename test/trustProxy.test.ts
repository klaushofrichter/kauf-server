import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { TRUST_PROXY } from '../src/trustProxy';

// Configured exactly as createApp() does, then asked what it resolved. The
// previous setting (`trust proxy: 1`) passed every test in the suite while
// being wrong in production, because nothing ever asserted on req.ip.
function ipReflector() {
  const app = express();
  app.set('trust proxy', TRUST_PROXY);
  app.get('/whoami', (req, res) => {
    res.status(200).json({ ip: req.ip });
  });
  return app;
}

describe('client address resolution behind the ingress chain', () => {
  it('returns the real client through the full Traefik -> Kourier -> queue-proxy chain', async () => {
    // Three in-cluster hops appended left-to-right, client leftmost - the
    // shape that `trust proxy: 1` mis-read as 10.42.0.15.
    const response = await request(ipReflector())
      .get('/whoami')
      .set('X-Forwarded-For', '72.177.88.245, 10.42.0.9, 10.42.0.15, 10.43.0.1');

    expect(response.body.ip).toBe('72.177.88.245');
  });

  it('is not sensitive to how many proxies are in the chain', async () => {
    // The whole reason for a CIDR list over a hop count: adding or removing
    // an in-cluster hop must not change the answer.
    for (const chain of [
      '72.177.88.245, 10.42.0.15',
      '72.177.88.245, 10.42.0.15, 10.43.0.1',
      '72.177.88.245, 10.42.0.9, 10.42.0.15, 10.43.0.1, 10.42.0.7',
    ]) {
      const response = await request(ipReflector()).get('/whoami').set('X-Forwarded-For', chain);
      expect(response.body.ip, `chain: ${chain}`).toBe('72.177.88.245');
    }
  });

  it('does not let a client forge its address by pre-seeding X-Forwarded-For', async () => {
    // A spoofed public address to the left of the real one must not win:
    // Express stops at the first untrusted entry from the right, which is the
    // address the outermost trusted proxy actually observed.
    const response = await request(ipReflector())
      .get('/whoami')
      .set('X-Forwarded-For', '1.2.3.4, 72.177.88.245, 10.42.0.15');

    expect(response.body.ip).toBe('72.177.88.245');
  });

  it('falls back to the socket address when there is no X-Forwarded-For', async () => {
    const response = await request(ipReflector()).get('/whoami');

    // Loopback in tests; the point is that it resolves rather than throwing.
    expect(response.body.ip).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
  });

  it('covers the k3s pod and service CIDRs plus loopback', () => {
    expect(TRUST_PROXY).toContain('10.42.0.0/16');
    expect(TRUST_PROXY).toContain('10.43.0.0/16');
    expect(TRUST_PROXY).toContain('loopback');
  });
});
