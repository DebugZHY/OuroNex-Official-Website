-- 0001_app_profile.sql
-- Creates the app-owned user profile table used by the dashboard: one row per user,
-- keyed by the Stack Auth user id, plus the index used to list recently updated rows.
--
-- Isolation: this table lives in the default public schema and carries the app_ prefix.
-- Vendor tables are stack_* (Stack Auth) and paykit_* (PayKit) and are created by those
-- products; this file must never create, copy or alter them.
--
-- user_id is a plain text column that mirrors the Stack Auth user id. It is deliberately
-- NOT a foreign key to any vendor table, so a vendor migration can never cascade-delete
-- our rows, and this profile data stays independent of vendor schema changes.
--
-- Idempotent; safe to re-run. Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/0001_app_profile.sql

BEGIN;

CREATE TABLE IF NOT EXISTS app_user_profile (
    user_id          text        PRIMARY KEY,
    display_name     text,
    locale           text        NOT NULL DEFAULT 'en',
    marketing_opt_in boolean     NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_user_profile_updated_at_idx
    ON app_user_profile (updated_at DESC);

COMMIT;