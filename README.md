# kauf-server

Container that discovers and controls Kauf smart bulbs on the local network,
exposing a web UI and an API. Runs on a local Kubernetes (k3s) cluster.

Bulb discovery runs automatically in-process: the server periodically sweeps
the configured LAN CIDR for Kauf ESPHome devices, records what it finds, and
serves both a Bearer-token-protected control API and a Google-authenticated
web UI on top of that discovered/persisted bulb directory.

Public web UI: https://bulbs.skylar.technology

## Endpoints

- `GET /health` — unprotected liveness check, returns
  `{"status":"ok","version":"<version>"}` (see Releases below; `"dev"` for a
  non-release build).
- `GET /bulbs` — protected by a Bearer token (`Authorization: Bearer <token>`,
  see `BULBS_API_TOKENS` below). Returns `{"bulbs":[...]}`, the discovered
  bulb directory merged with each bulb's live state.
- `GET /bulb?id=<id>` — protected the same way. Returns a single bulb's
  details and live state, or 404 if the id is unknown. Also includes
  `firmwareVersion` and `esphomeVersion` (each `string | null`, `null` if
  the device didn't respond to the info request — independently of
  `online`).
- `POST /bulb?id=<id>` — protected the same way. Sets bulb state; accepts a
  JSON body with any of `on`, `brightness` (0-100), `r`/`g`/`b` (0-255), and
  `transition` (ms). Returns the updated bulb, 404 for an unknown id, 502 if
  the bulb didn't respond, or 429 if the device call was rate-limited (see
  below).
- `PUT /bulb?id=<id>` — protected the same way. Sets a bulb's nickname;
  accepts a JSON body `{"name": "..."}`. Returns the updated bulb, 404 for
  an unknown id, or 400 if `name` is missing/empty. The nickname is
  persisted (unlike on/off/brightness/color, which are always read live
  from the device) and is what `GET /bulbs`/`GET /bulb` return as `name`.
- `POST /bulbs/on`, `POST /bulbs/off` — protected the same way. Turn every
  known bulb on/off. No body. Returns `{"results":[{"id":...,
  "success":true|false}, ...]}` — never fails the whole request for one
  bulb's failure.
- `POST /discover` — protected the same way. Runs a discovery scan
  synchronously (blocking; a full subnet sweep can take several seconds)
  rather than waiting for the automatic interval. No body. Returns
  `{"bulbsFound": <number>, "bulbs": [...]}` (same shape as `GET /bulbs`).
- `GET /` — web UI, requires signing in with Google (restricted to emails in
  `ALLOWED_EMAILS`). The header shows the running build's version (see
  Releases below) to the left of the signed-in email.
- `POST /ui/bulb/:id/toggle` — web UI action that toggles a bulb on/off;
  requires the same session auth as `GET /`, then redirects back to `/`.
- `POST /ui/bulb/:id/name` — web UI action used by the modal's nickname
  editor; requires the same session auth, accepts `{"name": "..."}`, and
  returns the re-fetched bulb detail JSON (or 400 for an empty name, 404 for
  an unknown id).
- `GET /auth/google/callback`, `GET /auth/logout` — OAuth plumbing for the
  web UI.
- `GET /favicon.png` — unprotected, serves the site favicon.

All of the above are also rate-limited (30 requests per 15 minutes per
client) to bound brute-force and runaway-client behavior.

Separately, calls to a physical bulb's own set-state HTTP endpoint are
capped at 3 per second per device IP, regardless of which route triggered
them (`POST /bulb`, `POST /ui/bulb/:id/set`, `POST /bulbs/on`/`off`) — the
device itself can become unresponsive under rapid repeated writes. `POST
/bulb` and `POST /ui/bulb/:id/set` return 429 (`{"error":"rate limited"}`)
when this budget is exhausted, without attempting the device call. The web
UI's modal batches brightness/color changes behind a "Set" button rather
than sending a request per slider tick, for exactly this reason.

See `docs/API.md` for full request/response examples of every endpoint.

## Development

```bash
npm install
cp .env.example .env   # fill in real values
npm run dev             # runs src/server.ts directly via tsx, no build step
npm test                # runs the Vitest suite once (this is what gates CI)
npm run test:e2e         # runs Playwright E2E tests against a mock bulb
                          # server; separate from the CI-gating `npm test`,
                          # but also run in CI as extra steps in the
                          # GitHub Actions workflows
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
  `ghcr.io/klaushofrichter/kauf-server` (tags `main` and the commit SHA).
- PR into `production` → tests + CodeQL gate.
- Push to `production` → cuts a release (see below), image built/pushed
  tagged with the commit SHA, the version, and `latest`; `kube-setup`'s
  `manifests/bulbs/bulbs-ksvc.yaml` updated with the new (SHA-tagged) image
  and applied to the cluster via `kubectl` on a self-hosted runner.

### Releases

Merging into `production` cuts a release. The version is **generated at
deploy time** as `YYYY.MM.DD.N` (e.g. `2026.08.24.1`), where `N` counts that
day's releases — there is no version in the sources to bump or forget. Dates
are Central, so an evening deploy is not filed under tomorrow. The same
value is what `GET /health` and the web UI header show; the git/image tags
carry the conventional `v` prefix (`v2026.08.24.1`) but the displayed/API
value does not.

```
ghcr.io/klaushofrichter/kauf-server:v2026.08.24.1   the released build
ghcr.io/klaushofrichter/kauf-server:latest          whatever production runs
ghcr.io/klaushofrichter/kauf-server:main            newest main build, not deployed
ghcr.io/klaushofrichter/kauf-server:<sha>           every build, by commit
```

`latest` is published by the production deploy rather than by `main`, so
pulling it gives what is actually deployed instead of an untested build.

Release notes are generated from `CHANGELOG.md`'s `## [Unreleased]` section
(curate it before merging to `production` if you want specific notes
published) plus the commits since the previous release. See
[CHANGELOG.md](CHANGELOG.md) and the
[releases page](https://github.com/klaushofrichter/kauf-server/releases).
