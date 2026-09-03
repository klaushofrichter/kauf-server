import { Request, Response, NextFunction } from 'express';

// CSRF defence for the cookie-authenticated /ui/* routes.
//
// Those routes are authorised purely by the session cookie, so without this a
// page on another origin could make the browser POST to /ui/bulbs/off and act
// as the signed-in user. The session cookie is already SameSite=Lax, which
// stops the classic cross-site form POST on its own, but that is a single
// browser-side control and CodeQL (js/missing-token-validation) cannot see it.
// This is the server-side half, and it holds even if the cookie policy is ever
// loosened.
//
// Safe methods are untouched: they do not change state, and GET must keep
// working for top-level navigation.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Derived from the request rather than an env var so there is nothing to
  // keep in sync per environment. `trust proxy` is set to 1 in app.ts, so
  // req.protocol reflects X-Forwarded-Proto from the ingress rather than the
  // in-cluster http hop.
  const expected = `${req.protocol}://${req.get('host')}`;
  const actual = originOf(req.get('origin')) ?? originOf(req.get('referer'));

  // Absent on both headers means this is not a browser doing a cross-site
  // request: browsers attach Origin to every cross-origin POST, so the only
  // callers that arrive bare are non-browser clients, which have no ambient
  // cookie to borrow in the first place. Rejecting here would break those
  // without closing an attack path.
  if (actual !== undefined && actual !== expected) {
    res.status(403).json({ error: 'cross-origin request rejected' });
    return;
  }

  next();
}
