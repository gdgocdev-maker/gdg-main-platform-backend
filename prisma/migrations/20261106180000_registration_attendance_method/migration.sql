BEGIN;

CREATE TYPE "AttendanceMethod" AS ENUM ('MEMBER_CARD', 'GUEST_QR');
ALTER TABLE event_registrations
  ADD COLUMN attendance_method "AttendanceMethod",
  DROP CONSTRAINT registrations_token_check,
  ADD CONSTRAINT registrations_token_check CHECK (
    (CASE
      WHEN confirmed_at IS NULL THEN attendance_method IS NULL
        AND attendance_token_hash IS NULL AND attendance_token_encrypted IS NULL
      WHEN attendance_method = 'MEMBER_CARD' THEN
        attendance_token_hash IS NULL AND attendance_token_encrypted IS NULL
      ELSE attendance_token_hash IS NOT NULL AND btrim(attendance_token_hash) <> ''
        AND attendance_token_encrypted IS NOT NULL AND btrim(attendance_token_encrypted) <> ''
    END) IS TRUE
  );

COMMIT;
