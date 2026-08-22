# kauf-server: auth/API skeleton design

Date: 2026-08-22

## What this is

`kauf-server` is a container, deployed to a local Kubernetes (k3s) cluster,
that will eventually discover and control Kauf smart bulbs on the local
network via a web UI and an API. This spec covers only the first phase: a
skeleton with working Google OAuth login/logout for the web UI, an
unprotected `/health` endpoint, and a Bearer-token-protected `GET /bulbs`
endpoint returning a stub response. Bulb discovery and control are out of
scope here and will get their own design once this skeleton is deployed.

The public web UI is `https://bulbs.skylar.technology`. The pattern mirrors
the sibling `steps-service` repo (Express + TypeScript app, Knative Service
on k3s, GitHub Actions promotion-flow deploy via the `kube-setup` repo).

## Architecture

Plain Express app in TypeScript, composed the same way as steps-service:

- `src/app.ts` — `createApp()`, wires middleware and routers
- `src/server.ts` — starts the HTTP listener
- `src/config.ts` — `assertRequiredEnv()`, fails fast on missing env vars
- `src/session.ts` — signs/verifies a JWT session cookie using `COOKIE_SECRET`
- `src/middleware/requireAuth.ts` — redirects to Google's OAuth consent
  screen if there's no valid session cookie; also builds the Google auth URL
- `src/middleware/requireToken.ts` — Bearer-token check for API routes,
  using `timingSafeEqual` against a comma-separated token list from an env
  var
- `src/middleware/authRateLimit.ts` — rate limit on the OAuth callback route
- `src/routes/auth.ts` — `GET /auth/google/callback`, `GET /auth/logout`
- `src/routes/health.ts` — `GET /health`, unprotected, `{status: "ok"}`
- `src/routes/bulbs.ts` — `GET /bulbs`, protected by `requireToken`, returns
  a stub JSON array (empty list or a single hardcoded placeholder bulb)
- `src/routes/index.ts` — `GET /`, protected by `requireAuth`, renders a
  minimal HTML page: signed-in user's email, a "Sign out" link, and a
  placeholder area for the bulb list (not wired to live data yet)
- `src/views/page.ts` — returns the HTML string for `/`

## Auth model

Two independent gates, same as steps-service:

- **Browser UI** (`/`): Google OAuth. `requireAuth` redirects unauthenticated
  requests to Google; the callback route exchanges the code, verifies the ID
  token, checks the email against a `ALLOWED_EMAILS` allowlist, and sets a
  signed JWT cookie (`session`, httpOnly, secure, sameSite=lax, 7 day
  expiry). `/auth/logout` clears the cookie.
- **API** (`/bulbs`): static Bearer token(s) from `BULBS_API_TOKENS` (comma
  separated, checked with constant-time comparison). No relation to the
  OAuth session.

`/health` requires neither.

## Environment variables

Required (fail fast on boot if missing, per `config.ts`):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `COOKIE_SECRET`
- `ALLOWED_EMAILS`
- `BULBS_API_TOKENS`

## Data flow

No persistence in this phase — the stub `/bulbs` response is a hardcoded
value in `routes/bulbs.ts`. No database, no in-memory store beyond the
signed session cookie (which is stateless/self-contained, unlike
steps-service's `store.ts`).

## Error handling

- Missing/invalid Bearer token on `/bulbs` → `401 {error: "unauthorized"}`
- No/invalid session cookie on `/` → `302` redirect to Google's OAuth screen
- OAuth callback: missing code → `401`; token exchange or ID-token
  verification failure → `401`; email not in `ALLOWED_EMAILS` → `403`

## Testing

Vitest + Supertest against `createApp()` directly, mirroring steps-service's
test structure:

- `/health` returns `200 {status: "ok"}` with no auth
- `/bulbs` returns `401` with no token, `401` with a wrong token, `200` with
  a valid token
- `/` redirects (`302`) to Google's OAuth URL when unauthenticated
- `/auth/google/callback` returns `401` with a missing/empty code
- `/auth/logout` clears the cookie and redirects to `/`

OAuth token exchange itself (calls to Google) is not covered by tests here,
matching steps-service's approach (mocking `OAuth2Client` isn't done there
either).

## Deployment

Mirrors steps-service's promotion-flow pattern:

- Repo: `klaushofrichter/kauf-server` (public, MIT license) — created
- Namespace / Knative Service name: `bulbs`
- Image: `ghcr.io/klaushofrichter/kauf-server`
- Domain mapping: `bulbs.skylar.technology` (DNS already configured)
- `kube-setup` additions: namespace entry in `00-namespaces.yaml`,
  `manifests/bulbs/bulbs-ksvc.yaml`, `manifests/bulbs/bulbs-domainmapping.yaml`
- Kubernetes secret `bulbs-oauth` in the `bulbs` namespace holding
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
  `COOKIE_SECRET`, `ALLOWED_EMAILS`, `BULBS_API_TOKENS` — created manually
  via `kubectl`, not committed to any repo
- Three GitHub Actions workflows, same as steps-service:
  - `build-push.yml` — on push to `main`: test, build/push image
    (`latest` + commit SHA) to ghcr.io
  - `production-checks.yml` — on PRs targeting `production`: test + CodeQL
    gate
  - `deploy-production.yml` — on push to `production`: build/push image
    tagged with SHA, clone `kube-setup` with `KUBE_SETUP_DEPLOY_TOKEN`,
    update the image tag in `bulbs-ksvc.yaml`, commit/push, `kubectl apply`,
    wait for rollout — runs on the existing `[self-hosted, k3s]` runner
  - No data-capture/restore step is needed here (unlike steps-service) since
    this phase has no persisted state to preserve across deploys

## Prerequisites blocking full deployment

Two manual, one-time steps the user performs (can't be scripted):

1. A dedicated Google OAuth 2.0 Web application Client ID in the
   `skylar-technology` GCP project, with authorized redirect URIs
   `https://bulbs.skylar.technology/auth/google/callback` and
   `http://localhost:8080/auth/google/callback`.
2. A fine-grained GitHub PAT scoped to `contents:write` on
   `klaushofrichter/kube-setup` only, added as the `KUBE_SETUP_DEPLOY_TOKEN`
   repo secret on `kauf-server`.

Everything else — repo scaffolding, app code, tests, Dockerfile, CI
workflows, kube-setup manifests, the `bulbs-oauth` k8s secret, local build,
and cluster deploy — is done without further user input once those two
values are supplied.
