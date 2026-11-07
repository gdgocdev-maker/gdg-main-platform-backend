BEGIN;

-- CANCELLED covers both expired offers and voluntary withdrawals after confirmation.
ALTER TABLE event_registrations
  DROP CONSTRAINT registrations_confirmation_check,
  ADD CONSTRAINT registrations_confirmation_check CHECK (
    (
      CASE
        WHEN status IN ('CONFIRMED', 'LATE_CANCELLATION', 'NO_CHECK_IN') THEN confirmed_at IS NOT NULL
        WHEN status IN ('CANCELLED', 'EXCUSED') THEN true
        ELSE confirmed_at IS NULL
      END
      AND (
        confirmed_at IS NULL OR (
          approved_at IS NOT NULL AND confirmation_deadline IS NOT NULL
          AND confirmed_at >= approved_at AND confirmed_at < confirmation_deadline
        )
      )
    ) IS TRUE
  );

COMMIT;
