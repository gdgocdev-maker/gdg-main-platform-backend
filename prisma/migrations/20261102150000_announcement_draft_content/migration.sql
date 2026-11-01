ALTER TABLE "announcement"
  DROP CONSTRAINT "announcement_action_pair_check";

ALTER TABLE "announcement"
  ADD CONSTRAINT "announcement_action_pair_status_check"
  CHECK (
    "status" = 'DRAFT'
    OR ("action_label" IS NULL) = ("action_href" IS NULL)
  );
