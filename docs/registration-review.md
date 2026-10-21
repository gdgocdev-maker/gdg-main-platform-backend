# Event Registration, Review and Waitlist

Members browse events, register, then confirm or decline an offered seat. PR reviews registrations, keeps an ordered waitlist, and the backend refills freed seats automatically.

## Status flow

```
PENDING ──accept──► AWAITING_CONFIRMATION ──member confirms──► CONFIRMED
   │                      ├── member declines ──► DECLINED ─┐
   │                      └── deadline passes ──► EXPIRED  ─┴─► waitlist #1 promoted
   ├──reject──► REJECTED
   └──waitlist──► WAITLISTED (waitlist_position 1..n)
```

- Accepting sets `approved_at`, `reviewed_by_member_id` and `confirmation_deadline = now + events.confirmation_window_hours` (default 24), capped at the event start. No acceptance or promotion after the event starts (`EVENT_STARTED`).
- An expired confirmation also records a `CONFIRMATION_EXPIRED` attendance notice (`registration_blacklist_entries`); notices never block registration.
- Seats held = `AWAITING_CONFIRMATION + CONFIRMED`. Accepting when held ≥ capacity fails with `CAPACITY_REACHED`.
- Every seat or waitlist change locks the event row (`SELECT … FOR UPDATE`) inside a transaction, so concurrent reviewers cannot oversell the last seat.
- Emails are sent only after the transaction commits. A failed email is logged and never undoes the change.

## Access

The auth layer sets `request.user = { personId, memberId? }` (see `src/auth/current-user.ts`); until it exists protected routes answer 401. Member routes need `personId`; PR routes need a `memberId` whose permissions come from `committee_permission`:

| Route | Permission | Granted to |
| --- | --- | --- |
| `GET /events/:eventId/registrations` | `registrants.view` | PR Leader, Co-Leader, Member |
| `PATCH /registrations/:registrationId` | `registrations.review` | PR Leader, Co-Leader, Member |
| `PUT /events/:eventId/waitlist` | `registrations.review` | PR Leader, Co-Leader, Member |
| `POST /events/:eventId/check-in` | `registrations.review` | PR Leader, Co-Leader, Member |

Anyone else receives 403 `FORBIDDEN`.

## Member endpoints

| Route | Auth | Behavior |
| --- | --- | --- |
| `GET /events` | none | Published events with `registrationOpen` |
| `GET /events/:eventId` | optional | Published event, its questions, `registrationOpen`, and `myRegistration` when signed in |
| `POST /events/:eventId/registrations` | required | Body `{ "answers": [{ "questionId": 1, "answer": "text" }] }`; checkbox answers are a list of options. Creates a `PENDING` registration; capacity never blocks it |
| `GET /my/registrations` | required | All my registrations with `secondsToConfirm`, `canConfirm`, `canDecline`, and `attendanceToken` (QR payload) once confirmed |
| `POST /registrations/:id/confirm` | owner | `AWAITING_CONFIRMATION` before the deadline → `CONFIRMED`, issues the QR token |
| `POST /registrations/:id/decline` | owner | `AWAITING_CONFIRMATION` → `DECLINED` and promotes waitlist #1; `WAITLISTED` → `DECLINED` and renumbers |

Answers are stored as text; checkbox choices as a JSON array string. The QR token is random and contains no personal data: the database keeps its SHA-256 hash and an AES-256-GCM copy keyed by `ATTENDANCE_TOKEN_KEY` (set it in `.env`).

## DATA event management and dashboard

| Route | Behavior |
| --- | --- |
| `POST /events` | Creates a draft event and optional question list. `createdByMemberId` and `committeeId` are assigned from the authenticated member and authorized DATA membership; they cannot be supplied in the body. |
| `PATCH /events/:eventId` | Updates supplied event fields. If `questions` is included, it is the complete replacement list; retain existing question IDs to edit them. Questions with submitted answers cannot be removed. |
| `DELETE /events/:eventId` | Deletes an event created by the requester. Events with registrations cannot be deleted. |
| `GET /dashboard/events` | Lists events created by the requester or belonging to any of their active committees, including every event status. |

Create requires `name`, `startsAt`, `endsAt`, `capacity`, and `registrationDeadline`. Question fields are `questionText`, `questionType`, optional `isRequired`, and optional `options`; choice questions require at least one option. Update accepts the same event fields optionally. Success responses use the standard `apiSuccess` envelope. Expected failures: 400 for invalid input, 401 for unauthenticated requests, 403 for missing DATA leadership/permission or non-owner mutations, 404 for unknown events, and 409 when a deletion/removal would conflict with existing registrations or answers.

## PR endpoints

### GET /events/:eventId/registrations

Query: `page` (default 1), `pageSize` (1–100, default 20), `search` (name or email, case-insensitive), `status` (a registration status).

`data` contains `event`, `summary` (`accepted`, `capacity`, `confirmed`, `awaitingConfirmation`, `waitlisted`, `pending`), `items` (`registrationId`, `name`, `email`, `status`, `registeredAt`, `waitlistPosition`, `confirmationDeadline`, `answers[]`) and `pagination` (`page`, `pageSize`, `total`, `totalPages`). Items are ordered by registration time.

### PATCH /registrations/:registrationId

Body: `{ "status": "ACCEPTED" }` or `{ "status": "REJECTED" }`. Only `PENDING` or `WAITLISTED` registrations can be reviewed. An accepted registration is returned with status `AWAITING_CONFIRMATION`. Reviewing a waitlisted person removes them from the waitlist and closes the gap.

### POST /events/:eventId/check-in

Body: `{ "token": "<value read from the QR>" }`. PR staff (`registrations.review`) scan a confirmed guest's QR on the attendance page. The backend matches the token's SHA-256 hash, then requires the same event, status `CONFIRMED`, no earlier check-in, and the approved window (one hour before start until the event ends). Success records `checked_in_at` / `checked_in_by_member_id` once and returns `registrationId`, `name`, `checkedInAt`. Errors: `INVALID_QR_CODE` (400; unknown token, other event, or not confirmed), `ALREADY_CHECKED_IN` (409), `CHECK_IN_CLOSED` (409).

The registrants list also reports attendance: `summary.checkedIn`, `summary.notCheckedIn`, and each item's `checkedInAt`.

### PUT /events/:eventId/waitlist

Body: `{ "registrationIds": [12, 7, 33] }` — the complete waitlist in order; positions become 1..n. Listed registrations must belong to the event and be `PENDING` or `WAITLISTED`. Waitlisted people missing from the list return to `PENDING`. An empty list clears the waitlist.

## Errors

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` / `BAD_REQUEST` | Invalid body, query or id |
| 401 | `UNAUTHORIZED` | No authenticated member |
| 403 | `FORBIDDEN` | Missing PR permission |
| 404 | `EVENT_NOT_FOUND`, `REGISTRATION_NOT_FOUND` | Unknown event, or registration not in the event |
| 409 | `CAPACITY_REACHED` | No seat left |
| 409 | `INVALID_STATUS_TRANSITION` | The registration's status does not allow this action |
| 409 | `EVENT_STARTED` | Accept/promote after the event started |
| 409 | `REGISTRATION_CLOSED` | Registration deadline passed |
| 409 | `ALREADY_REGISTERED` | Second registration for the same event |
| 409 | `CONFIRMATION_EXPIRED` | Confirm/decline after the confirmation deadline |
| 503 | `REGISTRATION_BUSY` | Too many simultaneous changes to one event (queued over 10 s); nothing changed, retry |

Domain codes are allow-listed in `src/common/http/http-error.filter.ts` (`DOMAIN_ERROR_CODES`).

## Automatic promotion

`RegistrationReviewService.promoteNextFromWaitlist(eventId)` gives waitlist #1 a seat when one is free, renumbers the rest and sends the promotion email. The member decline flow calls it after a decline; `RegistrationsModule` exports the service.

`ConfirmationExpiryJob` runs every minute: overdue `AWAITING_CONFIRMATION` rows become `EXPIRED`, then each freed seat is offered to waitlist #1. A row only expires if it is still awaiting confirmation once the event is locked, so overlapping runs never promote the same person twice.

## Tests

`test/event-registrations.e2e-spec.ts` (members) and `test/registrations.e2e-spec.ts` (PR) run against a separate database:

```sh
TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5433/gdg_schema_test_registrations?schema=public" \
  pnpm exec vitest run --config ./vitest.config.e2e.ts test/event-registrations.e2e-spec.ts test/registrations.e2e-spec.ts
```

Create that database once and apply migrations to it with `DATABASE_URL` pointing at it.

The event-management authorization and ownership suite is `test/event-management.e2e-spec.ts` and uses the same dedicated-database requirement.

## TBD

- Email provider and templates (`RegistrationEmailService` currently only logs).
- Remaining WAITLISTED → `NOT_SELECTED` at event start, and CONFIRMED cancellation (`CANCELLED`/`LATE_CANCELLATION`): approved rules not in either task.
- Attendance token cryptography is an implementation choice to review.
- Check-in uses `registrations.review`; the unassigned `attendance.record` permission could replace it once granted.
- The confirmation email with the QR waits for the email provider.
- Swagger/OpenAPI publication for these routes.
- Shared pagination format (this module uses `page`/`pageSize`).
