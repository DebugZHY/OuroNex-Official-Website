-- 0003_app_webhook_event.down.sql
--
-- Reverts 0003_app_webhook_event.sql: drops the app-owned webhook event log and its
-- indexes in reverse creation order. Idempotent; re-running it is a no-op.
--
-- Dropping this table discards the replay guard: events that were already delivered
-- would look new after it is recreated, and their notifications would be sent again.
-- Export the table first if that matters.
--
--   psql -v ON_ERROR_STOP=1 -f server/db/migrations/0003_app_webhook_event.down.sql

BEGIN;

DROP INDEX IF EXISTS app_webhook_event_status_idx;
DROP INDEX IF EXISTS app_webhook_event_stripe_event_id_key;
DROP TABLE IF EXISTS app_webhook_event;

COMMIT;