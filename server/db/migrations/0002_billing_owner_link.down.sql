-- 0002_billing_owner_link.down.sql
--
-- Drops the app-owned user <-> PayKit customer mapping. Idempotent.
--
-- Dropping this table discards the mappings themselves: export them first
-- (scripts/export.sh writes them as owner_links.csv) because they cannot be
-- reconstructed from PayKit data alone.
--
--   psql -v ON_ERROR_STOP=1 -f server/db/migrations/0002_billing_owner_link.down.sql

BEGIN;

DROP TABLE IF EXISTS app_billing_owner;

COMMIT;
