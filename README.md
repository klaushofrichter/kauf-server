# kauf-server

Container that discovers and controls Kauf smart bulbs on the local network,
exposing a web UI and an API. Runs on a local Kubernetes (k3s) cluster.

Bulb discovery runs automatically in-process: the server periodically sweeps
the configured LAN CIDR for Kauf ESPHome devices, records what it finds, and
serves both a Bearer-token-protected control API and a Google-authenticated
web UI on top of that discovered/persisted bulb directory.

Public web UI: https://bulbs.skylar.technology

## Endpoints

- `GET /health` — unprotected liveness check, returns `{"status":"ok"}`.
- `GET /bulbs` — protected by a Bearer token (`Authorization: Bearer <token>`,
  see `BULBS_API_TOKENS` below). Returns `{"bulbs":[...]}`, the discovered
  bulb directory merged with each bulb's live state.
- `GET /bulb?id=<id>` — protected the same way. Returns a single bulb's
  details and live state, or 404 if the id is unknown.
- `POST /bulb?id=<id>` — protected the same way. Sets bulb state; accepts a
  JSON body with any of `on`, `brightness` (0-100), `r`/`g`/`b` (0-255), and
  `transition` (ms). Returns the updated bulb, 404 for an unknown id, or 502
  if the bulb didn't respond.
- `GET /` — web UI, requires signing in with Google (restricted to emails in
  `ALLOWED_EMAILS`).
- `POST /ui/bulb/:id/toggle` — web UI action that toggles a bulb on/off;
  requires the same session auth as `GET /`, then redirects back to `/`.
- `GET /auth/google/callback`, `GET /auth/logout` — OAuth plumbing for the
  web UI.
- `GET /favicon.png` — unprotected, serves the site favicon.

All of the above are also rate-limited (30 requests per 15 minutes per
client) to bound brute-force and runaway-client behavior.

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
| `BULBS_API_TOKENS`      | Comma-separated list of valid Bearer tokens for `/bulbs`, `/bulb`|
| `BULBS_DATA_PATH`       | Path to the persisted bulb directory JSON file (default `/data/bulbs.json`) |
| `BULB_SCAN_CIDR`        | CIDR of the LAN to sweep for Kauf bulbs during discovery         |
| `BULB_SCAN_INTERVAL_MS` | How often the in-process discovery sweep runs, in milliseconds   |

## Deployment

Deployed as a Knative Service (`bulbs` namespace) on a self-hosted k3s
cluster. Cluster manifests live in the separate `kube-setup` repo, not here.

The persisted bulb directory (`BULBS_DATA_PATH`, default `/data/bulbs.json`)
must live on a PVC mounted at `/data` in production — it holds discovered
bulbs' `firstDiscovered` timestamps and any custom names, neither of which
can be re-derived from a fresh scan, and the PVC is backed up via Velero.

- Push to `main` → tests run, image built and pushed to
  `ghcr.io/klaushofrichter/kauf-server` (tags `latest` and the commit SHA).
- PR into `production` → tests + CodeQL gate.
- Push to `production` → image built/pushed tagged with the commit SHA,
  `kube-setup`'s `manifests/bulbs/bulbs-ksvc.yaml` updated with the new
  image tag and applied to the cluster via `kubectl` on a self-hosted
  runner.
