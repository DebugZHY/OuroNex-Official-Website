# OuroNex Application Authentication API

Use this API when a separately developed application needs to authenticate against the same OuroNex user accounts as the website. The application must not open or copy `db.sqlite3`; only the Django backend accesses the database.

## Base URL

Configure the base URL in the application instead of hard-coding it:

- Same development computer: `http://127.0.0.1:8080`
- Different computers: use an HTTPS tunnel or the deployed Django URL.

All endpoints below are relative to that base URL. Requests and responses use JSON.

## POST /api/v1/auth/login/

Authenticates with Django's existing `authenticate()` backend and issues a Bearer token. It does not create a browser session cookie.

Request:

    {
      "username": "example-user",
      "password": "user-supplied-password"
    }

Successful response, HTTP 200:

    {
      "access_token": "onx_example_token_returned_once",
      "token_type": "Bearer",
      "expires_in": 2592000,
      "user": {
        "uid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "username": "example-user",
        "email": "user@example.com",
        "phone": "+852 0000 0000",
        "plan": "Free"
      }
    }

`expires_in` is measured in seconds. The default lifetime is 30 days. `uid` and `plan` can be `null`; `phone` can be an empty string. The raw token is returned only in this response. Django stores only its SHA-256 hash.

## GET /api/v1/auth/me/

Returns the current user contract and validates that the token exists, has not expired, has not been revoked, and belongs to an active user.

Request header:

    Authorization: Bearer <access_token>

Successful response, HTTP 200:

    {
      "user": {
        "uid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "username": "example-user",
        "email": "user@example.com",
        "phone": "+852 0000 0000",
        "plan": "Free"
      }
    }

## POST /api/v1/auth/logout/

Revokes the presented token immediately. Use the same `Authorization` header as `/me/`.

Successful response, HTTP 200:

    {
      "success": true
    }

The application must then delete its local copy of the token. A revoked token cannot be used with `/me/` or `/logout/` again.

## Errors

Error responses have a stable envelope:

    {
      "error": {
        "code": "invalid_credentials",
        "message": "Invalid username or password."
      }
    }

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not valid JSON or is not a JSON object. |
| 401 | `invalid_credentials` | Username/password authentication failed. |
| 401 | `invalid_token` | The Bearer token is missing, unknown, expired, revoked, or belongs to an inactive user. |
| 405 | `method_not_allowed` | The endpoint was called with the wrong HTTP method. |

Applications should branch on `error.code`, not on the human-readable `message`.

## Application integration

1. Collect credentials in the application and send them only to `/api/v1/auth/login/`.
2. Store the returned token in OS-backed secure storage where available. Do not commit it, log it, or embed it in source code.
3. Send `Authorization: Bearer <access_token>` when calling `/api/v1/auth/me/` or future protected endpoints.
4. On `invalid_token`, clear local login state and ask the user to log in again.
5. On logout, call `/api/v1/auth/logout/` and delete the local token even if the network call fails.

## Database and API contract changes

The database schema and the API contract are separate:

- A database-only change that leaves `serialize_user()` and endpoint behavior unchanged requires no application change.
- Adding a new optional response field is backward-compatible when the application ignores unknown fields. Notify the application developer so the field can be adopted.
- Renaming or removing a field, changing its type or meaning, or changing authentication behavior is a breaking change. Coordinate it and introduce `/api/v2/` instead of silently changing `/api/v1/`.
- New internal tables, indexes, migrations, and token bookkeeping do not belong in the application contract unless their data is intentionally exposed.

The application should ignore unknown user fields and must never depend on Django table or column names.

## Operations

Set `OURONEX_AUTH_TOKEN_TTL_SECONDS` to change the token lifetime. Apply migrations after pulling this feature:

    python manage.py migrate

Run the API tests:

    python manage.py test accounts.tests.AuthApiTests

Before public deployment, use HTTPS, add login rate limiting, restore CSRF protection for browser form views, configure appropriate CORS only if a browser-hosted application needs it, and keep tokens out of logs. The token API does not rely on cookie authentication.
