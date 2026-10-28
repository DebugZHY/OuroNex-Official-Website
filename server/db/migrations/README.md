# Migrations — app-owned tables

This folder holds versioned, reversible migrations for the tables OuroNex owns.

## Naming and isolation rule

Everything lives in the default `public` schema; isolation is by table-name prefix:

| Prefix | Owner | Created by |
|---|---|---|
| `stack_` | Stack Auth (vendor) | Stack Auth's own migrations |
| `paykit_` | PayKit (vendor) | PayKit's own migrations |
| `app_` | OuroNex | the migrations in this folder |

- Never create, copy, rename or alter `stack_*` or `paykit_*` tables here; those products own their schema.
- The single user identity is the Stack Auth user id. Our tables store it as a **text column and declare no foreign key** to any vendor table, so a vendor migration can never cascade-delete or rewrite our rows. That keeps the data sovereign (own rows, own lifecycle) and avoids cross-vendor coupling.
- A table belongs here only if it stores something the dashboard/service must keep about a user beyond what Stack Auth already holds. Subscription state stays in our own PostgreSQL and is the only source of truth; Stripe is a payment channel, not the record.
- Rows written by these migrations stay dumpable with the rest of the database (`pg_dump`), which is the data-sovereignty baseline.

## Apply and roll back

Run from the repository root with the same connection string the app uses (never commit it):

```bash
# apply
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/0001_app_profile.sql

# roll back
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/0001_app_profile.down.sql
```

Both files are idempotent (`IF NOT EXISTS` / `IF EXISTS`) and wrapped in `BEGIN`/`COMMIT`, so re-running either one is safe.

## Rules for new migrations

1. Every migration ships as a pair, added in the same change: `<NNNN>_<name>.sql` (up) and `<NNNN>_<name>.down.sql` (down).
2. The down file drops exactly what the up file created, in reverse order, idempotently.
3. Any change that touches subscription data must include its migration **and** its rollback in the same change; the change description must say so.
4. Each up file is self-contained and may only rely on lower-numbered migrations in this folder.
5. Run the offline parity check before committing:

```bash
python server/db/migrations/check_parity.py                        # checks 0001_app_profile
python server/db/migrations/check_parity.py 0002_billing_refund    # or any future pair
```

The check needs no database: it parses the up and down files, extracts created objects (`CREATE TABLE`, `CREATE INDEX`) and dropped objects (`DROP TABLE`, `DROP INDEX`), and exits non-zero when the sets differ or a file is missing.

## Current migrations

| File | Creates |
|---|---|
| `0001_app_profile.sql` | `app_user_profile` — one row per user, keyed by the Stack Auth user id — and `app_user_profile_updated_at_idx` (recently-updated listing) |
| `0002_billing_owner_link.sql` | `app_billing_owner` — maps one Stack Auth user id to one PayKit customer id, so a subscription row can be attributed to a user. Additive: it never alters a `paykit_*` table. |

## Export and restore

`app_billing_owner` is part of the export baseline like the user and subscription tables:

```bash
bash server/scripts/export.sh                 # writes customers/products/users/subscriptions/owner_links/payments CSV + manifest.json
bash server/scripts/restore-export.sh <dir>    # loads a finished export into an EMPTY database, in manifest restore_order
```

The manifest records `restore_order` (parents before children: customers, products, users, subscriptions, owner_links, payments) because `paykit_subscription` has non-null foreign keys to `paykit_customer` and `paykit_product`. `restore-export.sh` refuses a non-empty target rather than half-loading it, and drops no objects: the target schema comes from these migrations plus the vendor's own.
