BEGIN;

-- BEGIN GENERATED BASELINE
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'WAITLISTED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'LATE_CANCELLATION', 'NOT_SELECTED', 'REJECTED', 'EXPIRED', 'NO_CHECK_IN', 'EXCUSED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'published', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('text', 'select', 'radio', 'checkbox');

-- CreateEnum
CREATE TYPE "MemberType" AS ENUM ('current', 'alumni');

-- CreateEnum
CREATE TYPE "CommitteeRole" AS ENUM ('Leader', 'Co-Leader', 'Coordinator', 'Member');

-- CreateEnum
CREATE TYPE "BlacklistReason" AS ENUM ('CONFIRMATION_EXPIRED', 'LATE_CANCELLATION', 'NO_CHECK_IN');

-- CreateTable
CREATE TABLE "users" (
    "user_id" SERIAL NOT NULL,
    "member_id" INTEGER,
    "auth_user_id" UUID,
    "full_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone_number" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_login" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" SERIAL NOT NULL,
    "role_name" VARCHAR(50) NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "permission_id" SERIAL NOT NULL,
    "permission_name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "member_id" SERIAL NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "phone_number" VARCHAR(20),
    "email_personal" VARCHAR(255),
    "email_university" VARCHAR(255),
    "university" VARCHAR(150),
    "branch" VARCHAR(20),
    "major" VARCHAR(100),
    "profile_image_url" VARCHAR(255),
    "bio" TEXT,
    "member_type" "MemberType" NOT NULL DEFAULT 'current',
    "join_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "member_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "committee" (
    "committee_id" SERIAL NOT NULL,
    "committee_name" VARCHAR(100) NOT NULL,
    "committee_code" VARCHAR(50) NOT NULL,
    "parent_committee_id" INTEGER,

    CONSTRAINT "committee_pkey" PRIMARY KEY ("committee_id")
);

-- CreateTable
CREATE TABLE "member_committee" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "committee_id" INTEGER NOT NULL,
    "role" "CommitteeRole" NOT NULL,

    CONSTRAINT "member_committee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "event_id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "location" VARCHAR(255),
    "capacity" INTEGER NOT NULL,
    "registration_deadline" TIMESTAMPTZ(3) NOT NULL,
    "confirmation_window_hours" INTEGER NOT NULL DEFAULT 24,
    "image_url" VARCHAR(255),
    "requirements" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'draft',
    "created_by" INTEGER NOT NULL,
    "committee_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_questions" (
    "question_id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" "QuestionType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "options" JSONB,

    CONSTRAINT "event_questions_pkey" PRIMARY KEY ("question_id")
);

-- CreateTable
CREATE TABLE "event_registrations" (
    "registration_id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" INTEGER,
    "approved_at" TIMESTAMPTZ(3),
    "confirmation_deadline" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "waitlist_position" INTEGER,
    "cancelled_at" TIMESTAMPTZ(3),
    "excused_at" TIMESTAMPTZ(3),
    "excused_by" INTEGER,
    "excuse_reason" TEXT,
    "attendance_token_hash" TEXT,
    "attendance_token_encrypted" TEXT,
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_in_by" INTEGER,

    CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("registration_id")
);

-- CreateTable
CREATE TABLE "registration_answers" (
    "answer_id" SERIAL NOT NULL,
    "registration_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "event_id" INTEGER NOT NULL,
    "answer_text" TEXT NOT NULL,

    CONSTRAINT "registration_answers_pkey" PRIMARY KEY ("answer_id")
);

-- CreateTable
CREATE TABLE "registration_blacklist_entries" (
    "entry_id" SERIAL NOT NULL,
    "registration_id" INTEGER NOT NULL,
    "reason" "BlacklistReason" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" INTEGER,
    "resolution_reason" TEXT,

    CONSTRAINT "registration_blacklist_entries_pkey" PRIMARY KEY ("entry_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_member_id_key" ON "users"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_name_key" ON "roles"("role_name");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_permission_name_key" ON "permissions"("permission_name");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_email_university_key" ON "member"("email_university");

-- CreateIndex
CREATE UNIQUE INDEX "committee_committee_name_key" ON "committee"("committee_name");

-- CreateIndex
CREATE UNIQUE INDEX "committee_committee_code_key" ON "committee"("committee_code");

-- CreateIndex
CREATE INDEX "committee_parent_committee_id_idx" ON "committee"("parent_committee_id");

-- CreateIndex
CREATE INDEX "member_committee_committee_id_role_idx" ON "member_committee"("committee_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "member_committee_member_id_committee_id_key" ON "member_committee"("member_id", "committee_id");

-- CreateIndex
CREATE INDEX "events_status_starts_at_event_id_idx" ON "events"("status", "starts_at", "event_id");

-- CreateIndex
CREATE INDEX "events_status_ends_at_event_id_idx" ON "events"("status", "ends_at", "event_id");

-- CreateIndex
CREATE INDEX "events_created_by_created_at_event_id_idx" ON "events"("created_by", "created_at", "event_id");

-- CreateIndex
CREATE INDEX "events_committee_id_created_at_event_id_idx" ON "events"("committee_id", "created_at", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_questions_event_id_position_key" ON "event_questions"("event_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "event_questions_question_id_event_id_key" ON "event_questions"("question_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_attendance_token_hash_key" ON "event_registrations"("attendance_token_hash");

-- CreateIndex
CREATE INDEX "event_registrations_user_id_registered_at_registration_id_idx" ON "event_registrations"("user_id", "registered_at", "registration_id");

-- CreateIndex
CREATE INDEX "event_registrations_event_id_status_registered_at_registrat_idx" ON "event_registrations"("event_id", "status", "registered_at", "registration_id");

-- CreateIndex
CREATE INDEX "event_registrations_status_confirmation_deadline_idx" ON "event_registrations"("status", "confirmation_deadline");

-- CreateIndex
CREATE INDEX "event_registrations_reviewed_by_idx" ON "event_registrations"("reviewed_by");

-- CreateIndex
CREATE INDEX "event_registrations_checked_in_by_idx" ON "event_registrations"("checked_in_by");

-- CreateIndex
CREATE INDEX "event_registrations_excused_by_idx" ON "event_registrations"("excused_by");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_event_id_user_id_key" ON "event_registrations"("event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_registration_id_event_id_key" ON "event_registrations"("registration_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_event_id_waitlist_position_key" ON "event_registrations"("event_id", "waitlist_position");

-- CreateIndex
CREATE INDEX "registration_answers_question_id_event_id_idx" ON "registration_answers"("question_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_answers_registration_id_question_id_key" ON "registration_answers"("registration_id", "question_id");

-- CreateIndex
CREATE INDEX "registration_blacklist_entries_resolved_by_idx" ON "registration_blacklist_entries"("resolved_by");

-- CreateIndex
CREATE UNIQUE INDEX "registration_blacklist_entries_registration_id_reason_key" ON "registration_blacklist_entries"("registration_id", "reason");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("member_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "committee" ADD CONSTRAINT "committee_parent_committee_id_fkey" FOREIGN KEY ("parent_committee_id") REFERENCES "committee"("committee_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "member_committee" ADD CONSTRAINT "member_committee_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("member_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "member_committee" ADD CONSTRAINT "member_committee_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committee"("committee_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committee"("committee_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event_questions" ADD CONSTRAINT "event_questions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_excused_by_fkey" FOREIGN KEY ("excused_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration_answers" ADD CONSTRAINT "registration_answers_registration_id_event_id_fkey" FOREIGN KEY ("registration_id", "event_id") REFERENCES "event_registrations"("registration_id", "event_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration_answers" ADD CONSTRAINT "registration_answers_question_id_event_id_fkey" FOREIGN KEY ("question_id", "event_id") REFERENCES "event_questions"("question_id", "event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration_blacklist_entries" ADD CONSTRAINT "registration_blacklist_entries_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration_blacklist_entries" ADD CONSTRAINT "registration_blacklist_entries_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- END GENERATED BASELINE

-- Custom row checks: keep these in migration history; Prisma schema alone cannot recreate them.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_canonical_check" CHECK (
        btrim("email") <> '' AND "email" = lower(btrim("email"))
    );

ALTER TABLE "member"
    ADD CONSTRAINT "member_branch_check" CHECK (
        "branch" IS NULL OR "branch" IN ('MAIN_M', 'MAIN_F', 'KHL_M', 'KHL_F')
    );

ALTER TABLE "committee"
    ADD CONSTRAINT "committee_parent_not_self_check" CHECK (
        "parent_committee_id" IS NULL OR "parent_committee_id" <> "committee_id"
    );

ALTER TABLE "events"
    ADD CONSTRAINT "events_capacity_check" CHECK ("capacity" > 0),
    ADD CONSTRAINT "events_confirmation_window_check" CHECK ("confirmation_window_hours" > 0),
    ADD CONSTRAINT "events_schedule_check" CHECK (
        "ends_at" > "starts_at" AND "registration_deadline" <= "starts_at"
    );

ALTER TABLE "event_questions"
    ADD CONSTRAINT "event_questions_position_check" CHECK ("position" >= 0),
    ADD CONSTRAINT "event_questions_options_check" CHECK (
        CASE
            WHEN "question_type" = 'text' THEN "options" IS NULL
            WHEN "options" IS NOT NULL AND jsonb_typeof("options") = 'array'
                THEN jsonb_array_length("options") > 0
            ELSE false
        END
    );

ALTER TABLE "event_registrations"
    ADD CONSTRAINT "registrations_waitlist_position_check" CHECK (
        (CASE
            WHEN "status" = 'WAITLISTED'
                THEN "waitlist_position" IS NOT NULL AND "waitlist_position" > 0
            ELSE "waitlist_position" IS NULL
        END) IS TRUE
    ),
    ADD CONSTRAINT "registrations_approval_check" CHECK (
        (
            (
                ("approved_at" IS NULL AND "confirmation_deadline" IS NULL)
                OR (
                    "approved_at" IS NOT NULL AND "confirmation_deadline" IS NOT NULL
                    AND "confirmation_deadline" > "approved_at"
                )
            )
            AND (
                "status" NOT IN (
                    'AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED',
                    'LATE_CANCELLATION', 'EXPIRED', 'NO_CHECK_IN'
                )
                OR ("approved_at" IS NOT NULL AND "confirmation_deadline" IS NOT NULL)
            )
        ) IS TRUE
    ),
    ADD CONSTRAINT "registrations_confirmation_check" CHECK (
        (
            (CASE
                WHEN "status" IN ('CONFIRMED', 'CANCELLED', 'LATE_CANCELLATION', 'NO_CHECK_IN')
                    THEN "confirmed_at" IS NOT NULL
                WHEN "status" = 'EXCUSED' THEN true
                ELSE "confirmed_at" IS NULL
            END)
            AND (
                "confirmed_at" IS NULL
                OR (
                    "approved_at" IS NOT NULL AND "confirmation_deadline" IS NOT NULL
                    AND "confirmed_at" >= "approved_at"
                    AND "confirmed_at" < "confirmation_deadline"
                )
            )
        ) IS TRUE
    ),
    ADD CONSTRAINT "registrations_cancellation_check" CHECK (
        (
            (CASE
                WHEN "status" IN ('CANCELLED', 'LATE_CANCELLATION') THEN "cancelled_at" IS NOT NULL
                WHEN "status" = 'EXCUSED' THEN true
                ELSE "cancelled_at" IS NULL
            END)
            AND (
                "cancelled_at" IS NULL
                OR ("confirmed_at" IS NOT NULL AND "cancelled_at" >= "confirmed_at")
            )
        ) IS TRUE
    ),
    ADD CONSTRAINT "registrations_excuse_check" CHECK (
        (CASE
            WHEN "status" = 'EXCUSED' THEN
                "excused_at" IS NOT NULL AND "excused_by" IS NOT NULL
                AND "excuse_reason" IS NOT NULL AND btrim("excuse_reason") <> ''
            ELSE "excused_at" IS NULL AND "excused_by" IS NULL AND "excuse_reason" IS NULL
        END) IS TRUE
    ),
    ADD CONSTRAINT "registrations_token_check" CHECK (
        (CASE
            WHEN "confirmed_at" IS NULL
                THEN "attendance_token_hash" IS NULL AND "attendance_token_encrypted" IS NULL
            ELSE
                "attendance_token_hash" IS NOT NULL AND btrim("attendance_token_hash") <> ''
                AND "attendance_token_encrypted" IS NOT NULL AND btrim("attendance_token_encrypted") <> ''
        END) IS TRUE
    ),
    ADD CONSTRAINT "registrations_check_in_check" CHECK (
        (
            ("checked_in_at" IS NULL AND "checked_in_by" IS NULL)
            OR (
                "status" = 'CONFIRMED'
                AND "confirmed_at" IS NOT NULL
                AND "checked_in_at" IS NOT NULL AND "checked_in_by" IS NOT NULL
                AND "checked_in_at" >= "confirmed_at"
            )
        ) IS TRUE
    );

ALTER TABLE "registration_blacklist_entries"
    ADD CONSTRAINT "blacklist_resolution_check" CHECK (
        (
            ("resolved_at" IS NULL AND "resolved_by" IS NULL AND "resolution_reason" IS NULL)
            OR (
                "resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL
                AND "resolution_reason" IS NOT NULL AND btrim("resolution_reason") <> ''
                AND "resolved_at" >= "created_at"
            )
        ) IS TRUE
    );

COMMIT;
