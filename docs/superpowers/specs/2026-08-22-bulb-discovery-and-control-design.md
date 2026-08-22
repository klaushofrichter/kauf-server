# Bulb discovery, persistence, and control API design

Date: 2026-08-22

## What this is

The second phase of `kauf-server`: discovering Kauf RGBWW smart bulbs on the
local network, persisting a directory of them across restarts, and exposing
a token-protected REST API plus a minimal web UI to read status and turn
bulbs on/off. Reading/setting brightness and RGB color is a full API
capability in this phase; the UI only surfaces on/off + status (a richer
UI is a later phase).

This phase supersedes the `/bulbs` stub from the skeleton phase
(`docs/superpowers/specs/2026-08-22-kauf-server-skeleton-design.md`) with a
real implementation.

## Research: the device's own API (firmware 2.0, verified live)

Kauf bulbs run ESPHome firmware. Verified directly against the one
currently-installed bulb (IP `192.168.1.26`, firmware `2.00(u)`, ESPHome
`2026.3.0`) — this differs in one important way from an older sibling
project (`../kauf-bulb`) written against firmware 1.x, which assumed a
fixed light-entity path `/light/kauf_bulb`. On firmware 2.0 that path
**404s** — the entity's `object_id` is unique per bulb.

**Device info** — `GET /events` with `Accept: text/event-stream` (Server-Sent
Events). The connection stays open; the first `ping` frame carries device
identity:

```
event: ping
data: {"title":"Kauf Bulb 7d49e0","esph_v":"2026.3.0","proj_n":"Kauf.RGBWW",
       "proj_v":"2.00(u)","mac_addr":"C4:5B:BE:7D:49:E0",
       "hostname":"kauf-bulb-7d49e0", ...}
```

`proj_n == "Kauf.RGBWW"` is the signature that confirms "this is a Kauf
bulb" (as opposed to some other device that happens to answer on port 80).
`hostname` (e.g. `kauf-bulb-7d49e0`) is used directly as our bulb `id` — it's
already unique, human-recognizable, and matches the device's own mDNS name.

Immediately after the `ping` frame, the stream emits one `state` event per
ESPHome entity on the device. Kauf bulbs expose three `light` entities: two
hidden config lights (`entity_category:1`, names "Warm RGB"/"Cold RGB" —
not the visible bulb) and one primary light with no `entity_category` field
set — that's the one to control:

```
event: state
data: {"name_id":"light/Kauf Bulb 7d49e0","id":"light-kauf_bulb_7d49e0",
       "domain":"light","name":"Kauf Bulb 7d49e0","value":"ON",
       "color_mode":"rgb","state":"ON","brightness":140,
       "color":{"r":39,"g":183,"b":255}, ...}
```

The primary light's `object_id` for REST calls is its `id` field with the
`light-` prefix stripped: `light-kauf_bulb_7d49e0` → `kauf_bulb_7d49e0`.
This only needs to be read once per bulb (at discovery time) and persisted
— it doesn't change unless the device is re-flashed.

**State and control** (verified live against `192.168.1.26` with
`objectId=kauf_bulb_7d49e0`):

- `GET /light/<objectId>` → `{"state":"ON"|"OFF","brightness":0-255,"color":{"r":0-255,"g":0-255,"b":0-255},...}`
- `POST /light/<objectId>/turn_on?brightness=<0-255>&r=<0-255>&g=<0-255>&b=<0-255>&transition=<seconds>` → `200`, empty body. All query params optional — omitted ones leave that attribute unchanged.
- `POST /light/<objectId>/turn_off?transition=<seconds>` → `200`, empty body.

Our own API uses brightness 0–100 (percent) for consistency with the rest
of the skeleton's conventions; the device call converts
`Math.round((brightness / 100) * 255)`. `transition` in our API is
milliseconds; the device call divides by 1000 (seconds).

## Discovery

**Why not mDNS**: mDNS needs multicast, which needs `hostNetwork: true` on
the pod — a bigger networking/security footprint change, and the mDNS
library ecosystem's Linux platform requirements (Avahi) are unverified
inside an Alpine container. This cluster's other LAN-facing service
(`home-assistant`) does not use `hostNetwork` either. Outbound HTTP from a
pod to a LAN IP works fine through normal k3s pod networking (verified:
this is exactly what the deploy pipeline itself does when curling
`bulbs.skylar.technology` from outside, and pods routinely reach
`ghcr.io`/GitHub over the same path — outbound is never the constrained
direction here).

**Approach**: an HTTP subnet scan. For every IP in `BULB_SCAN_CIDR`
(default `192.168.1.0/24`, 254 addresses), attempt `GET /events` with an
~800ms timeout, concurrency-limited (40 in flight) so a full sweep takes a
few seconds, not minutes. A response whose first `ping` frame has
`proj_n === "Kauf.RGBWW"` is a confirmed Kauf bulb; anything else (timeout,
connection refused, wrong `proj_n`) is silently skipped — a scan never
throws.

For a newly-discovered MAC, the scanner keeps reading the same SSE stream
past the `ping` frame just far enough to find the primary light entity's
`state` event and extract `objectId` (see above), then persists the bulb
and closes the connection. For an already-known MAC, only the `ping` frame
is needed (to confirm reachability and refresh `lastIp`) — the connection
is closed immediately after, no need to re-read `objectId`.

**Scheduling**: an in-process timer inside the existing `kauf-server`
process — `startDiscoveryLoop()` runs one scan immediately on server
startup, then every `BULB_SCAN_INTERVAL_MS` (default `20 * 60 * 1000`).
Not a separate Kubernetes CronJob: the ksvc already runs a single
always-on replica (`min-scale: '1'`, `max-scale: '1'`), so a second
scheduled workload would only add PVC-sharing complexity (multiple pods
writing the same file) for no benefit — one process owns the file
exclusively.

## Persistence

`bulbs-data-pvc` — 100Mi, dynamically provisioned via the cluster's
`local-path` default storage class (unlike `home-assistant-pvc`, which
uses a hand-pinned `hostPath` `PersistentVolume` — not needed here since
we don't need node-pinning for a tiny JSON file). Mounted at `/data` in
the ksvc; file path `/data/bulbs.json` (configurable via `BULBS_DATA_PATH`
env var, default `/data/bulbs.json`).

Format — a JSON array, one object per bulb:

```json
[
  {
    "id": "kauf-bulb-7d49e0",
    "mac": "C4:5B:BE:7D:49:E0",
    "objectId": "kauf_bulb_7d49e0",
    "name": "Kauf Bulb 7d49e0",
    "firstDiscovered": "2026-08-22T19:00:00.000Z",
    "lastSeen": "2026-08-22T19:20:00.000Z",
    "lastIp": "192.168.1.26"
  }
]
```

`id`, `mac`, `objectId`, `firstDiscovered` are written once at first
discovery and never modified. `lastSeen`/`lastIp` update on every scan
that successfully reaches the bulb. A bulb not seen in the most recent
scan is **kept**, not deleted — it's reported `online: false` in API
responses rather than disappearing (a temporarily unplugged bulb shouldn't
lose its directory entry). `name` is the device-reported `title` at
discovery time; no rename capability in this phase (a future phase can add
one — the persisted `name` field is deliberately separate from the
immutable identity fields so it can become user-editable later without a
schema change).

If `/data/bulbs.json` doesn't exist yet (first boot, fresh PVC), treat it
as an empty directory rather than failing to start.

**Backup**: the ksvc's pod template gets the annotation
`backup.velero.io/backup-volumes: bulbs-data` (matching the PVC's volume
name in the pod spec), so Velero's existing `node-agent` DaemonSet
captures the actual file contents via filesystem backup as part of the
existing `daily-full-backup` Schedule — real data backup, not just the
PVC's Kubernetes object definition (which is the gap `home-assistant-pvc`
currently has, documented in its own manifest).

## Live state vs. persisted data

The persisted file holds identity (MAC, objectId) and last-known
reachability — never on/off/brightness/color. `GET /bulbs` and
`GET /bulb?id=` always fetch current state live, in parallel across all
known bulbs (`Promise.all`, matches the sibling project's approach) via
`GET /light/<objectId>` on each bulb's `lastIp`. A bulb that doesn't
respond is reported `online: false` with null state fields; it doesn't
fail the overall request.

## Public API (Bearer-token protected, same `BULBS_API_TOKENS` mechanism as the skeleton phase)

Replaces the skeleton phase's stub `GET /bulbs` (which returned a
hardcoded `{bulbs: []}`).

- **`GET /bulbs`** → `200 {"bulbs": [...]}`, each entry:
  ```json
  {
    "id": "kauf-bulb-7d49e0",
    "name": "Kauf Bulb 7d49e0",
    "mac": "C4:5B:BE:7D:49:E0",
    "lastIp": "192.168.1.26",
    "online": true,
    "on": true,
    "brightness": 55,
    "r": 39, "g": 183, "b": 255
  }
  ```
  An offline bulb: `online: false, on: null, brightness: null, r: null, g: null, b: null`.

- **`GET /bulb?id=<id>`** → same shape as one list entry. Unknown `id` →
  `404 {"error": "not found"}`.

- **`POST /bulb?id=<id>`** → body `{on?, brightness?, r?, g?, b?, transition?}`,
  all fields optional (only the provided ones change on the device, matching
  the device's own `turn_on` semantics — an empty body is valid and is a
  no-op beyond whatever `on`/`off` state change is implied). `brightness`
  outside 0–100, or `r`/`g`/`b` outside 0–255 → `400 {"error": "invalid
  request"}`. Unknown `id` → `404 {"error": "not found"}`. Known bulb that
  fails to respond to the device call → `502 {"error": "bulb
  unreachable"}`. Success → `200` with the same shape as a `GET /bulb?id=`
  response (state re-fetched live after the change).

## Web UI

Extends the existing session-cookie-protected `/` page
(`src/routes/index.ts`, `src/views/page.ts`) — the placeholder "No bulbs
discovered yet." text is replaced with a list: bulb name, an online/offline
indicator, and an on/off button per bulb.

The button posts to a **separate** route namespace,
`POST /ui/bulb/:id/toggle`, gated by the existing `requireAuth` session-cookie
middleware — not the public Bearer-token API. This keeps the browser from
ever needing to know the API token (a bad practice `<script>`-embedding a
secret would otherwise require). Both this route and the public
`POST /bulb?id=` route call the same underlying `src/bulbs/service.ts`
functions — only the auth gate differs. On failure the toggle route
redirects back to `/` regardless (the next page load reflects live state);
no separate error UI in this phase.

## Testing

Mirrors the existing pattern used for `auth.test.ts` (mocking
`google-auth-library` so no test touches the real network): the bulb
device API (`fetch` calls) is mocked in every test. Nothing in CI touches
`192.168.1.26` or any real device. SSE payload fixtures are the real
payloads captured live from the installed bulb during this design's
research, so the parsing tests are grounded in actual device behavior, not
assumptions.

- `src/bulbs/deviceApi.ts` — unit tests for `ping`-frame parsing (`proj_n`
  signature match/mismatch) and light-entity `object_id` extraction from
  the `state` stream (including correctly skipping the two hidden
  `entity_category:1` config lights), against the captured fixtures.
- `src/bulbs/store.ts` — unit tests for JSON load/save; that upserting an
  already-known MAC preserves `id`/`firstDiscovered`/`objectId` while
  updating `lastSeen`/`lastIp`; that a missing file is treated as an empty
  directory.
- `src/bulbs/discovery.ts` — unit test that a scan only upserts IPs whose
  `/events` ping matches the Kauf signature, with `deviceApi` mocked (no
  real 254-address sweep in tests).
- `src/routes/bulbs.ts` — route tests for `GET /bulbs`, `GET /bulb?id=`,
  `POST /bulb?id=`, with `src/bulbs/service.ts` mocked: token auth (already
  covered by the existing `requireToken` pattern), unknown id → 404,
  offline bulb → `online:false` with null fields, out-of-range
  brightness/RGB → 400, unreachable bulb on set → 502, successful set →
  200 with re-fetched state.
- UI toggle route test: asserts session-cookie auth gates
  `POST /ui/bulb/:id/toggle` (redirects to Google sign-in without a valid
  session, matching the existing `requireAuth` pattern) and that it
  redirects to `/` after a successful toggle.

## File/module layout

New `src/bulbs/` domain module (device I/O, storage, discovery — kept
separate from `src/routes/`, the HTTP layer, so each piece is
independently testable and none of it needs an HTTP server running to
test):

- **Create** `src/bulbs/deviceApi.ts` — `pingBulb(ip)`, `findLightEntity(ip)`,
  `getState(ip, objectId)`, `setState(ip, objectId, {on, brightness, r, g, b, transition})`
- **Create** `src/bulbs/store.ts` — `loadBulbs()`, `saveBulbs()`,
  `upsertBulb()`, `listBulbs()`, `getBulb(id)`
- **Create** `src/bulbs/discovery.ts` — `runDiscoveryScan(cidr)`,
  `startDiscoveryLoop()`, `stopDiscoveryLoop()`
- **Create** `src/bulbs/service.ts` — `listWithLiveState()`,
  `getWithLiveState(id)`, `setBulbState(id, opts)`
- **Modify** `src/routes/bulbs.ts` — replace the stub with `GET /bulbs`,
  `GET /bulb`, `POST /bulb`
- **Modify** `src/routes/index.ts` — page render passes the live bulb list;
  add `POST /ui/bulb/:id/toggle`
- **Modify** `src/views/page.ts` — render the bulb list (name, status, on/off
  button) in place of the placeholder text
- **Modify** `src/config.ts` — add `BULB_SCAN_CIDR` (default
  `192.168.1.0/24`) and `BULBS_DATA_PATH` (default `/data/bulbs.json`) as
  optional, defaulted env vars (not added to the required/fail-fast list —
  these have sane defaults, unlike the auth secrets)
- **Modify** `src/server.ts` — call `startDiscoveryLoop()` after the app
  starts listening
- **Create** (in `kube-setup`) `manifests/bulbs/bulbs-pvc.yaml`
- **Modify** (in `kube-setup`) `manifests/bulbs/bulbs-ksvc.yaml` — add the
  `/data` volume mount and the `backup.velero.io/backup-volumes` pod
  annotation

## Out of scope for this phase

- Bulb renaming (persisted `name` field exists but no API to change it)
- Push/pop state stack (the sibling project's feature — not requested)
- Bulk on/off-all operations
- Brightness/color controls in the web UI (API-only this phase)
- Removing bulbs from the directory (no delete capability — a bulb that's
  permanently gone just stays `online: false` forever; acceptable at a
  10–20 bulb scale, revisit if it becomes noisy)
