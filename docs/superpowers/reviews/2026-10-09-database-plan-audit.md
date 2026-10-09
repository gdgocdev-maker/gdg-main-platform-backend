# Database Plan Audit — 2026-10-09

Scope: review of the planned thirteen-table schema and migration/setup checklist on feat/database-schema-migrations. Read the plan, design, existing empty Prisma schema, PrismaService/module, adapter/pg-pool implementation, package scripts, Compose and e2e tests. This is a planning audit, not a code security certification or executed load test.

Skills: database-schema-designer, backend-review, review and verification. Review was read-only; the subsequent remediation changed documentation only. No independent reviewer or subagent was used.

## Findings and disposition

| Priority | Evidence / risk | Plan correction | Remaining proof |
| --- | --- | --- | --- |
| High | Design serializes event mutations with FOR UPDATE; scans, mass expiry and renumbering can queue behind the same hot event. This lock also conflicts with FK key-share locks. | Keep transactions short, consistent event-first lock order, bounded jobs; propose FOR NO KEY UPDATE for immutable keys after protocol validation. | Real concurrent service tests, including question freeze/submission, capacity changes, cancellation and scanning; measure lock wait. |
| High | Deadline/check-in validation could use transaction-start now() before a long lock wait, allowing a late action with a stale clock. | Sample current DB time after locks and revalidate eligibility; explicitly test waits crossing deadlines/end. | Future service tests and review of the actual SQL time expression. |
| High | PrismaService sets connectionTimeoutMillis 5000 but no explicit max; installed pg-pool defaults max to 10 per pool. That timeout does not bound running SQL/lock waits, and multiple replicas/modules/workers multiply connections. | Add deployment connection-budget gate, singleton reuse, bounded transaction/query/lock waits, admission handling and conflict-only retries. | Actual database allowance, replica counts, worker topology and traffic requirements; runtime implementation and exhaustion tests. |
| Medium | Plan omits query-plan verification and bounded page sizes. Per-applicant warning lookups can create N+1 reads; fetching QR material/answers with every row adds traffic and exposes credentials. | Add keyset pages, maximum initial page size 100, page-scoped set-based warning query and minimal list projections. Add due-event end-time index and representative EXPLAIN checks; omit speculative JSON indexes. | Actual query SQL, representative plans and measured latency/write cost. |
| Medium | Waitlist renumbering is O(N); unbounded end/expiry jobs or Reject Remaining could hold locks for many rows. | Record the cost, use bounded jobs and conditional updates, preserve explicit bulk-action semantics, test restarts and parallel workers. | Hot-event test; if batching cannot preserve agreed Reject Remaining semantics, resolve that implementation tradeoff before release. |
| Medium | Test plan rolls back fixtures but expects many constraint failures; a failed statement aborts its PostgreSQL transaction. CLI migration commands had no equivalent target guard; create-only can still prompt for reset on drift. | Separate negative-test transactions/savepoints, guard local disposable targets before both tests and DDL, separate shadow DB, never accept reset prompts. | Implemented safety tests and two clean migration replays. |

The corrections are requirements in the revised plan. They are not implemented mitigations in PrismaService or NestJS feature code.

## Question/answer review

The two-table design remains reasonable: event_questions fetched by event and position, and registration_answers uniquely keyed by registration/question with composite FKs enforcing the same event. JSONB options need no GIN index for this access pattern; choices are fetched as a small ordered array. TEXT answers, including JSON-encoded checkbox arrays, remain a storage proposal rather than a published DTO contract.

Before enabling registration traffic, DTOs must bound question count, option count, question/answer length and total request size; concrete limits belong to the API review. Reject duplicate question IDs, unknown options, malformed checkbox arrays and missing required answers. Validate against one frozen question set and insert the registration plus all answers atomically. Serialize first registration against question edits so the freeze cannot be bypassed by concurrent requests. Avoid one database query per submitted answer. Do not add columns or a separate options table solely for hypothetical traffic.

## Workload and readiness

User clarification after the audit: large events expect 100–400 registrations. This is event volume, not concurrent users or a hard application limit. The plan now tests 100 and 400 registrations per event, a provisional 800-registration stress case, and a synthetic history dataset of 100 events × 400 registrations. Concurrent users, peak arrival rate, scanner count, deployment resources, latency/error targets and retention period remain unknown. The 100 participant + 20 scanner + 5 PR concurrent-request scenario remains a provisional stress test, not a capacity claim. Update it when concurrency estimates arrive.

Schema-stage verification: migration replay, constraints, concurrent duplicate inserts and query plans. Feature-stage verification: API authorization/input boundaries, hot-event contention, scheduling races, overload/recovery and email/QR effects. A successful schema test cannot establish application traffic readiness. No cache, partitioning, counter duplication or new infrastructure is justified by current measurements.

## Technical evidence

- [PostgreSQL 17 row locking and deadlocks](https://www.postgresql.org/docs/17/explicit-locking.html): locks conflict by mode and persist through transaction completion; consistent order is required.
- [Prisma v7 connection pooling](https://docs.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool): driver adapter pool options govern connections. Confirmed locally that the installed adapter constructs pg.Pool from its supplied config and pg-pool defaults max to 10.
- [PostgreSQL 17 EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html): representative statistics and measured plans are needed; an index's existence alone proves no performance target.
- [Prisma migrate dev](https://docs.prisma.io/docs/cli/migrate/dev): create-only can still prompt for reset on detected drift; use only disposable authoring targets and verify pinned CLI behavior.

## Checks actually run

Repository and dependency inspection, official reference review, documentation consistency/link assertions and git diff --check. No schema was generated, database migrated, benchmark run, application tests executed, commit made or change pushed during this audit.
