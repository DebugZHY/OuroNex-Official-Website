-- Scratch fixture: a signed-in user with no billing mapping at all.
-- The subscription read is anchored on app_billing_owner, so this is the row that proves a brand-new
-- account can still be addressed by email before its first purchase. Idempotent.
INSERT INTO "ProjectUser" (id, "projectId", "authUserId", "displayName", "primaryEmail", "signedUpAt")
VALUES ('5c2f8a41-9d3e-4b27-8a55-6f1e0c9b7d21',
        'b0b1b2b3-0000-4000-8000-000000000001',
        'c4d5e6f7-0000-4000-8000-000000000002',
        'Carol',
        'carol@example.com',
        now())
ON CONFLICT DO NOTHING;
