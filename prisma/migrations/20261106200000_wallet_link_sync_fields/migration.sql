BEGIN;

ALTER TABLE wallet_membership_link
  ADD COLUMN sync_next_event BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN sync_points BOOLEAN NOT NULL DEFAULT false;

COMMIT;
