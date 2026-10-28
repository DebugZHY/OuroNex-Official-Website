-- 0003_app_webhook_event.sql
--
-- App-owned webhook event log: the replay guard and notification log for our own
-- intake. It exists so that signature-checked events, the insert-once guarantee and
-- the notification bookkeeping never touch paykit_webhook_event, which PayKit owns.
--
-- Why our own table: PayKit inserts its events with status 'processing', treats a
-- unique violation on stripe_event_id as a replay, and only re-claims rows that are
-- 'failed' or stale 'processing'. One of our rows sitting on a stripe_event_id would
-- therefore make PayKit skip applying the event, and paykit_subscription — our source
-- of truth — would silently stop updating.
--
-- Status vocabulary used here: 'received' -> 'notified' | 'notify_failed' | 'ignored'.
-- PayKit's 'processing' / 'failed' / 'processed' belong to its own table and are not
-- reused.
--
-- Idempotent; re-running it is a no-op.
--   psql -v ON_ERROR_STOP=1 -f server/db/migrations/0003_app_webhook_event.sql

BEGIN;

CREATE TABLE IF NOT EXISTS app_webhook_event (
    id              text        PRIMARY KEY,
    stripe_event_id text        NOT NULL,
    type            text        NOT NULL,
    payload         jsonb       NOT NULL,
    status          text        NOT NULL,
    error           text,
    received_at     timestamptz NOT NULL DEFAULT now(),
    processed_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS app_webhook_event_stripe_event_id_key
    ON app_webhook_event (stripe_event_id);

CREATE INDEX IF NOT EXISTS app_webhook_event_status_idx
    ON app_webhook_event (status);

COMMIT;