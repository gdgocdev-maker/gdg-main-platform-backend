BEGIN;

-- Keep advisor and Developer Committees Leader balances independent. Existing
-- global entries are the Developer Committees Leader balance.
ALTER TABLE "global_point_entry"
  ADD COLUMN "global_role_code" VARCHAR(40) NOT NULL DEFAULT 'DEVELOPER_COMMITTEES_LEADER';

ALTER TABLE "global_point_entry"
  ADD CONSTRAINT "global_point_entry_global_role_code_check"
  CHECK ("global_role_code" IN ('ADVISOR', 'DEVELOPER_COMMITTEES_LEADER'));

UPDATE "permission"
SET "description" = 'Award points to advisors, committee leaders, and the overall Developer Committees Leader'
WHERE "code" = 'club.points.manage';

CREATE INDEX "global_point_entry_member_role_created_idx"
  ON "global_point_entry" ("member_id", "global_role_code", "created_at", "point_entry_id");

COMMIT;
