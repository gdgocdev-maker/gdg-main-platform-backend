# Phase 1 Migration Plan Audit and Risk Register

Date: 2026-10-09. Scope: read-only review followed by documentation remediation of the Phase 1 plan; no SQL migration authored/applied. Compared the plan against the committed Prisma models, approved lifecycle contract, source-alignment report, existing Prisma config and locally installed CLI. Skills used: database-schema-designer, backend-review, security-review, review and verification. This is one review in the current session, not an independent external audit.

## Findings

1. **High — partial application on SQL failure.** The previous plan specified generated baseline plus checks but no transaction wrapper. A failure near the end could leave earlier domain objects in place if executed without a transaction. Correction: explicit BEGIN/COMMIT for the initial migration; no concurrent index creation. Phase 2 must prove rollback with a failing copy and inspect Prisma's failed-history handling. Do not assume the migration-history row rolls back with domain DDL.
2. **High — terminal QR history could be discarded.** Previous token rule required tokens only for current CONFIRMED, while cancelled/NO_CHECK_IN/EXCUSED rows with confirmed_at could have both token fields NULL. Correction: token pair presence follows confirmed_at, including terminal history. EXCUSED from expiry still has no confirmation/token. Invalidation remains status/window validation; revocation/rotation mechanisms are not introduced here.
3. **High — contradictory state fields were permitted.** A CANCELLED row could carry checked_in_at/by, or an unrelated status could carry excuse metadata. Correction: check-in exists only in CONFIRMED; cancellation timestamp exists only in CANCELLED/LATE_CANCELLATION or preserved EXCUSED history; excuse metadata exists only in EXCUSED. This implements the current lifecycle's rule against cancelling/excusing an already checked-in registration. A future attendance correction workflow requires a separately reviewed change.
4. **Medium — static review could be mistaken for execution proof.** A reviewed SQL file may contain invalid expressions, wrong enum literals, or NULL loopholes. Correction: validate the combined sixteen constraints against all twelve status scenarios on paper in Phase 1, and require actual PostgreSQL positive/negative/NULL tests, constraint-catalog inspection and replay in Phase 2. No performance or deployment-readiness claim before those gates.
5. **Medium — initial-target and migration recovery boundaries were incomplete.** Offline diff cannot inspect an existing target or retain custom SQL if someone later uses db push. Correction: explicit empty/disposable target gate, full migration-history replay, no drift-masking IF NOT EXISTS, immutable files after shared application, forward correction and explicit failed-history resolution.

Corrections strengthen the agreed stored-fact invariants; they add no status, permission, table, traffic limit or API endpoint. The historical audit remains a record of the pre-correction plan.

## Current risk register — before validation

Priorities are qualitative judgments from the current design; incident probabilities and capacity have not been measured. Owner is the backend implementer for this phase, with shared deployment decisions owned by the team.

| Risk | Priority | Control / phase | Residual risk and evidence required |
| --- | --- | --- | --- |
| Active/official database altered accidentally | High | Phase 1 offline-only inputs; Phase 2 explicit disposable-target guard; no deploy in this phase | Connection aliases/incorrect target config still need runtime safety tests |
| Invalid state passes nullable CHECK | High | Explicit NULL branches/IS TRUE, combined-state worksheet; Phase 2 SQL cases | Not proven until PostgreSQL tests run |
| Migration failure leaves partial schema | High | Transactional initial DDL; Phase 2 injected-failure test | Migration-history failure recovery remains separate |
| QR history removed or token exposed | High | Presence tied to confirmed_at, no real tokens in artifacts; future owner-scoped API/encryption | SQL cannot prove encryption, secret handling or prevent authorized SQL from replacing a nonempty token |
| Concurrent last-seat acceptance or duplicate scan | High | Future event lock/conditional updates/unique constraints; feature concurrency tests | Phase 1 cannot enforce cross-row capacity or validate race behavior |
| Custom SQL checks lost on later schema evolution | Medium | Committed migration history, catalog assertions in Phase 2, forward migrations | Team must maintain SQL-owned constraints through each schema change |
| Hot-event locks, waitlist write amplification or pool saturation | Medium | Existing traffic plan: 100–400 registrations, bounded jobs, connection budget and measured Phase 4 queries | Registration volume is known; concurrent requests/hardware/latency targets remain unknown |

## Projected residual risks — after successful validation

This is the filtered final-state view requested by the user, conditional on successful migration replay, SQL integrity/rollback tests, setup verification, representative performance checks and the relevant backend feature/security/concurrency tests. Those checks have not run. No current finding is closed by this projection; phases 1–4 alone do not validate unimplemented API features.

### Findings eligible for closure with evidence

| Current finding | Evidence needed before marking the finding fixed | Boundary of that evidence |
| --- | --- | --- |
| NULL loopholes and contradictory row fields | All sixteen checks exercised through valid/invalid/NULL cases and combined twelve-status scenarios; inspect installed constraints | Proves tested stored invariants, not allowed transitions or permission checks |
| Partially created initial schema after SQL failure | Injected failure rolls back domain objects; subsequent failed-migration resolution/retry verified | Applies to this initial migration, not every future migration or backup recovery |
| Missing/incorrect keys, enum mappings and custom checks | Two clean migration replays, catalog inspection, equivalent resulting schema and no-op repeat deploy | Applies to the tested migration history and PostgreSQL version |
| Known seat/check-in/incident races | Feature tests use separate connections and cover duplicate requests, cutoff waits, worker retries and final-seat contention | Covers the implemented/tested protocol, not future changes or untested workloads |

### Risks retained in the final operating register

| Residual risk | Why it remains after passing tests | Ongoing control / owner |
| --- | --- | --- |
| Incorrect deployment target or configuration | Test guards cannot prevent every privileged/manual deployment mistake | Team deployment owner verifies target/environment, uses least privilege and a reviewed recovery procedure |
| Traffic or data volume exceeds tested conditions | 100–400 registrations/event does not define peak request rate, resource limits or future history size | Backend/operations owner monitors latency, pool/lock waits and errors; repeat load tests when workload/resources change |
| QR tokens/keys exposed or used by the wrong person | Nonempty/encrypted storage and tests do not prevent all credential leaks; a QR is a bearer credential | Backend/security owner protects keys, scopes retrieval, avoids token logging, limits abuse and supports staff identity checks |
| External service or infrastructure failure | Supabase, email, database or network availability is outside row-integrity guarantees | Relevant integration/operations owners implement safe retries, observable failures and recovery; exercise outage paths before readiness claims |
| Regression or lost constraints in later changes | Today's passing migration/tests cannot validate tomorrow's schema, dependency or code changes | Backend reviewers maintain regression/catalog checks and immutable shared migrations; review forward changes and restore procedures |
| Attendance record differs from physical attendance | No recorded scan cannot prove a person was absent; duplicate prevention cannot ensure staff scanned everyone | PR checks scans before event end and uses the approved incident/excuse process; NO_CHECK_IN remains a missing-record fact |

Do not assign a final residual severity or declare the system safe from these risks until test results, environment details and operational controls are available. Any unresolved product rule remains a decision gate for the affected feature, rather than a risk silently accepted by a passing test.

## Residual product boundaries

No new rule for forgotten PENDING applications, post-start cancellation or the state after PR removes a waitlisted user is invented. Required questions and option element validity, longer committee cycles, lifecycle transitions and authorization remain backend concerns. A row CHECK validates the current stored facts, not the authenticity of history or a permitted OLD-to-NEW transition.

## Technical evidence and checks

- Local Prisma CLI reports 7.10.0 and supports offline --from-empty/--to-schema/--script/--output. Existing config resolves schema/migration paths; loading the config is not a database operation.
- [PostgreSQL 17 CHECK semantics](https://www.postgresql.org/docs/17/ddl-constraints.html): NULL can satisfy a check; cross-row conditions do not belong in CHECK constraints.
- [Prisma schema engine architecture](https://github.com/prisma/prisma-engines/blob/0edf323efd1d98336f3f0a68684b56f689b900d3/schema-engine/ARCHITECTURE.md): migration transaction behavior must be reviewed rather than assumed. BEGIN/COMMIT choice is explicit in this plan; pinned-CLI execution proof is deferred to Phase 2.

Actually run: local CLI version/help inspection, plan constraint-name/status/link consistency assertions, and git diff --check. No PostgreSQL execution, load tests, migration generation, commit or push during this audit. Planning is ready for review; implementation and database safety proof remain pending.
