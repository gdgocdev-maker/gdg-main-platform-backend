BEGIN;

-- Assign a public number to existing and future members using one sequence.
ALTER TABLE member
  ADD COLUMN membership_number INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 100001);
CREATE UNIQUE INDEX member_membership_number_key ON member (membership_number);

CREATE FUNCTION prevent_membership_number_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.membership_number IS DISTINCT FROM OLD.membership_number THEN
    RAISE EXCEPTION 'Membership number cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER member_membership_number_immutable
  BEFORE UPDATE OF membership_number ON member
  FOR EACH ROW EXECUTE FUNCTION prevent_membership_number_change();

CREATE TABLE wallet_membership_link (
  wallet_public_id UUID PRIMARY KEY,
  member_id INTEGER NOT NULL,
  committee_id INTEGER,
  verified_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ(6),
  CONSTRAINT wallet_membership_link_member_id_fkey
    FOREIGN KEY (member_id) REFERENCES member (member_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT wallet_membership_link_member_id_committee_id_fkey
    FOREIGN KEY (member_id, committee_id)
    REFERENCES member_committee (member_id, committee_id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX wallet_membership_link_member_id_committee_id_idx
  ON wallet_membership_link (member_id, committee_id);

CREATE TABLE wallet_barcode_alias (
  barcode_hash VARCHAR(64) PRIMARY KEY CHECK (barcode_hash ~ '^[0-9a-f]{64}$'),
  wallet_public_id UUID NOT NULL,
  revoked_at TIMESTAMPTZ(6),
  CONSTRAINT wallet_barcode_alias_wallet_public_id_fkey
    FOREIGN KEY (wallet_public_id) REFERENCES wallet_membership_link (wallet_public_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX wallet_barcode_alias_wallet_public_id_idx ON wallet_barcode_alias (wallet_public_id);

COMMIT;
