-- 0004_app_notification.down.sql
--
-- Reverts 0004_app_notification.sql: drops the notification index and table in reverse creation
-- order. Idempotent; re-running it is a no-op.
--
-- Dropping this table discards the exactly-once record: after it is recreated, a user who was
-- already welcomed looks new again and would receive the welcome letter a second time. Export the
-- table first if that matters.
--
--   psql -v ON_ERROR_STOP=1 -f server/db/migrations/0004_app_notification.down.sql

BEGIN;

DROP INDEX IF EXISTS app_notification_kind_idx;
DROP TABLE IF EXISTS app_notification;

COMMIT;