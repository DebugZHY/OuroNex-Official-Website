# Token usage API

Base URL: the OuroNex site root (for example `https://your-ouro-nex.example`). All endpoints below
are JSON over HTTPS. Requests and responses use UTF-8.

Two conventions apply to every endpoint:

- **Authentication** is a Bearer token in `Authorization: Bearer <token>`, obtained from
  `POST /api/v1/auth/login/`. The dashboard's GET request additionally accepts a session cookie;
  machine-to-machine POST requests require the Bearer token.
- **Errors** always use the same envelope, with an HTTP status that matches the code:

```json
{ "error": { "code": "<machine-readable-code>", "message": "<human-readable explanation>" } }
```

## POST /api/v1/auth/login/ (existing)

Exchanges a username and password for a Bearer token.

Request body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `username` | string | yes | Account username, passed to the standard login backend. |
| `password` | string | yes | Account password. |

```http
POST /api/v1/auth/login/
Content-Type: application/json

{ "username": "<username>", "password": "<password>" }
```

Success: `200 OK`

```json
{
  "access_token": "<opaque bearer token>",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": {
    "uid": "<uid>",
    "username": "<username>",
    "email": "<email>",
    "phone": "",
    "plan": "Pro"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `access_token` | string | Send it as `Authorization: Bearer <access_token>`. |
| `token_type` | string | Always `Bearer`. |
| `expires_in` | integer | Seconds until the token expires. |
| `user` | object | `uid`, `username`, `email`, `phone`, `plan`; `plan` is `null` without an active subscription. |

Errors:

| Status | Code | When |
|---|---|---|
| 400 | `invalid_json` | The body is not valid JSON, or is not a JSON object. |
| 401 | `invalid_credentials` | The username/password pair did not authenticate. |
| 405 | `method_not_allowed` | Any method other than POST. |

Related: `POST /api/v1/auth/logout/` (Bearer) revokes the token and returns `{ "success": true }`.
`GET /api/v1/auth/me/` (Bearer) returns `{ "user": { ... } }` for the token holder.

## GET /api/v1/usage/

Returns the usage records that belong to the authenticated user. The account dashboard uses this
call with `cache: "no-store"` and `credentials: "same-origin"`; integrations should use a Bearer
token instead.

Request headers: `Authorization: Bearer <access_token>` (or a dashboard session).

Success: `200 OK`

```json
{
  "records": [
    {
      "day": "2026-10-01",
      "model": "synthetic-model-alpha",
      "sessionId": "synthetic-session-001",
      "title": "Synthetic example - research chat",
      "calls": 12,
      "input": 8400,
      "output": 3200,
      "cacheWrite": 900,
      "cacheRead": 1500,
      "source": "external"
    }
  ],
  "generatedAt": "2026-10-30T12:00:00Z",
  "sessionCount": 1
}
```

| Field | Type | Notes |
|---|---|---|
| `records` | array | Only the authenticated user's records. |
| `generatedAt` | string | ISO-8601 timestamp of the response. |
| `sessionCount` | integer | Number of distinct sessions represented in `records`. |

Ordering: `day` ascending, then `model`, then `sessionId`, then `source`. The same ordering is stable
between calls, so clients can diff responses.

Errors: `401 invalid_token` when there is neither a dashboard session nor a valid Bearer token.

## POST /api/v1/usage/

Submits one batch of already-aggregated usage records. Machine-to-machine: Bearer token required,
CSRF exempt.

Request headers:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request body:

```json
{ "records": [ { "...": "one record, see the field table" } ] }
```

- `records` is required and must contain **1 to 500** records.
- The whole batch is validated first, then applied atomically in one transaction. There are **no
  partial writes**: if one record is invalid, nothing is written.

### Record fields

| Field | Type | Required | Constraints | Default | Notes |
|---|---|---|---|---|---|
| `day` | string | yes | ISO local calendar date, `YYYY-MM-DD` | — | Bucket day, not a timestamp. |
| `model` | string | yes | non-empty, max 120 characters | — | Model name exactly as the application reports it. |
| `sessionId` | string | yes | non-empty, max 200 characters | — | Session identifier chosen by the application. |
| `title` | string | no | max 255 characters | `""` | User content; stored and shown as provided. |
| `calls` | integer | yes | `>= 0` | — | Number of calls. Not part of the token total. |
| `input` | integer | yes | `>= 0` | — | Input tokens. |
| `output` | integer | yes | `>= 0` | — | Output tokens. |
| `cacheWrite` | integer | yes | `>= 0` | — | Cache-write tokens. |
| `cacheRead` | integer | yes | `>= 0` | — | Cache-read tokens. |
| `source` | string | no | non-empty, max 80 characters | `"external"` | Source label; part of the identity. |

Counters must be integers between 0 and 9223372036854775807 (JSON numbers without a fractional part).
`model`, `sessionId` and `source` must contain at least one non-whitespace character. The API does not
recompute the counters. **Total tokens = `input` + `output` + `cacheWrite` + `cacheRead`**; `calls` is never
included in that total. The dashboard performs this sum for display; the payload carries only the
four counters.

The JSON Schema in `../schema/usage-records.schema.json` encodes the same constraints and can be used
to validate a payload before sending it.

### Identity and idempotency

A record is identified by **user + `source` + `day` + `model` + `sessionId`**.

- Submitting an existing identity **replaces** all counters and the `title`. It never increments.
- The identity is scoped to the authenticated user: two tokens for the same user share identities;
  different users never collide.
- Resending a corrected batch is the intended way to fix a day that was reported early. Retries after
  a network error (where the client cannot know whether the request arrived) are safe.

### Success

`200 OK`

```json
{
  "success": true,
  "received": 4,
  "upserted": 4,
  "generatedAt": "2026-10-30T12:00:00Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `success` | boolean | `true` for an accepted batch. |
| `received` | integer | Number of records in the request. |
| `upserted` | integer | Number of record operations applied; equal to `received`. |
| `generatedAt` | string | ISO-8601 timestamp of the response. |

### Errors

| Status | Code | When | What was written |
|---|---|---|---|
| 400 | `invalid_json` | Body is not valid JSON. | Nothing |
| 400 | `invalid_records` | The JSON value is not an object, `records` is missing, empty, longer than 500, or any record fails a constraint. The message names the first offending record. | Nothing (atomic) |
| 401 | `invalid_token` | No Bearer token, or the token is invalid, expired or revoked. | Nothing |
| 405 | `method_not_allowed` | Any method other than GET or POST. | Nothing |

Example error body:

```json
{
  "error": {
    "code": "invalid_records",
    "message": "record 1: day must be a valid ISO date (YYYY-MM-DD)"
  }
}
```

## Identity rule

Records are always scoped to the authenticated identity: a Bearer token exposes only its own user's
records, and a batch is written under that token's user. There is no parameter to submit records on
behalf of another user, and no endpoint returns another user's usage. A token is therefore both the
credential and the data boundary — issue separate tokens for separate integrations so that revoking
one does not disturb the other.