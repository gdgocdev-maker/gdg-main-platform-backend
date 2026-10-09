# Phase 1 Migration Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for implementation. Steps use checkbox syntax. Stop after this phase for the user's review; commit only after explicit confirmation of the completed phase.

**Goal:** Produce reviewed initial PostgreSQL migration files for the thirteen defined Prisma models, without connecting to or changing any database.

**Architecture:** Generate baseline SQL offline from the committed Prisma schema using pinned Prisma 7.10.0. Add named row CHECK constraints that Prisma cannot express. Preserve generated keys, foreign keys, enum mappings, defaults and indexes; future NestJS services enforce cross-row workflow rules.

**Tech Stack:** PostgreSQL 17 SQL, Prisma 7.10.0, existing pnpm tooling; no new dependencies.

**Spec:** [Core database design](../specs/2026-10-05-core-database-design.md), [source alignment review](../reviews/2026-10-09-original-document-alignment.md), and the current committed prisma/schema.prisma.

## Global constraints

- Thirteen tables; twelve registration statuses with PENDING default. No changes to the already-defined models unless a concrete contradiction is reported and resolved.
- Preserve original stored enum labels through @map and source URL lengths VARCHAR(255).
- Supabase owns credentials; no password hashes, provider schema or seed identities.
- No DATABASE_URL output, database connection, DDL execution, resets, data import, Docker startup change, application feature, package script or seed in this phase.
- End-of-phase confirmation is required before each commit. No push is authorized by confirmation to commit.

## Review focus

- Nullable fields must not bypass checks through PostgreSQL's NULL/UNKNOWN behavior.
- Cancellation and EXCUSED must retain historical confirmation facts.
- Question JSON must distinguish SQL NULL from JSON null and safely reject non-arrays.
- References and unique indexes must retain source integrity and delete behavior.
- Migration contents must be reproducible without accessing the active database; successful static review is not proof of PostgreSQL execution.

## Audit disposition and risk gate

See [Phase 1 audit and risk register](../reviews/2026-10-09-phase-1-migration-risk-audit.md). This plan is suitable for file authoring after the user's review; it is not evidence of executable or traffic-ready migrations. Database validation remains a mandatory Phase 2 gate before teammate setup or shared deployment.

## Files

- Create: prisma/migrations/<UTC_timestamp>_initial_core/migration.sql
- Create: prisma/migrations/migration_lock.toml, containing provider = "postgresql".
- Modify: this plan and the parent plan only to record actual progress and verification.
- Reuse unchanged: prisma/schema.prisma, prisma7.config.ts and existing application/configuration files.

## Execution checklist

- [x] Verify feature branch, clean starting state apart from authorized planning edits, absence of existing migrations, and pinned Prisma version. Inspect local CLI help for supported diff flags.
- [x] Generate a baseline in ignored scratch storage using `pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --config prisma7.config.ts --output <scratch_file>`. Both inputs are offline; never use --from-config-datasource or --to-config-datasource. This supersedes the parent plan's migrate dev --create-only authoring step for this initial migration: no authoring/shadow database is needed.
- [x] Inspect the baseline for all thirteen tables, six enums, mapped enum values, optional/unique membership and Supabase identity, source bounds, PENDING default, unique registrations/answers/incidents, indexes and explicit FK actions. Verify both composite answer FKs share event_id.
- [x] Create one timestamped migration with explicit BEGIN/COMMIT enclosing the unchanged generated baseline and named checks below; add migration_lock.toml. Only ordinary indexes belong here, never CREATE INDEX CONCURRENTLY inside this transaction. Keep clear generated-baseline/custom-check boundaries for comparison. Avoid custom SQL functions/triggers for cross-row policy and avoid redundant indexes.
- [x] Review every check with a valid example, invalid example and NULL example in an ignored review worksheet. For state-dependent constraints, cover all twelve states and the combined constraints, retaining history for EXCUSED from EXPIRED, CANCELLED, LATE_CANCELLATION or NO_CHECK_IN. Include absent/partial timestamp groups, wrong QR groups and contradictions such as CANCELLED with a recorded check-in. CHECK expressions must be demonstrably true/false for each case; reject unintended UNKNOWN results using explicit null branches or a whole-predicate IS TRUE. Do not use IS TRUE to reject an intentionally valid all-NULL optional group. Record these as reviewed cases, not executed database tests.
- [x] Verify the baseline portion matches a newly generated offline diff and schema.prisma is unchanged. Validate the Prisma schema, verify six enum definitions, thirteen table definitions and sixteen distinct constraint names, check every SQL identifier uses the mapped database value/name, and run git diff --check. Static counts/text review do not validate SQL syntax or runtime truth tables. Review the complete SQL and final tracked-file list; no credentials, generated client or scratch review files may be staged.
- [x] Present the files, constraint summary and static verification results to the user. Explicitly report that PostgreSQL execution and integrity tests belong to Phase 2.
- [x] Wait for the user's confirmation of the completed phase, then commit only its reviewed files. Suggested message: `feat: add initial PostgreSQL migration and integrity checks`.

## Named CHECK constraint contract

Names below are migration-owned; Prisma will not recreate these checks from schema.prisma alone.

| Name | Required stored invariant |
| --- | --- |
| users_email_canonical_check | email is nonempty after trimming, and equals lower(btrim(email)); email syntax remains an API concern |
| member_branch_check | branch is NULL or MAIN_M / MAIN_F / KHL_M / KHL_F |
| committee_parent_not_self_check | parent is NULL or differs from committee_id; longer cycles remain a service concern |
| events_capacity_check | capacity > 0 |
| events_confirmation_window_check | confirmation_window_hours > 0 |
| events_schedule_check | ends_at > starts_at and registration_deadline <= starts_at |
| event_questions_position_check | position >= 0 |
| event_questions_options_check | text requires SQL NULL options; select/radio/checkbox require a non-NULL JSON array with length > 0. Use CASE before jsonb_array_length; element types, uniqueness and answer membership remain API validation |
| registrations_waitlist_position_check | WAITLISTED requires a non-NULL position > 0; all other statuses require NULL |
| registrations_approval_check | approved_at and confirmation_deadline are both absent or both present with deadline > approval; AWAITING_CONFIRMATION, CONFIRMED, CANCELLED, LATE_CANCELLATION, EXPIRED and NO_CHECK_IN require both |
| registrations_confirmation_check | CONFIRMED, CANCELLED, LATE_CANCELLATION and NO_CHECK_IN require confirmed_at; PENDING, WAITLISTED, AWAITING_CONFIRMATION, DECLINED, NOT_SELECTED, REJECTED and EXPIRED require NULL. EXCUSED may retain confirmation. Whenever confirmed_at exists, require approval/deadline and approved_at <= confirmed_at < confirmation_deadline |
| registrations_cancellation_check | CANCELLED/LATE_CANCELLATION require cancelled_at; whenever cancelled_at exists, require confirmed_at and cancelled_at >= confirmed_at. EXCUSED may preserve it. All statuses other than CANCELLED/LATE_CANCELLATION/EXCUSED require cancelled_at NULL |
| registrations_excuse_check | excuse fields are all NULL or all present, with a nonempty trimmed reason; EXCUSED requires the complete group; other statuses require all three NULL |
| registrations_token_check | hash/encrypted copy are both absent with confirmed_at absent, or both present and nonempty with confirmed_at present. This makes QR issuance atomic and preserves QR material for confirmed cancellation/NO_CHECK_IN/EXCUSED history; status/window checks invalidate scanning |
| registrations_check_in_check | checked_in_at/by are both absent or both present; present check-in requires confirmed_at and checked_in_at >= confirmed_at. present check-in requires status CONFIRMED; all other statuses, including NO_CHECK_IN, require both NULL. This follows the current rule that no cancellation/excuse overwrites a successful check-in |
| blacklist_resolution_check | resolved_at/by/reason are all NULL or all present; present resolution has a nonempty trimmed reason and resolved_at >= created_at |

Do not use now() or cross-table subqueries in row checks. Database rows do not expire themselves. Accepted capacity counts, event-relative deadlines/check-in windows, two-hour cancellation classification, waitlist promotion/contiguity, QR cryptography, permissions, question freeze and atomic incident/status transitions remain future service/transaction responsibilities. SQL cannot prove the encrypted copy is secure merely because the column is nonempty.

## Application and recovery boundary

- This is an initial empty-schema migration. Phase 2 must verify an explicitly selected disposable PostgreSQL database and public schema before deploy; do not apply to an existing official/developer schema, use IF NOT EXISTS to hide incompatible tables, or baseline an existing database without a separate reviewed plan. Offline generation cannot discover target drift.
- Phase 2 must verify transactional rollback by running a deliberately failing copy against a disposable database and checking that domain DDL did not persist. Prisma migration-history bookkeeping is separate; a failed migration may require explicit resolution before retry. Never claim automatic recovery just because SQL uses BEGIN/COMMIT.
- After any shared application, migration files are immutable. Corrections use a new forward migration; no reset/down script claims to restore lost data. Until shared use, any amendment must be explicit, reviewed and re-tested.
- Use migrate deploy with full migration history, not db push or raw execution of only the generated baseline: those paths omit the custom CHECK constraints or migration tracking. Future schema changes must preserve and re-test custom checks.
- SQL artifacts contain no real users, credentials, raw QR tokens or environment values. Token storage does not itself implement encryption, authorization or rate limiting.

## Following phases and confirmation gates

1. Phase 1: migration files and static review only; user confirms, then commit.
2. Phase 2: isolated database integration tests and two clean migration replays; user confirms, then commit. Include positive/negative/NULL cases for every check plus concurrent uniqueness tests. Also test atomic rollback of a failing migration copy, re-run deploy with no pending changes, and inspect actual pg_constraint definitions for all sixteen custom checks. A SQL execution failure must be fixed before approval for shared use.
3. Phase 3: migration application through gdg run and short setup documentation; user confirms, then commit.
4. Phase 4: representative query-plan/performance checks with 100/400 registrations and an 800-registration stress case; user confirms, then commit. API traffic tests remain gated on real features.

## Phase 1 result — confirmed for commit

Created prisma/migrations/20261009173345_initial_core/migration.sql and prisma/migrations/migration_lock.toml. The migration encloses the exact Prisma-generated baseline plus sixteen named row checks in BEGIN/COMMIT. The schema and application/startup configuration are unchanged. Generated CREATE SCHEMA IF NOT EXISTS public is retained solely as namespace setup; no IF NOT EXISTS masks an existing domain table.

Verification actually performed:

- Local pinned CLI version/help inspected (Prisma 7.10.0); offline schema diff executed twice.
- Initial missing-file assertion failed before implementation; structural artifact checks pass after implementation. These are not database tests.
- Generated baseline compared byte-for-byte with the fresh offline output; thirteen tables, six enums, sixteen distinct planned check names, transaction boundaries, mapped check columns and migration provider verified.
- Prisma validate passed; git diff confirms prisma/schema.prisma is unchanged.
- Static worksheet reviews valid/invalid/NULL examples for all sixteen checks, all twelve statuses and EXCUSED history from expiry/cancellation/no-check-in. Worksheet is ignored review scratch, not a database-test suite.
- Read-only independent static review found no actionable issues; reviewer explicitly did not execute PostgreSQL.
- Final whitespace and file-scope checks passed.

No database connection, migration application, seed, runtime/traffic test, commit or push performed. Phase 1 authoring/static review is complete. User confirmed committing this phase and starting Phase 2 in chat; commit follows verification. Phase 2 must prove SQL execution, constraints and transactional failure behavior before shared use.

Latest user instruction authorizes committing each verified phase and continuing to the next without another confirmation. Phase 1 committed as `2785d0b`. No push authorized.
