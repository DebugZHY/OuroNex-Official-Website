# OuroNex server

Small Node service that carries everything the static marketing site cannot: the account dashboard,
the PayKit webhook receiver, the subscription status read model, and the status emails. The static
pages in the repository root stay static; they are not built by this service.

## What owns what

| Concern | Owner | Notes |
|---|---|---|
| User identity | Stack Auth | Only `Stack Auth` user ids are real identities. `server/src/lib/auth-context.mjs` is the single seam: it verifies `Authorization: Bearer` / `x-stack-access-token` against the Stack Auth API (`GET /api/v1/users/me`) and returns `userId: null` with a reason whenever that check cannot pass. |
| Subscription state (source of truth) | this repo's PostgreSQL (`app_billing_owner`, and PayKit's `paykit_subscription`) | Stripe is a payment channel only. Nothing in this service writes `paykit_*`. |
| Webhook replay guard + notification log | `app_webhook_event` | Never `paykit_webhook_event`: PayKit treats our rows there as "already applied" and would stop updating subscriptions. |
| Schema | `db/migrations/0001..0003` + PayKit's own drizzle migrations | Every migration has a `.down.sql`; `db/migrations/check_parity.py` proves the pair matches. |
| Data export | `scripts/export.sh` → CSV + `manifest.json`; `scripts/restore-export.sh` restores into an empty database | This is the AGENTS.md acceptance path: export, restore into an empty database, start the app on it. |

## Commands

```bash
npm start                  # node src/index.js  (PORT, default 3100)
npm run export             # CSV export of users / subscriptions / payments / customers / products / owner links
npm run restore -- <dir>   # load an export directory into an EMPTY database, in manifest order
npm run preflight          # production readiness: fixture DB, placeholder Stripe keys, dead identity path
npm run verify             # every gate in one command (syntax, migration parity, export, preflight, probes)
npm run verify:offline     # the same without anything that needs a database
npm run verify:deployed    # smoke a real deployment DB (Stack Auth shape, PayKit ledger, owner mappings)
```

`npm run verify` exits `0` when every gate passed, `1` when one failed, and `3` when the offline
gates passed but no database was reachable. Individual probes can be run alone:
`node scripts/probe-db-config.mjs`, `probe-subscription-status.mjs`, `probe-account-api.mjs`,
`probe-webhook.mjs`, `probe-mailer-smtp.mjs`, `probe-identity-scope.mjs`, `probe-auth-token.mjs`.
`npm run verify:deployed` additionally runs `probe-billing-live.mjs`, which reads (never writes) the
Stripe configuration the deployment actually sees, PayKit's migration journal, and whether any
webhook endpoint is registered at Stripe — a missing endpoint means no payment event can ever reach
`/api/webhooks/paykit`, so `paykit_subscription` would never move.

`verify` deliberately strips `DATABASE_URL`/`PG*` and runs against the development fixture. For a
real deployment (`docker compose up` in this directory: Postgres on 5433, Stack Auth on 8101/8102)
point `DATABASE_URL` at it and run `npm run verify:deployed` instead — it checks the identity table
shape, PayKit's migration ledger, that every `app_billing_owner` row resolves to a real user with an
email, and that the status read model answers for each mapped user, that users of another Stack Auth
project stay invisible, and that a real session token resolves to its user.

## Project scoping

One Stack Auth database can hold several projects (each in its own tenancy, `"ProjectUser"."tenancyId"`).
Every identity query here is restricted to the tenancy of `HEXCLAVE_PROJECT_ID` as soon as more than
one tenancy is present; with several tenancies and no resolvable project the read model throws instead
of answering with another project's user. `scripts/export.sh` applies the same rule to `users.csv` and
`contact_channels.csv`, so a backup never contains another project's accounts.

The deployed Stack Auth dashboard's `/handler/sign-in` page belongs to the dashboard's own project
(`internal`), not to this application project: pointing users at it would sign them into the admin
project. Until an application-level sign-in surface exists, the dashboard page accepts a token from
`sessionStorage['ouronex.accessToken']` and sends it as a bearer token.

## Stack Auth table shape

The user table is not shaped the same way in every Stack Auth release: the fixture and older images
use `"ProjectUser"(id, "primaryEmail")`, while the current Hexclave image uses
`"ProjectUser"(projectUserId)` with emails in `"ContactChannel"`. `src/lib/subscriptions.mjs` reads
the column names from `information_schema` once per process (`getIdentityShape()`) and every query
that touches a user goes through `getUserContact()` / `findUserIdsByEmails()`, so there is exactly
one place that knows the shape. Do not hard-code `"ProjectUser"."id"` or `"primaryEmail"` anywhere
else.

## Configuration precedence

`DATABASE_URL` wins over the `PG*` variables, and exported variables win over `server/.env` (the
file only fills what the environment did not set). The scratch fixture (`127.0.0.1:55432`,
`ouronex_paykit`) is used **only** when nothing is configured and `NODE_ENV` is not `production`;
in production a missing configuration throws instead of silently reading the fixture.

The identity header `x-ouronex-dev-user` is accepted only when `AUTH_DEV_MODE=on` **and**
`NODE_ENV` is not `production`. It exists so the dashboard and the account API can be exercised
before Stack Auth is deployed — it is never a production identity path.

## Still blocked on the environment, not on code

- Real Stripe test keys (`sk_test_…`, `whsec_…`); the repository only carries placeholders, and
  `npm run preflight` fails in production while they are placeholders. PayKit's schema no longer
  waits on this: it is created by PayKit's own migrations (`paykit_migrations` ledger), and only the
  product sync (`paykitjs push`) needs a real key.
- A browser sign-in surface. The Stack Auth API and an application project with its own keys exist
  (`HEXCLAVE_*` in `server/.env`), and a token obtained from `POST /api/v1/auth/password/sign-in` is
  verified end to end, but no page yet turns an email and password into that token.
- The static site's account entry link, which stays out until that sign-in surface exists (a link to
  a dashboard nobody can sign in to would be a dead link).
