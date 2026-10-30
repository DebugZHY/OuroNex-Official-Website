# OuroNex token usage — developer integration package

This package is a small, dependency-free client and reference for submitting token usage to OuroNex.
It exists for **external applications**: the application that talks to a model is the only place that
can know how many tokens were spent, so it aggregates usage itself and submits **already-final
records**. Nothing here scans local sessions, parses transcripts, derives totals or counts tokens.

```
integrations/token-usage/
├── README.md                      this file
├── docs/API.md                    the HTTP contract in full
├── docs/DATABASE.md               database fields, identity, indexes and demo seeding
├── schema/usage-records.schema.json   JSON Schema for the POST body
├── examples/records.json          four synthetic records (two days, two models, two sessions)
├── client.py                      standard-library client
├── NOTICE.md                      adapted UI source attribution
├── LICENSE.upstream               upstream MIT license
└── tests/test_client.py           standard-library test suite
```

## What the client does and does not do

Does:

- reads a local JSON file shaped like `{ "records": [ ... ] }`;
- checks the envelope (object, `records` array, 1–500 entries) and that the file is valid JSON;
- sends the batch unchanged to `POST /api/v1/usage/` with a Bearer token;
- prints the server's real HTTP status and response body;
- exits non-zero on a missing token, a bad payload file, an HTTP error or a network error.

Does not:

- count, estimate, re-aggregate or cap tokens — the counters in the payload are authoritative;
- add any field to a record (`totalTokens` and friends are a dashboard concern, not a payload one);
- retry automatically, cache, persist or queue anything;
- read credentials from a file, the repository or the command line.

## Requirements

- Python 3.9 or newer. Only the standard library is used; there is nothing to install.
- Network access to the OuroNex site.
- A Bearer token from `POST /api/v1/auth/login/`.

## Setup

```bash
cd <project-root>
export OURONEX_ACCESS_TOKEN='<token returned by the login endpoint>'
```

The token is read from the environment variable `OURONEX_ACCESS_TOKEN` on every run. Do not put a
real token in a shell history you share, in a script committed to a repository, or in the payload
file. On Windows PowerShell use `$env:OURONEX_ACCESS_TOKEN = '...'` for the session.

### Obtaining a token

`POST /api/v1/auth/login/` is the existing login endpoint. It takes a JSON body and returns a Bearer
token with its lifetime:

```bash
curl -sS -X POST https://your-ouro-nex.example/api/v1/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"<username>","password":"<password>"}'
```

```json
{
  "access_token": "<opaque bearer token>",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": { "uid": "<uid>", "username": "<username>", "email": "<email>", "phone": "", "plan": "Pro" }
}
```

Tokens can be revoked through `POST /api/v1/auth/logout/` (Bearer). See `docs/API.md` for exact
error shapes.

## Sending a batch

```bash
python integrations/token-usage/client.py \
  --base-url https://your-ouro-nex.example \
  --payload integrations/token-usage/examples/records.json
```

`--base-url` is the site root; the client appends `/api/v1/usage/`. A base URL with a path prefix is
allowed (`https://host/ouro` becomes `https://host/ouro/api/v1/usage/`). `--timeout` defaults to 30
seconds.

Successful output (the body is the server's response, printed verbatim apart from pretty-printing):

```
POST https://your-ouro-nex.example/api/v1/usage/
HTTP 200
{
  "success": true,
  "received": 4,
  "upserted": 4,
  "generatedAt": "2026-10-30T12:00:00Z"
}
```

## Local demonstration data

The website includes a separate, idempotent seed command for UI development. It creates synthetic records
for existing active users only; it never creates users and never changes the legacy `TokenUsage` totals.

```bash
cd backend
python manage.py seed_token_usage_demo
```

The default writes 30 recent days with `source: "demo"`. Use `--username <name>` to select one existing
account or `--days 7` for a shorter range. Re-running replaces the same synthetic identities rather than
adding duplicates. External applications should use their own stable `source` value.

## Idempotency

A record's identity is **user + source + day + model + sessionId**. Submitting the same identity
again **replaces** every counter and the title; it never increments. Re-running the same payload is
therefore safe and is the recommended way to correct a day that was reported early: aggregate again
and resend the corrected totals. Because the batch is applied atomically, a retry either replaces the
whole set for those identities or changes nothing.

## Batch limits and atomicity

- 1 to 500 records per request.
- The server validates every record first and then applies the whole batch in one transaction. If any
  record is invalid the request fails with `400 invalid_records` and **nothing** is written.

## Error behaviour and exit codes

| Exit code | Meaning | Typical cause |
|---|---|---|
| 0 | The batch was accepted | 200 from the server |
| 2 | Missing token or invalid arguments | `OURONEX_ACCESS_TOKEN` unset, bad `--base-url` |
| 3 | Local payload problem | file missing, invalid JSON, no `records` array, 0 or >500 records |
| 4 | HTTP error status | 400 `invalid_records`, 401 `invalid_token`, 405 `method_not_allowed` |
| 5 | Network error | DNS failure, connection refused, timeout, TLS failure |

Exit code 3 and 2 never reach the server. Exit code 5 means the outcome is unknown (the request may
or may not have arrived); resending is safe because of the idempotency rule. Exit code 4 means the
server rejected the request and wrote nothing.

The client prints the server's error body, for example:

```json
{
  "error": {
    "code": "invalid_records",
    "message": "record 1: day must be a valid ISO date (YYYY-MM-DD)"
  }
}
```

## Security guidance

- Treat the Bearer token as a password: environment variable only, never logged, never committed.
  Prefer a dedicated machine account for integrations rather than a personal login.
- Use HTTPS outside local development. The client verifies TLS certificates with the platform trust
  store; it has no option to skip verification.
- Send the minimum data needed. `title` and `sessionId` are user content: avoid project names,
  customer names or anything confidential. They are stored and displayed as provided and are never
  translated or rewritten.
- Keep payload files outside version control when they contain real usage. The example file is
  synthetic on purpose.
- Revoke tokens you no longer need (`POST /api/v1/auth/logout/`) and rotate them after a suspected
  leak.

## Tests

```bash
python -m py_compile integrations/token-usage/client.py integrations/token-usage/tests/test_client.py
python -m unittest discover -s integrations/token-usage/tests -v
```

The suite starts a fake HTTP server on `127.0.0.1` with an ephemeral port (no external network, no
port 8080) and covers request construction, the missing-token branch, invalid local JSON, HTTP
errors, success and the network-error branch.