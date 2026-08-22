# Bulb card UI, modal, bulk controls, and manual discovery

Date: 2026-08-22

## What this is

A redesign of `kauf-server`'s web UI from a plain list to a responsive card
grid, plus a detail modal (brightness/color controls, firmware/MAC info),
bulk all-on/all-off, and a manual discovery-refresh button — extending the
existing bulb discovery/control feature
(`docs/superpowers/specs/2026-08-22-bulb-discovery-and-control-design.md`).
Also adds Playwright E2E coverage for the new client-side interactivity,
the first client-side JavaScript and the first browser-automation testing
in this project.

## New public API (Bearer-token, unchanged `BULBS_API_TOKENS` mechanism)

- **`GET /bulb?id=<id>`** — **extended response**. In addition to the
  existing fields, now includes `firmwareVersion: string | null` and
  `esphomeVersion: string | null`, fetched live via the same `/events`
  SSE ping used by discovery (in parallel with the existing live-state
  fetch). Both are `null` if that fetch fails, independently of whether
  the state fetch succeeds — a bulb can be `online: true` (state fetch
  worked) with `firmwareVersion: null` (ping fetch failed) or vice versa.
  `GET /bulbs` (the list) is **unchanged** — no firmware round-trip per
  bulb on every list load, to keep the list endpoint fast at any bulb
  count.
- **`POST /bulbs/on`**, **`POST /bulbs/off`** — turns every known bulb
  on/off in parallel (`Promise.all`, matching `listWithLiveState`'s
  existing parallelism). Response: `{"results": [{"id": "...", "success":
  true|false}, ...]}`, one entry per known bulb, in the persisted
  directory's order. Never partially fails the HTTP response — an
  individual bulb's failure just shows `success: false` for that entry.
- **`POST /discover`** — runs `runDiscoveryScan()` (already built,
  already tested) synchronously and returns once it completes:
  `{"bulbsFound": <count>, "bulbs": [...]}` (the updated list, same shape
  as `GET /bulbs`). A full 254-address sweep can take several seconds —
  this is a blocking call by design (matches the discovery scanner's own
  per-scan latency), not an async job.

All three are gated by the same `requireToken('BULBS_API_TOKENS')` +
`createAuthRateLimit()` middleware already applied to the other `bulbs`
routes.

## New UI routes (session-cookie, mirroring the existing `POST
/ui/bulb/:id/toggle` pattern — the browser never sees the API token)

- **`GET /ui/bulb/:id`** — JSON (not HTML) detail response, same extended
  shape as the public `GET /bulb?id=`. Fetched by the modal's JavaScript
  when it opens.
- **`POST /ui/bulb/:id/set`** — JSON in, JSON out. Body:
  `{on?, brightness?, r?, g?, b?}` (same shape as the public `POST
  /bulb?id=`, minus `transition` — the modal doesn't expose a transition
  control). Returns the updated bulb (same shape as `GET /ui/bulb/:id`)
  on success, or a JSON error body with an appropriate status
  (400/404/502, mirroring the public API's existing status codes) on
  failure. This is what the modal's brightness slider and color picker
  submit to via `fetch` — no page reload.
- **`POST /ui/bulbs/on`**, **`POST /ui/bulbs/off`** — redirect-based
  (like the existing toggle route: no JS needed), for the page-level "All
  On"/"All Off" buttons.
- **`POST /ui/discover`** — redirect-based, for the page-level "Refresh"
  button. Like the public `POST /discover`, this blocks until the scan
  completes, then redirects to `/` — the browser's normal loading
  indicator is the only feedback during the wait (no custom spinner in
  this phase).

The existing `POST /ui/bulb/:id/toggle` (redirect-based, on/off only)
**stays** — it's the no-JS fallback used by each card's own on/off button,
separate from the modal's richer JSON-based setter.

## Frontend

**Card grid**: `src/views/page.ts`'s `renderBulbList` is rewritten from a
`<ul>` list to a responsive CSS grid (`grid-template-columns:
repeat(auto-fill, minmax(220px, 1fr))` — no media queries needed, the
grid reflows naturally from wide desktop down to a single mobile column).
Each card: an inline-SVG bulb icon (a simple bulb silhouette, `fill` set
via inline `style` to `rgb(r,g,b)` when `on && online`, gray/dimmed via a
CSS class when off or offline — no external image files), the bulb's
name, an online/offline + on/off status badge (same styling as the
current list), and a plain `<form>` on/off button (posts to the existing
`/ui/bulb/:id/toggle` — works with zero JavaScript).

**Page-level controls**: three buttons above the grid — "Refresh" (form
POST to `/ui/discover`), "All On" / "All Off" (form POST to
`/ui/bulbs/on` / `/ui/bulbs/off`) — all plain forms, no JS required for
these three.

**Modal**: a native `<dialog>` element (built into HTML, no library),
hidden by default. Clicking anywhere on a card **except** its on/off
button opens the modal via a small inline `<script>` block: `fetch`es
`GET /ui/bulb/:id`, populates the modal's fields (name, MAC, firmware
version, ESPHome version, an online/offline indicator, a brightness
`<input type="range">`, an `<input type="color">` for RGB, and an on/off
toggle), and calls `.showModal()`. Changing the brightness slider or
color picker (on `change`, not every `input` tick — avoid flooding the
device with requests while dragging) `POST`s to `/ui/bulb/:id/set` via
`fetch`, and on a successful response updates both the modal's own
display and the underlying card's DOM (icon color, status badge)
directly — no full-page reload. Closing the modal (a close button, or
clicking the backdrop) just calls the native `.close()`.

This is the first client-side JavaScript in this project. It stays
vanilla — no framework, no build step, inlined the same way the existing
page's CSS is inlined in `page.ts`.

## Testing

**Backend (Vitest, same patterns as the rest of this project — mocked
service layer, no real network):**
- `src/bulbs/deviceApi.ts` — extend `pingBulb`'s existing tests to assert
  `firmwareVersion`/`esphomeVersion` are correctly parsed from the ping
  frame's `proj_v`/`esph_v` fields (real field names, already captured in
  this project's earlier research and already present in
  `test/mockBulbServer.ts`'s ping frame).
- `src/bulbs/service.ts` — new tests for `getFullDetail` (merges live
  state + live ping into the extended shape; both independently
  nullable) and `setAllBulbsState` (parallel per-bulb results, one
  partial failure doesn't affect others).
- `src/routes/bulbs.ts` — route tests for `GET /bulb`'s extended
  response shape, `POST /bulbs/on`, `POST /bulbs/off`, `POST /discover`.
- `src/routes/index.ts` — route tests for `GET /ui/bulb/:id`, `POST
  /ui/bulb/:id/set`, `POST /ui/bulbs/on`, `POST /ui/bulbs/off`, `POST
  /ui/discover`.

**End-to-end (new: Playwright, `@playwright/test` devDependency):**

The app requires Google OAuth to reach the UI and requires a real (or
real-enough) bulb to show live state — E2E tests need to run against the
real server process (not `supertest`'s in-process app, which is what all
existing tests use) without either of those dependencies:

- **Auth**: inject a valid `session` cookie directly into the Playwright
  browser context before navigating, signed via the same `signSession()`
  function the existing Vitest route tests already use to do this exact
  thing — bypasses the real OAuth flow entirely, matching how this
  project already tests `requireAuth`-gated routes.
- **Bulb data**: a Playwright `globalSetup` starts `test/mockBulbServer.ts`
  (already built, already used by `deviceApi.integration.test.ts`) on a
  random port, then writes a seed file to a temp `BULBS_DATA_PATH`
  containing one bulb record whose `lastIp` points at
  `127.0.0.1:<mock-server-port>` — so the E2E-launched app server gets
  fully real HTTP behavior end to end (real Express routes, real device
  API calls) against a fake-but-real device, never touching the actual
  physical bulb or requiring network/LAN access. This also means E2E
  tests run safely in CI if ever wired in later (see below).
- **Server orchestration**: `playwright.config.ts`'s `webServer` option
  starts the app (`tsx src/server.ts`) pointed at the seeded data file,
  on a dedicated test port, with dummy `GOOGLE_CLIENT_ID` etc. (the E2E
  tests never exercise the real OAuth redirect, only the cookie-injection
  path above, so these values just need to satisfy `assertRequiredEnv()`
  — they're never actually sent to Google).
- **Coverage**: `tests/e2e/bulbs.spec.ts` — cards render with the seeded
  bulb's name/status; clicking a card opens the modal and shows its MAC
  and (mock-server-provided) firmware version; adjusting the brightness
  slider and submitting updates both the modal and the underlying card
  without a page navigation; the on/off toggle button works without any
  JavaScript (a real regression guard for the progressive-enhancement
  claim above — test with JS disabled if Playwright makes that
  practical, otherwise assert the form's plain POST+redirect behavior
  directly).

**Scope boundary**: `npm run test:e2e` is a **separate** script from
`npm test` (the CI-gating command, which stays Vitest-only). E2E tests
are not wired into `build-push.yml`/`production-checks.yml` in this
phase — running Playwright in CI needs browser binaries installed
(`playwright install --with-deps`), a real addition to build time this
spec doesn't decide on. Revisit if E2E coverage proves valuable enough to
gate merges on.

## File/module layout

- **Modify** `src/bulbs/deviceApi.ts` — `PingResult` gains
  `firmwareVersion: string | null` and `esphomeVersion: string | null`,
  populated in `pingBulb` from the ping frame's `proj_v`/`esph_v`.
- **Modify** `src/bulbs/service.ts` — new `BulbDetail` interface
  (extends `BulbWithState` with the two firmware fields), new
  `getFullDetail(id): Promise<BulbDetail | null>`, new
  `setAllBulbsState(on: boolean): Promise<{id: string, success:
  boolean}[]>`.
- **Modify** `src/routes/bulbs.ts` — `GET /bulb` calls `getFullDetail`
  instead of `getWithLiveState`; new `POST /bulbs/on`, `POST
  /bulbs/off`, `POST /discover`.
- **Modify** `src/routes/index.ts` — new `GET /ui/bulb/:id`, `POST
  /ui/bulb/:id/set`, `POST /ui/bulbs/on`, `POST /ui/bulbs/off`, `POST
  /ui/discover`.
- **Modify** `src/views/page.ts` — card grid, inline SVG bulb icon,
  page-level buttons, modal markup + inline `<script>`.
- **Create** `playwright.config.ts`, `tests/e2e/global-setup.ts`,
  `tests/e2e/bulbs.spec.ts`.
- **Modify** `package.json` — add `@playwright/test` devDependency, add
  `"test:e2e": "playwright test"` script.

## Out of scope for this phase

- Wiring Playwright into CI (see Scope boundary above).
- A transition-time control in the modal (the public/UI setters both
  omit `transition` — the device's own default, per the existing
  `setState` behavior, applies).
- Any visual loading indicator during the (potentially multi-second)
  discovery scan beyond the browser's native page-load indicator.
- Bulk brightness/color (only bulk on/off, matching what was asked for).
