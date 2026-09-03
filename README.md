# kauf-server

[![Release](https://img.shields.io/github/v/release/klaushofrichter/kauf-server?label=release&color=blue)](https://github.com/klaushofrichter/kauf-server/releases)
[![PR checks](https://github.com/klaushofrichter/kauf-server/actions/workflows/production-checks.yml/badge.svg)](https://github.com/klaushofrichter/kauf-server/actions/workflows/production-checks.yml)
[![Build and publish image](https://github.com/klaushofrichter/kauf-server/actions/workflows/build-push.yml/badge.svg)](https://github.com/klaushofrichter/kauf-server/actions/workflows/build-push.yml)
[![Deploy production](https://github.com/klaushofrichter/kauf-server/actions/workflows/deploy-production.yml/badge.svg)](https://github.com/klaushofrichter/kauf-server/actions/workflows/deploy-production.yml)
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](https://github.com/klaushofrichter/kauf-server/security/dependabot)

<!-- The release badge tracks the newest tag, which a successful production
     deploy cuts (see "Releases"). It is the last *released* version, not
     necessarily the running one: a deploy that rolls out and then fails its
     smoke test leaves production ahead of the tag. GET /health is what
     reports the running version.

     The three workflow badges are live status. The Dependabot one is static -
     GitHub publishes no endpoint for alert status on a repo, so it asserts
     that alerts, security updates, and .github/dependabot.yml are all in place
     rather than checking them. If Dependabot is ever turned off, this badge
     will not notice. -->

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

All of the above are also rate-limited, 30 requests per 15 minutes, to
bound brute-force and runaway-client behaviour.

That limit is currently **global rather than per client**, which is not what
it looks like in the code. `express-rate-limit` keys on `req.ip`, but the
k3s Traefik LoadBalancer Service runs `externalTrafficPolicy: Cluster`, so
kube-proxy SNATs the source address before Traefik sees the packet and every
request arrives carrying the same in-cluster address. All callers therefore
share one bucket, and one noisy client can exhaust the budget for everybody
including the signed-in user. No `trust proxy` setting can recover the
address, because it never reaches the cluster; the fix is
`externalTrafficPolicy: Local` on the Traefik Service, which lives in the
separate `kube-setup` repo.

Separately, calls to a physical bulb's own set-state HTTP endpoint are
capped at 3 per second per device IP, regardless of which route triggered
them (`POST /bulb`, `POST /ui/bulb/:id/set`, `POST /bulbs/on`/`off`) — the
device itself can become unresponsive under rapid repeated writes. `POST
/bulb` and `POST /ui/bulb/:id/set` return 429 (`{"error":"rate limited"}`)
when this budget is exhausted, without attempting the device call. The web
UI's modal batches brightness/color changes behind a "Set" button rather
than sending a request per slider tick, for exactly this reason.

See `docs/API.md` for full request/response examples of every endpoint.

## Logging

Every API call is logged as one line of structured JSON on stdout, via
`pino`/`pino-http` (`src/logger.ts`):

```json
{"level":30,"time":1788439572641,"durationMs":13,"kind":"api_request",
 "reqId":"32a3e307-...","method":"GET","path":"/bulbs","status":200,
 "msg":"api_request"}
```

- `kind: "api_request"` is a stable discriminator, so a log query can select
  API lines without matching on message text.
- Levels: `/health` is `debug` (so continuous Knative probes stay off the
  default stream), 401/403/429 are `warn` — those are the rejections that
  used to fail silently — 5xx is `error`, everything else `info`.
- `reqId` honours an inbound `x-request-id`, otherwise a UUID.
- **No credentials are logged.** The `req`/`res` objects are dropped
  entirely, so no headers are serialised: the Bearer token, session cookie
  and any freshly minted `set-cookie` appear nowhere in the output, asserted
  by `test/logger.test.ts`. Query strings are stripped from `path` for the
  same reason.
- No authenticated email is logged: it is personal data leaving the cluster,
  and on a single-user service it carries no analytical value.
- **No client address is logged**, because none arrives. Traefik's Service
  runs `externalTrafficPolicy: Cluster`, so kube-proxy SNATs the source
  before Traefik sees the packet and the client is absent from
  `X-Forwarded-For` entirely. Logging it produced a constant in-cluster
  address identifying nobody. Worth restoring only if that policy changes to
  `Local` — see the rate-limiting note above, which has the same root cause.

Nothing is written to a file. In a container the platform owns the log file —
the kubelet captures stdout and rotates it (k3s defaults to 10Mi × 5 per
container), so a file transport here would fight that rotation and could fill
the container layer or the `bulbs-data` PVC. Set `LOG_LEVEL` to change
verbosity (`silent` in tests; default `info`).

Shipping these to Grafana Cloud is a cluster-side concern, configured in the
separate `kube-setup` repo on the Alloy collector that already runs there —
not something this service does.

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
| `LOG_LEVEL`             | pino log level (default `info`; `silent` in tests). See Logging  |

## Deployment

Deployed as a Knative Service (`bulbs` namespace) on a self-hosted k3s
cluster. Cluster manifests live in the separate `kube-setup` repo, not here.

The persisted bulb directory (`BULBS_DATA_PATH`, default `/data/bulbs.json`)
must live on a PVC mounted at `/data` in production — it holds discovered
bulbs' `firstDiscovered` timestamps and any custom names, neither of which
can be re-derived from a fresh scan, and the PVC is backed up via Velero.

- Push to `main` → tests run, image built and pushed to
  `ghcr.io/klaushofrichter/kauf-server` (tags `main` and the commit SHA).
- PR into `production` → tests, `npm audit --audit-level=high` and a CodeQL
  gate. `production` is a protected branch requiring the `test` and `codeql`
  checks, so promotion goes through a PR from `main`; it can no longer be
  pushed to directly. (E2E is not a separate required context here — the
  Playwright suite runs inside the `test` job.)
- Merge into `production` → cuts a release (see below), image built/pushed
  tagged with the commit SHA, the version, and `latest`; `kube-setup`'s
  `manifests/bulbs/bulbs-ksvc.yaml` updated with the new (SHA-tagged) image
  and applied to the cluster via `kubectl` on a self-hosted runner, then
  smoke-tested against the public URL. What that smoke test observed is
  recorded in the release notes under "Verified at release".

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
