# kauf-server

Container that discovers and controls Kauf smart bulbs on the local network,
exposing a web UI and an API. Runs on a local Kubernetes (k3s) cluster.

This phase ships the skeleton: Google OAuth login/logout for the web UI, an
unprotected health check, and a Bearer-token-protected `/bulbs` endpoint
returning a stub response. Bulb discovery and control land in a later phase.

Public web UI: https://bulbs.skylar.technology

## Endpoints

- `GET /health` — unprotected liveness check, returns `{"status":"ok"}`.
- `GET /bulbs` — protected by a Bearer token (`Authorization: Bearer <token>`,
  see `BULBS_API_TOKENS` below). Returns `{"bulbs":[]}` in this phase.
- `GET /` — web UI, requires signing in with Google (restricted to emails in
  `ALLOWED_EMAILS`).
- `GET /auth/google/callback`, `GET /auth/logout` — OAuth plumbing for the
  web UI.
- `GET /favicon.png` — unprotected, serves the site favicon.

## Development

```bash
npm install
cp .env.example .env   # fill in real values
npm run dev             # runs src/server.ts directly via tsx, no build step
npm test                # runs the Vitest suite once
npm run build            # compiles src/ -> dist/
npm start                # runs the compiled dist/server.js
```

## Environment variables

| Variable               | Purpose                                                        |
|-------------------------|------------------------------------------------------------------|
| `GOOGLE_CLIENT_ID`      | Google OAuth 2.0 client ID                                       |
| `GOOGLE_CLIENT_SECRET`  | Google OAuth 2.0 client secret                                   |
| `GOOGLE_REDIRECT_URI`   | Must match a redirect URI registered on the OAuth client         |
| `COOKIE_SECRET`         | Secret used to sign the session JWT cookie                       |
| `ALLOWED_EMAILS`        | Comma-separated list of emails allowed to sign in to the web UI  |
| `BULBS_API_TOKENS`      | Comma-separated list of valid Bearer tokens for `/bulbs`         |

## Deployment

Deployed as a Knative Service (`bulbs` namespace) on a self-hosted k3s
cluster. Cluster manifests live in the separate `kube-setup` repo, not here.

- Push to `main` → tests run, image built and pushed to
  `ghcr.io/klaushofrichter/kauf-server` (tags `latest` and the commit SHA).
- PR into `production` → tests + CodeQL gate.
- Push to `production` → image built/pushed tagged with the commit SHA,
  `kube-setup`'s `manifests/bulbs/bulbs-ksvc.yaml` updated with the new
  image tag and applied to the cluster via `kubectl` on a self-hosted
  runner.
