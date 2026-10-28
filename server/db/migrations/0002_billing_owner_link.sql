-- 0002_billing_owner_link.sql
--
-- App-owned mapping between a Stack Auth user id and a PayKit customer id, so a
-- subscription row (which only references paykit_customer) can be resolved back
-- to the user who owns it, and so subscriptions.csv alone is not the only record
-- of that relationship after a restore.
--
-- A separate table rather than a user_id column added to paykit_customer: PayKit
-- owns and migrates that table, so a vendor upgrade could redefine or drop a
-- column we depend on. This table is additive, exportable on its own, and can be
-- dropped without touching PayKit's schema.
--
-- user_id holds the Stack Auth user id (ProjectUser.id) and is deliberately not a
-- foreign key to any vendor table, so a vendor migration cannot cascade-delete a
-- mapping.
--
-- The primary key indexes user_id and the unique constraint indexes
-- paykit_customer_id, which covers both lookups the dashboard performs; no extra
-- index is added.
--
-- Idempotent; re-running it is a no-op.
--   psql -v ON_ERROR_STOP=1 -f server/db/migrations/0002_billing_owner_link.sql

BEGIN;

CREATE TABLE IF NOT EXISTS app_billing_owner (
    user_id            text        PRIMARY KEY,
    paykit_customer_id text        NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now()
);

COMMIT;
