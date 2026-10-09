# Phase 4 — Representative SQL query review

## Workload and method

Observed on 2026-10-09 in a runner-owned PostgreSQL 17 container: PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit. Docker allocation: 10 CPUs / 8319504384 bytes.

Synthetic fixture: 800 accounts, 100 historical events × 400 registrations, current events with 100/400/800 registrations (41,300 registrations total), 515 questions, 4,000 unresolved historical incidents. One historical event remains published after its end time to exercise a real due-event candidate. No application data, official Supabase instance, production host, seeds or migration contents were changed.

`pnpm test:performance:local` creates a disposable database, applies migrations, loads `test/schema-performance.sql`, runs ANALYZE and EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON), then removes its server/network. It also reruns the schema/replay/recovery/e2e gates. Assertions verify fixture counts, seat counts, token lookup, question count, and nonempty due-event discovery. Run one query per measurement; no forced index scans. Measurements are predominantly cached, uncontended and include PostgreSQL execution only. They are observations, not latency targets or supported traffic limits.

## Measurements

Estimated/actual rows describe the root plan node. Rows visited sum returned and filtered/rechecked rows × loops at relation scan nodes; this is a diagnostic approximation, not distinct rows or disk reads. Buffers are root shared hit/read blocks.

| Event size | Query | Execution ms | Estimated / actual rows | Rows visited | Hit / read buffers |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 | PR status page | 0.025 | 4 / 40 | 40 | 4 / 0 |
| 100 | My Events cursor page | 0.348 | 16 / 50 | 103 | 113 / 0 |
| 100 | Reserved seats | 0.040 | 1 / 1 | 40 | 7 / 0 |
| 100 | Next waitlist entry | 0.031 | 1 / 1 | 20 | 7 / 0 |
| 100 | Expiry batch | 0.173 | 29 / 50 | 260 | 26 / 0 |
| 100 | Due events | 0.031 | 4 / 1 | 103 | 8 / 0 |
| 100 | Token lookup | 0.024 | 1 / 1 | 1 | 3 / 0 |
| 100 | Questions | 0.052 | 5 / 5 | 5 | 10 / 0 |
| 100 | Warning flags page | 3.592 | 50 / 50 | 4750 | 14055 / 0 |
| 400 | PR status page | 0.027 | 6 / 50 | 50 | 6 / 0 |
| 400 | My Events cursor page | 0.295 | 16 / 50 | 103 | 113 / 0 |
| 400 | Reserved seats | 0.078 | 1 / 1 | 160 | 14 / 0 |
| 400 | Next waitlist entry | 0.047 | 1 / 1 | 80 | 11 / 0 |
| 400 | Expiry batch | 0.112 | 29 / 50 | 260 | 26 / 0 |
| 400 | Due events | 0.034 | 4 / 1 | 103 | 8 / 0 |
| 400 | Token lookup | 0.028 | 1 / 1 | 1 | 3 / 0 |
| 400 | Questions | 0.067 | 5 / 5 | 5 | 10 / 0 |
| 400 | Warning flags page | 3.470 | 50 / 50 | 5050 | 14058 / 0 |
| 800 | PR status page | 0.037 | 11 / 50 | 50 | 5 / 0 |
| 800 | My Events cursor page | 0.335 | 16 / 50 | 103 | 113 / 0 |
| 800 | Reserved seats | 0.084 | 1 / 1 | 320 | 21 / 0 |
| 800 | Next waitlist entry | 0.079 | 1 / 1 | 160 | 15 / 0 |
| 800 | Expiry batch | 0.111 | 29 / 50 | 260 | 26 / 0 |
| 800 | Due events | 0.031 | 4 / 1 | 103 | 8 / 0 |
| 800 | Token lookup | 0.024 | 1 / 1 | 1 | 3 / 0 |
| 800 | Questions | 0.059 | 5 / 5 | 5 | 10 / 0 |
| 800 | Warning flags page | 3.665 | 50 / 50 | 5450 | 14061 / 0 |

## Plans and findings

- **PR status page**: indexes `event_registrations_event_id_status_registered_at_registrat_idx`; sequential scans none.
- **My Events cursor page**: indexes `event_registrations_registration_id_event_id_key`, `event_registrations_user_id_registered_at_registration_id_idx`; sequential scans none.
- **Reserved seats**: indexes `event_registrations_event_id_status_registered_at_registrat_idx`; sequential scans none.
- **Next waitlist entry**: indexes `event_registrations_event_id_status_registered_at_registrat_idx`; sequential scans none.
- **Expiry batch**: indexes `event_registrations_status_confirmation_deadline_idx`; sequential scans none.
- **Due events**: indexes none; sequential scans `events`.
- **Token lookup**: indexes `event_registrations_attendance_token_hash_key`; sequential scans none.
- **Questions**: indexes `event_questions_event_id_position_key`; sequential scans none.
- **Warning flags page**: indexes `event_registrations_event_id_waitlist_position_key`, `event_registrations_user_id_registered_at_registration_id_idx`, `registration_blacklist_entries_registration_id_reason_key`; sequential scans none.

The initial warning-flags EXISTS projection caused PostgreSQL to precompute matches by scanning the history and incidents (approximately 45,400–46,100 visited rows, 4.60–4.83 ms). The measured final shape uses a scalar correlated SELECT true LIMIT 1 with COALESCE, allowing the planner to consult each displayed applicant’s history and stop at the first unresolved incident. The final shape visited about 4,750–5,450 rows in 3.47–3.67 ms but increased shared buffer hits from roughly 400 to roughly 14,000; fewer visited rows alone is not proof of lower resource cost. Compare both shapes with the actual endpoint workload. This is a candidate query shape for the future PR service; no API was added or changed. It still scales with history per displayed user, so large histories or different incident distributions must be remeasured.

The events scan covers only 103 rows; a sequential scan is reasonable. The waitlist query uses the event/status index and sorts a bounded event subset rather than necessarily choosing the unique position index. Expiry examines 260 matching candidates for a 50-row batch. Estimates differ from actual rows in the skewed mixed-status workload. Existing indexes support these fixtures; this evidence does not justify another index migration. Reassess against actual service queries and staging statistics as history grows.

## Remaining gates and risk

No API concurrency, connection-pool saturation, lock contention, service capacity enforcement, QR race/security test, scheduler idempotency or email delivery was measured. Those require implemented NestJS features and agreed traffic/latency targets. The 800-registration case is provisional stress data, not a concurrency guarantee. SQL constraints do not replace authorization or cross-row workflow validation.

Fresh read-only review found and corrected the due-event predicate/fixture issue: use ends_at <= now(), with one ended published event and an asserted candidate count. It found no remaining correctness or targeting blocker. Deferred minor: Docker cleanup stops on the first removal error; daemon failure may leave runner-named disposable resources for manual cleanup. Do not use global Docker prune to clean them.
