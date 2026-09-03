import { createHash } from 'crypto';
import { Request } from 'express';
import rateLimit, { ipKeyGenerator, RateLimitRequestHandler } from 'express-rate-limit';
import { verifySession } from '../session';

const SESSION_COOKIE = 'session';

// Who this request is being counted against.
//
// Previously this was left to express-rate-limit's default, which keys on
// req.ip. That gave one bucket shared by every caller in the world: the k3s
// Traefik Service used to run externalTrafficPolicy: Cluster, so kube-proxy
// SNAT'd the source address and req.ip was the same in-cluster value on every
// request. The README claimed "per client" throughout and it was never true.
//
// Keying on the authenticated principal instead of the address fixes that at
// this layer and keeps it fixed:
//
//   - Each API token gets its own budget, so one integration cannot spend
//     another's, and a token holder cannot be starved by anonymous traffic.
//   - Each signed-in user gets their own, independent of where they connect
//     from.
//   - Everything else falls back to the address.
//
// The fallback still matters even now the cluster forwards real addresses:
// requests originating inside the LAN all arrive as the router's address
// (NAT hairpinning), so an address alone cannot separate the phone from the
// laptop from a script on the same network. The principal can.
//
// Anonymous callers deliberately share the address bucket. That is the
// brute-force surface - somebody trying tokens has no principal yet - and
// bounding it collectively is the point. Because authenticated callers are
// keyed separately, that traffic can no longer exhaust the budget of a
// caller who has already proved who they are.
export function rateLimitKey(req: Request): string {
  const auth = req.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    // Hashed, not raw: the key is held in memory and can surface in
    // diagnostics, and a bearer token should not be sitting in either.
    // Truncated because collision resistance is not what is needed here -
    // only that distinct tokens get distinct buckets.
    const token = auth.slice('Bearer '.length);
    return `t:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`;
  }

  const cookie = req.cookies?.[SESSION_COOKIE];
  if (typeof cookie === 'string') {
    const session = verifySession(cookie);
    // Only a validly signed session counts as a principal - otherwise anyone
    // could mint a key and get a fresh budget by inventing a cookie value.
    if (session?.email) return `s:${session.email}`;
  }

  // ipKeyGenerator rather than req.ip directly: it normalises IPv6 to a
  // subnet, so a caller with a /64 cannot walk addresses for a new budget.
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export function createAuthRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
  });
}
