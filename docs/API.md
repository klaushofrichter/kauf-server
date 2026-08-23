# kauf-server API Reference

For external services integrating with the public bulb-control API — not
the session-cookie web UI, which is documented in the top-level `README.md`.

Base URL: `https://bulbs.skylar.technology`

Every endpoint below requires an `Authorization: Bearer <token>` header,
where `<token>` is one of this deployment's `BULBS_API_TOKENS` values
(comma-separated list — any one value works). Missing or invalid token
returns `401 {"error": "unauthorized"}`.

All endpoints are rate-limited to 30 requests per 15 minutes per client.
Exceeding it returns `429`.

## Data model

A **bulb** object, returned by `GET /bulbs`, and as the base shape of
`GET /bulb`, `POST /bulb`, and `PUT /bulb`:

| Field        | Type              | Notes                                                        |
|--------------|-------------------|----------------------------------------------------------------|
| `id`         | string            | Stable identifier, e.g. `kauf-bulb-7d49e0`. Use in `?id=` params. |
| `name`       | string            | User-editable nickname (see `PUT /bulb`).                      |
| `mac`        | string            | Device MAC address, immutable.                                 |
| `lastIp`     | string            | Last-known IP address on the LAN.                               |
| `online`     | boolean           | Whether the most recent live-state fetch succeeded.             |
| `on`         | boolean \| null   | `null` if `online` is `false`.                                  |
| `brightness` | number \| null    | 0–100. `null` if `online` is `false`.                            |
| `r`, `g`, `b`| number \| null    | 0–255 each. `null` if `online` is `false`.                       |

`GET /bulb?id=` additionally includes:

| Field             | Type            | Notes                                                     |
|-------------------|-----------------|--------------------------------------------------------------|
| `firmwareVersion` | string \| null  | Kauf firmware version (e.g. `2.00(u)`). `null` if the device didn't respond to the info request — independent of `online`. |
| `esphomeVersion`  | string \| null  | ESPHome runtime version. Same nullability rule.               |

## Endpoints

### `GET /bulbs`

List every known bulb with live state.

**Response `200`:**
```json
{
  "bulbs": [
    {
      "id": "kauf-bulb-7d49e0",
      "name": "Living Room Lamp",
      "mac": "C4:5B:BE:7D:49:E0",
      "lastIp": "192.168.1.26",
      "online": true,
      "on": true,
      "brightness": 55,
      "r": 39, "g": 183, "b": 255
    }
  ]
}
```

### `GET /bulb?id=<id>`

Get one bulb's details (bulb-object fields plus `firmwareVersion`/`esphomeVersion`).

**Response `200`:** a single bulb object (extended shape, see Data model).
**Response `404`:** `{"error": "not found"}` — unknown `id`.

### `POST /bulb?id=<id>`

Set a bulb's on/off state, brightness, and/or color.

**Body** (all fields optional):
```json
{
  "on": true,
  "brightness": 75,
  "r": 255, "g": 128, "b": 0,
  "transition": 1000
}
```

- `on`: boolean. If `false`, the bulb turns off and `brightness`/`r`/`g`/`b` are ignored — the device doesn't accept color changes alongside an off command.
- `brightness`: 0–100.
- `r`, `g`, `b`: 0–255 each.
- `transition`: milliseconds, defaults to `1000` if omitted. Pass `transition: 0` explicitly for an instant change.
- Any field you omit is left unchanged on the device. If `on` is omitted (or `true`) and the bulb was off, it turns on with whatever attributes you did supply — there's no device-level way to change brightness/color without implicitly powering on.
- The device's RGB color mode normalizes chrominance so the brightest of the three channels is always 255 — sending `{r: 10, g: 20, b: 30}` will read back rescaled (e.g. `{r: 85, g: 170, b: 255}`, same ratio, brightest channel maxed). Send colors with your intended brightest channel already at 255 for a predictable round-trip.

**Response `200`:** the updated bulb object (base shape, freshly re-fetched after the change).
**Response `400`:** `{"error": "invalid request"}` — a field outside its valid range/type.
**Response `404`:** `{"error": "not found"}` — unknown `id`.
**Response `502`:** `{"error": "bulb unreachable"}` — the bulb didn't respond to the command.

### `PUT /bulb?id=<id>`

Set a bulb's nickname (persisted; unrelated to its device state).

**Body:**
```json
{ "name": "Living Room Lamp" }
```

**Response `200`:** the updated bulb object.
**Response `400`:** `{"error": "invalid request"}` — `name` missing, not a string, or empty.
**Response `404`:** `{"error": "not found"}` — unknown `id`.

### `POST /bulbs/on`, `POST /bulbs/off`

Turn every known bulb on/off in parallel. No body.

**Response `200`:**
```json
{
  "results": [
    { "id": "kauf-bulb-7d49e0", "success": true },
    { "id": "kauf-bulb-abc123", "success": false }
  ]
}
```

Never fails the whole request for one bulb's failure — check each entry's `success`.

### `POST /discover`

Run a discovery scan immediately, rather than waiting for the automatic
20-minute interval, and return the updated list once it completes. This is
a **blocking** call — a full subnet sweep can take several seconds. No body.

**Response `200`:**
```json
{
  "bulbsFound": 1,
  "bulbs": [ /* same shape as GET /bulbs */ ]
}
```

## Examples (cURL)

```bash
TOKEN="your-token-here"
BASE="https://bulbs.skylar.technology"

# List bulbs
curl -s "$BASE/bulbs" -H "Authorization: Bearer $TOKEN"

# Get one bulb's full detail (including firmware)
curl -s "$BASE/bulb?id=kauf-bulb-7d49e0" -H "Authorization: Bearer $TOKEN"

# Turn a bulb on at 50% brightness, orange
curl -s -X POST "$BASE/bulb?id=kauf-bulb-7d49e0" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"on": true, "brightness": 50, "r": 255, "g": 128, "b": 0}'

# Rename a bulb
curl -s -X PUT "$BASE/bulb?id=kauf-bulb-7d49e0" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "Living Room Lamp"}'

# Turn everything off
curl -s -X POST "$BASE/bulbs/off" -H "Authorization: Bearer $TOKEN"

# Trigger an immediate discovery scan
curl -s -X POST "$BASE/discover" -H "Authorization: Bearer $TOKEN"
```
