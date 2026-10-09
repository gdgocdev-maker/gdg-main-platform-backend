# Database Schema Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implement in this session; do not dispatch agents without authorization.

**Goal:** Deliver one reproducible local PostgreSQL schema for the thirteen planned tables and twelve approved registration statuses.

**Architecture:** Prisma models and committed migration SQL define the structure. PostgreSQL constraints protect row integrity; future NestJS transactions enforce permissions, transitions, capacity and time cutoffs. Keep incident history separate from mutable registration status.

**Tech Stack:** Existing PostgreSQL 17, Prisma 7.10.0, NestJS, TypeScript, Vitest, pnpm and Docker Compose; no new dependencies.

**Spec:** [Core Database Design Review](../specs/2026-10-05-core-database-design.md), including its current transition contract dated 2026-10-09.

## Global Constraints

- Thirteen tables: twelve source tables plus registration_blacklist_entries. Preserve source table names and integer IDs; camelCase Prisma fields map to snake_case columns.
- RegistrationStatus: PENDING, WAITLISTED, AWAITING_CONFIRMATION, CONFIRMED, DECLINED, CANCELLED, LATE_CANCELLATION, NOT_SELECTED, REJECTED, EXPIRED, NO_CHECK_IN, EXCUSED. Default PENDING.
- Supabase owns credentials; no password_hash or local auth.users FK. Membership remains nullable and unique.
- Only AWAITING_CONFIRMATION and CONFIRMED reserve seats. Schema must allow applications above capacity.
- Blacklist is internal terminology; participant copy uses Attendance notice. No automatic registration block.
- Use prisma7.config.ts explicitly. Never reset the active database or delete Docker volumes.
- No endpoints, schedulers, QR cryptography implementation, official data import, permission grants, commits or pushes in this schema task without the corresponding authorization.

## Review Focus

1. A non-member account must register without acquiring membership or a role: Task 1 tests nullable membership.
2. Direct SQL must not bypass answer/event consistency: Task 1 tests both composite foreign keys.
3. NULL must not bypass status/timestamp checks: Task 1 tests required fields explicitly, including EXPIRED versus NO_CHECK_IN.
4. Retried incident creation must not duplicate warnings or erase other history: Task 1 tests uniqueness and independent resolution.
5. Setup must preserve existing credentials and data: Task 2 tests repeated startup, failed migrations and missing-environment setup.

## Traffic audit and implementation gates — 2026-10-09

See [audit findings](../reviews/2026-10-09-database-plan-audit.md). These are design requirements, not evidence of measured capacity.

- Schema phase: validate access-pattern indexes with representative data and EXPLAIN (ANALYZE, BUFFERS); test constraints/concurrency on isolated databases. Include events(status, ends_at, event_id) for due-event discovery, alongside the start-time index. Do not add a GIN index to question options: questions are fetched by event, not searched by JSON contents.
- Before feature traffic: page PR/My Events lists using stable (registered_at, registration_id) cursors with an initial maximum page size of 100. Fetch an applicant page first, then obtain unresolved-warning flags for those user IDs in one set-based query; no per-row warning query or token payload in list responses. Preserve PR's required access to answers through a page-scoped batch or detail view, plus the original name/email search and status filters. Verify mixed-direction/order cursor predicates against the matching index.
- Set a connection budget before deployment: sum of all app replica pools, worker pools, migration connections and admin reserve must fit the database connection allowance. Existing PrismaService uses a singleton per module instance, pg defaults to max 10, and connection acquisition/connect timeout is 5000ms; neither establishes a traffic guarantee or query/lock timeout. Pool configuration and overload handling belong to feature/runtime work, not new schema columns.
- Keep event transactions short and order locks event first, registration IDs ascending. Proposed refinement: FOR NO KEY UPDATE for seat mutations with immutable event keys, to avoid conflicting with FK key-share locks; validate the protocol before replacing the conservative FOR UPDATE plan. Question freeze, registration submission and event edits must have an explicit compatible locking protocol and race tests.
- Re-read the current database clock after acquiring locks: transaction-start now() can become stale while waiting. Revalidate status/window before writes; define scan window as start-minus-one-hour <= current time < ends_at, and end processing at current time >= ends_at. Boundary convention is proposed for implementation review.
- Future jobs process one event and bounded registration batches (initial batch 100), committing each batch with conditional status updates and incident uniqueness. Re-read eligibility after lock acquisition; repeated/parallel workers must converge. Never hold a lock during email, provider calls, or QR rendering. Reject Remaining must preserve its approved semantics even when its implementation is batched.
- Future transaction retries are bounded (initial maximum 3 attempts) and restricted to retryable database conflicts; re-read all state and perform external effects only after commit. Set transaction/statement/lock budgets and test exhaustion. Admission limits must return controlled retryable errors instead of unlimited waiting or retry storms; exact latency limits require the traffic target.
- Waitlist contiguous renumbering has O(N) write cost under the event lock. Retain the approved ordering behavior for now; measure hot-event cost before proposing sparse ranks. Do not denormalize seat counts or blacklist booleans, add Redis, or partition tables without measured need.

## Review before execution

Physical proposals requiring review are required starts_at/ends_at timestamps instead of legacy date/time columns, required draft schedule/capacity, canonical lowercase users.email, ordered JSONB question options, JSON-encoded CHECKBOX answer_text, encrypted recoverable QR storage and the additional incident table's exact columns. Business decisions already approved are not reopened.

Permission grants and committee hierarchy stay out of seeds until approved. Undefined post-start cancellation, forgotten PENDING cleanup and the unspecified destination state for PR removal from the waitlist stay out of feature logic. The original allocation does require PR removal/reordering capability. They do not require inventing schema states.

### Task 1: Models, migration and database integrity tests

**Files:**
- Modify: prisma/schema.prisma
- Create: prisma/migrations/<generated_timestamp>_initial_core/migration.sql
- Create: prisma/migrations/migration_lock.toml
- Create: test/database-schema.e2e-spec.ts
- Modify: package.json (migration and isolated schema-test scripts)

**Interfaces:**
- Consumes: DATABASE_URL for normal application use; TEST_DATABASE_URL only for the dedicated schema test database.
- Produces: the thirteen named Prisma models specified in the design, RegistrationStatus and BlacklistReason enums, initial migration SQL, and prisma:migrate:deploy = `prisma migrate deploy --config prisma7.config.ts`.
- The test client uses existing PrismaClient + PrismaPg, never AppModule's configured application database. Require a PostgreSQL database name starting gdg_schema_test_ and differing from the normal database; reject missing/unsafe targets before any connection or write. Do not print either URL.

- [x] Review the table-definition proposals with the user; authorized on 2026-10-09 to define the tables. No cryptography algorithm or API contract is approved by this step.
- [ ] Add focused failing Vitest tests. Before schema creation, a correctly configured disposable database should fail because the expected tables are absent. Unsafe/missing test targets must fail with a clear guard error.
- [ ] Assert: non-member User succeeds; duplicate member/auth subject/canonical email fails; noncanonical email fails; duplicate user-role/member-committee/event-user pairs fail; unrelated FK IDs fail.
- [ ] Assert: answer for the wrong event fails through direct SQL; duplicate registration/question fails; question ordering is unique; invalid choice options outer shape fails.
- [ ] Assert: WAITLISTED without a positive position fails, duplicate event/position fails, other states require NULL position; reorder using distinct temporary positive positions commits and rolls back atomically.
- [ ] Assert: AWAITING_CONFIRMATION/EXPIRED require approval and deadline but no confirmation; CONFIRMED/NO_CHECK_IN require confirmation; NO_CHECK_IN rejects check-in metadata; check-in fields and token fields are paired; EXCUSED requires complete reason/actor/time. Test NULL cases, not only incorrect non-null values.
- [ ] Assert: duplicate incident reason for one registration fails; resolving one incident leaves a different incident unresolved; incomplete resolution metadata fails. Referenced event, user and history deletion is restricted.
- [ ] Implement models exactly from the reviewed spec. Add named CHECK constraints in migration SQL for positivity, schedule order, canonical email, question outer shape, status fields, token/check-in pairing and incident resolution. Keep all required nullable-field checks explicit with IS NOT NULL. Do not use current time in CHECK expressions.
- [ ] Run `pnpm exec prisma format --schema prisma/schema.prisma`, `pnpm exec prisma validate --config prisma7.config.ts`, `pnpm prisma:generate`, and `pnpm typecheck`. All must succeed using pinned dependencies.
- [ ] Generate the initial migration with `pnpm exec prisma migrate dev --create-only --name initial_core --config prisma7.config.ts` targeting only the disposable authoring database. Inspect generated SQL before adding custom constraints. Use a separate disposable shadow database when configured; it must differ from all application/authoring databases. --create-only can still prompt for a reset on drift: stop rather than accept it. Do not use the active developer database or reset prompts.
- [ ] Add test:schema to invoke only test/database-schema.e2e-spec.ts through the existing e2e Vitest configuration. Normal e2e runs skip this isolated suite when TEST_DATABASE_URL is absent; explicit test:schema must fail when it is absent. Use one independent transaction per expected SQL error, or explicit savepoints: PostgreSQL aborts a transaction after a constraint failure. Roll back fixtures per case; cleanup must never truncate a normal application database. Validate the test target before CLI migration commands too, allowing only an explicitly selected local/disposable host and gdg_schema_test_ database. A test-like database name alone does not authorize a remote target.
- [ ] Apply with prisma:migrate:deploy to two fresh gdg_schema_test_ databases. Run test:schema against each and compare schema-only dumps, excluding generated dump headers. Both must pass with equivalent tables/constraints; a second deploy must report no pending migrations.

- [ ] On disposable representative data (user estimate: 100–400 registrations per large event; test event sizes 100 and 400, plus a provisional 800-registration stress case; use 100 historical events × 400 registrations as a synthetic history scenario, not a retention forecast), run ANALYZE and EXPLAIN (ANALYZE, BUFFERS) for PR status page, My Events cursor page, reserved-seat count, next waitlist entry, expiry candidates, due events, token lookup, question fetch and a page of warning flags. Record timings, row estimates and rows scanned; do not force index scans or treat a small-table sequential scan as failure. Keep load fixtures out of migrations/seeds.
- [ ] Test simultaneous duplicate-registration inserts, waitlist position conflicts and incident inserts using separate connections; exactly one duplicate write succeeds and the other returns the expected constraint error. This proves uniqueness only, not future service capacity or check-in correctness.

### Task 2: Teammate startup and regression verification

**Files:**
- Modify: docker-compose.yml (backend startup command)
- Modify: test/gdg.test.sh (existing launcher assertions only where affected)
- Modify: SETUP.md and README.md (existing setup guides; verify filenames before editing)
- Reuse: gdg, compose.platform.yml and existing NestJS connection lifecycle tests

**Interfaces:**
- Consumes: Task 1's committed migration directory and prisma:migrate:deploy script.
- Produces: `gdg run` / `gdg backend run` apply reviewed migrations before starting NestJS; frontend-only startup remains independent.

- [ ] Extend the existing launcher verification where needed to assert service selection and environment preservation; verify current assertions before adding duplicates.
- [ ] Use the existing Compose backend command to run `pnpm prisma:migrate:deploy` followed by `pnpm start:dev`, with shell && so migration failure prevents application readiness. Do not add another launcher or duplicate SQL bootstrap path.
- [ ] Verify fresh local setup creates the thirteen tables, repeated startup preserves data and existing .env, and a deliberately failing migration in a disposable fixture prevents app startup. Do not alter committed successful migrations to simulate failure.
- [ ] Update the short English setup guide: Docker prerequisites, existing .env copy/setup path, install/run, pgAdmin inspection and how teammates apply committed migrations. Explain migrate deploy versus author-only migrate dev; no secrets in documentation.
- [ ] Run `sh test/gdg.test.sh`, `docker compose -f docker-compose.yml -f compose.platform.yml config --quiet`, `pnpm check`, `pnpm test:e2e`, `pnpm build`, and the isolated `pnpm test:schema` suite. Confirm backend readiness after migration. Report actual results and restore only service state changed by this verification.
- [ ] Inspect `git diff --check` and the complete diff, including migration SQL/FK actions/indexes. Ensure no .env, generated client, credentials, frontend changes or seed grants are included. Request commit authorization after verification.

## Feature traffic validation gate (before shared/production use)

User-estimated volume is 100–400 registrations per large event; this is not a concurrent-user estimate or a cap on applications. Use a 400-registration event for the baseline dataset. Pending concurrency estimates, the provisional stress workload remains 100 concurrent participant requests, 20 scanner requests and 5 PR mutations against one event, alongside normal dashboard reads. Run both sustained traffic and bursts, on isolated staging with synthetic identities; record hardware, pool/replica configuration, dataset, duration, throughput, p50/p95/p99 latency, error/timeout rate, pool waiting and lock waits. This is a test scenario, not a supported-capacity claim or an agreed service-level objective.

Required invariants: no oversold seats, one check-in per registration, no duplicate incidents, no QR after expired confirmation, no check-in at/after end, no question edits racing first registration, and no changes to unrelated events. Include lock-holder delays crossing confirmation/end cutoffs, exhausted pool, deadlock retry, worker restart between batches, email failure after commit and concurrent waitlist renumbering. Stop the load generator and verify the system recovers without a growing request backlog. Bound question/option counts, answer lengths and total registration payload in DTOs; reject duplicate question IDs and insert the registration/answers atomically against a frozen question set without one lookup per answer. Concrete payload limits are part of API review. Specify latency/error acceptance targets with the team before declaring traffic readiness.

## Deferred feature validation

This deliverable provides storage and row integrity. Later NestJS feature work must test capacity locking, status transitions, admin deadline snapshots, Reject Remaining, question freeze, waitlist promotion/cutoff, cancellation boundaries, QR issue/replay/security, end-of-event NO_CHECK_IN races, incident creation and PR excuse permissions. Database tests alone cannot prove these behaviors.

No application migrations or tests have been executed while writing this plan.


## Table-definition progress — 2026-10-09

Completed only the user-requested model-definition portion of Task 1: all thirteen models, twelve registration statuses, explicit FK actions, composite same-event answer relationships, optional account/membership links and planned indexes are in prisma/schema.prisma. Offline SQL contract checks failed before implementation and passed afterward. Prisma format/validate/client generation, pnpm check (lint, typecheck, one unit test), pnpm build and git diff --check passed. The generated SQL preview is ignored scratch data, not a committed migration.

Task 1 remains incomplete: custom CHECK constraints, migration history and actual PostgreSQL integration/concurrency/query-plan tests come next. No database was modified, seeded or reset; no commit or push was made.
