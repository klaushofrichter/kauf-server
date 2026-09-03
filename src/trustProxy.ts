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
//      value it is not rate limiting per client at all - all callers share a
//      single 30-requests-per-15-minutes bucket, so one noisy client (or one
//      attacker) can exhaust the budget for everybody, including the
//      signed-in user.
//
// IMPORTANT: this setting does NOT fix either of those, and an earlier
// version of this comment wrongly claimed it fixed the second. The k3s
// Traefik LoadBalancer Service runs externalTrafficPolicy: Cluster, so
// kube-proxy SNATs the source address before Traefik sees the packet. The
// client address is absent from X-Forwarded-For entirely rather than further
// along it, and no trust proxy value can recover what never arrived -
// widening the list only moved the reported address from 10.42.0.15 to the
// cni0 bridge at 10.42.0.1. The rate limiter is still global, and the `ip`
// field has been dropped from the request log for the same reason.
//
// What this setting still earns: req.protocol resolves to https from
// X-Forwarded-Proto, which requireSameOrigin depends on to build the expected
// origin - if that were wrong, every state-changing UI request would be
// rejected as cross-origin. Verified in production against the live service.
// And if externalTrafficPolicy is ever set to Local on the Traefik Service,
// the address starts arriving and this resolves it correctly with no further
// change.
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
