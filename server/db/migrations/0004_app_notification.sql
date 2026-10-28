-- 0004_app_notification.sql
--
-- App-owned notification ledger: one row per (user, notification kind) recording whether we have
-- already sent that notification, when we claimed it and what the transport said.
--
-- Why our own table: sending is an application concern. The vendor's tables are read-only from
-- here (paykit_* is PayKit's, "ProjectUser" belongs to the auth service), and there is no vendor
-- webhook we can rely on for "user first seen", so the claim that makes a welcome letter
-- exactly-once has to live in our own schema.
--
-- Why (user_id, kind) is the primary key: that pair *is* the idempotency key. The first request
-- that inserts the row wins the claim; every later request conflicts, and the conflict clause only
-- re-claims a row that is not already 'sent'. A restart, a retry or five concurrent requests can
-- therefore produce at most one delivered notification of a given kind per user.
--
-- user_id stores the auth service's user id verbatim (text, not uuid): it is the only user identity
-- FK in this system, and a text column survives whatever id format the auth provider uses. There is
-- deliberately no foreign key to the user table: that table is resolved dynamically at runtime and
-- may live in another database, so a FK here would be a hard cross-database dependency.
--
-- Status vocabulary: 'claimed' -> 'sent' | 'failed'. 'failed' stays re-claimable so a later request
-- can retry the send; 'sent' is terminal.
--
-- Not part of scripts/export.sh, for the same reason app_webhook_event is not: the export covers the
-- three datasets the operating rules require (auth users, subscriptions, payment rows). This is an
-- operational ledger; losing it re-sends at most one welcome letter, it never loses user data.
--
-- Idempotent; re-running it is a no-op.
--   psql -v ON_ERROR_STOP=1 -f server/db/migrations/0004_app_notification.sql

BEGIN;

CREATE TABLE IF NOT EXISTS app_notification (
    user_id    text        NOT NULL,
    kind       text        NOT NULL,
    status     text        NOT NULL DEFAULT 'claimed',
    attempts   integer     NOT NULL DEFAULT 1,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    sent_at    timestamptz,
    last_error text,
    PRIMARY KEY (user_id, kind),
    CONSTRAINT app_notification_status_check CHECK (status IN ('claimed', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS app_notification_kind_idx
    ON app_notification (kind);

COMMIT;