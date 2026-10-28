-- 0001_app_profile.down.sql
-- Reverts 0001_app_profile.sql by dropping the app-owned profile index and table.
-- Reverse creation order, idempotent; safe to re-run. Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/0001_app_profile.down.sql

BEGIN;

DROP INDEX IF EXISTS app_user_profile_updated_at_idx;
DROP TABLE IF EXISTS app_user_profile;

COMMIT;