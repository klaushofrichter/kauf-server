// Which upstream addresses are proxies rather than clients.
//
// This was `trust proxy: 1` - trust exactly one hop - with a comment claiming
// req.ip would then be the real client. It was not. The chain in front of this
// service is Traefik -> Kourier/Envoy -> queue-proxy -> here, which is more
// than one hop, so Express stopped walking X-Forwarded-For too early and
// returned a proxy address. Confirmed in production: every logged request,
// from several different public sources, reported ip 10.42.0.15 - a pod
// address in the cluster CIDR.
//
// Two things depended on that being right, and both were silently wrong:
//
//   1. The `ip` field in the request log, which was the same in-cluster
//      address on every line and so useless for seeing where traffic or an
//      attack came from.
//   2. express-rate-limit, which keys on req.ip by default. With one constant
//      value it was not rate limiting per client at all - all callers shared
//      a single 30-requests-per-15-minutes bucket, so one noisy client (or
//      one attacker) could exhaust the budget for everybody, including the
//      signed-in user.
//
// A list rather than a hop count on purpose. Express walks X-Forwarded-For
// from the right, skipping every address that matches this list, and returns
// the first one that does not - the real client, however many proxies are in
// front. A hop count has to be re-tuned whenever the ingress path gains or
// loses a hop, and it fails in the direction that looks healthy: you still get
// *an* address, just the wrong one. That is precisely the failure this
// replaces, and it went unnoticed until the address was actually read.
//
// 10.42.0.0/16 (pods) and 10.43.0.0/16 (services) are the k3s defaults, and
// match the 10.42.0.15 observed in production. 'loopback' covers 127.0.0.1/8
// and ::1/128 for local runs and tests.
export const TRUST_PROXY = ['loopback', '10.42.0.0/16', '10.43.0.0/16'];
