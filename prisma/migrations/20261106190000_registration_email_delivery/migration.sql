BEGIN;

CREATE TYPE "RegistrationEmailKind" AS ENUM ('ACCEPTED', 'REJECTED', 'PROMOTED', 'CONFIRMED');
CREATE TYPE "RegistrationEmailState" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');
CREATE TABLE registration_email_delivery (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL,
  kind "RegistrationEmailKind" NOT NULL,
  state "RegistrationEmailState" NOT NULL DEFAULT 'PENDING',
  lease_expires_at TIMESTAMPTZ(3),
  CONSTRAINT registration_email_delivery_registration_id_fkey
    FOREIGN KEY (registration_id) REFERENCES event_registrations (registration_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT registration_email_delivery_lease_check
    CHECK ((state = 'SENDING') = (lease_expires_at IS NOT NULL))
);
CREATE INDEX registration_email_delivery_registration_id_id_idx ON registration_email_delivery (registration_id, id);
CREATE INDEX registration_email_delivery_state_id_idx ON registration_email_delivery (state, id);

COMMIT;
