CREATE TABLE "wallet_guest_projection" (
    "registration_id" INTEGER PRIMARY KEY,
    "revision" INTEGER NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL,
    "pending" BOOLEAN NOT NULL,
    CONSTRAINT "wallet_guest_projection_registration_id_fkey"
        FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "wallet_guest_projection_active_pending_idx"
    ON "wallet_guest_projection"("active", "pending");
