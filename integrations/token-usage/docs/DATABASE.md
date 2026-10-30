# Token usage database contract

The dashboard board uses the `accounts.TokenUsageRecord` model, created by migration
`accounts/migrations/0003_tokenusagerecord.py`. It is separate from the legacy `TokenUsage` model.
Existing subscription totals and historical `TokenUsage` rows are not renamed, recomputed or migrated.

## Table and ownership

Django's default table name is `accounts_tokenusagerecord`. Every row belongs to one Django `User` through
`user_id`. User deletion cascades to that user's usage records. External applications must use the HTTP API,
not open or write the SQLite file directly.

## Field mapping

| JSON field | Django field | Storage and meaning |
|---|---|---|
| authenticated user | `user` | Foreign key to the token holder; never accepted as a payload field. |
| `day` | `day` | `DateField`; local calendar bucket in `YYYY-MM-DD` form. |
| `model` | `model` | Up to 120 characters. |
| `sessionId` | `session_id` | Up to 200 characters. |
| `title` | `title` | Up to 255 characters; empty string allowed. User content is displayed as supplied. |
| `source` | `source` | Up to 80 characters; defaults to `external`. |
| `calls` | `calls` | Non-negative 64-bit integer; excluded from token totals. |
| `input` | `input_tokens` | Non-negative 64-bit integer. |
| `output` | `output_tokens` | Non-negative 64-bit integer. |
| `cacheWrite` | `cache_write_tokens` | Non-negative 64-bit integer. |
| `cacheRead` | `cache_read_tokens` | Non-negative 64-bit integer. |
| not accepted | `created_at` | Server-set creation timestamp. |
| not accepted | `updated_at` | Server-set last-upsert timestamp. |

All five counters have a maximum of 9223372036854775807. The API validates every field before opening the
write transaction.

## Identity and upsert behavior

A unique constraint named `unique_token_usage_record` covers:

```text
user + source + day + model + session_id
```

An existing identity is updated with the submitted counters and title. A new identity is inserted. The API
never increments counters, so retries and corrections are safe. A batch may contain 1–500 records and is
atomic.

Indexes:

- `usage_record_user_day` on `(user, day)` supports account date filtering.
- `usage_record_session` on `(user, session_id)` supports account session lookups.
- The unique constraint supports identity lookup and prevents duplicate aggregates.

API read order is `day`, `model`, `session_id`, `source`, all ascending. The browser performs display-only
filtering and aggregation; the database stores the submitted aggregates without adding a statistics engine.

## Demonstration rows

`python manage.py seed_token_usage_demo` upserts deterministic synthetic rows with `source = "demo"` for
existing active users. It does not create users or modify legacy usage. Optional arguments are
`--username <name>` and `--days <1-365>`; the default is 30 days. Re-running the command updates the same
identities instead of adding duplicates.

Production integrations should choose a stable source identifier such as `sida-desktop` and should not use
`demo` for real measurements.
