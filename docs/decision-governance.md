# Decision and Source Governance

## Purpose

This document prevents product, technical, and task sources from being silently mixed or overridden. It applies to all backend changes.

## Terminology

GDG on Campus UJ is a **group**, not a club. Use “group” in documentation and participant-facing copy, as clarified by the user on 2026-10-07. Membership means group membership.

## Source Authority by Domain

- **Approved decisions** define the current accepted direction only when they explicitly supersede an older decision or document. Record material architecture and product decisions here.
- **Notion tasks** define the requirements and Definition of Done for the assigned task. They do not define unrelated architecture or current implementation details unless explicitly approved as a decision.
- **Swagger/OpenAPI** defines the current frontend-backend API contract: routes, methods, request and response schemas, authentication requirements, documented errors, and compatibility expectations.
- **Repository code, tests, configuration, Prisma schema, and committed migrations** define current implemented behavior. If implementation materially differs from documentation, report the discrepancy; do not silently reconcile it.
- **Unified Platform Proposal** defines original product intent, platform goals, major product domains, and high-level user journeys. It is not a source for current low-level implementation details.
- **Web Doc Final** defines the approved technical baseline unless a later approved decision explicitly supersedes it. The current baseline is Next.js, React, TypeScript, Tailwind CSS, Framer Motion, and GSAP for frontend; NestJS, Node.js, and TypeScript for backend; MySQL and Prisma for persistence; NestJS Auth, JWT, Google OAuth, and RBAC for authentication and authorization; and Swagger/OpenAPI for the API contract.

## Conflict handling

Do not silently choose one source when sources conflict. First identify the conflict's domain, then apply the authority for that domain. If documented authority cannot resolve it, mark it `TBD` and request team clarification. Record material architecture or product decisions here. Do not change product behavior merely to make sources appear consistent.

## Current binding decisions

| Decision | Status |
| --- | --- |
| Frontend and backend are separate repositories | Approved |
| Next.js is frontend only | Approved |
| NestJS is the authoritative backend | Approved |
| Local development/testing uses PostgreSQL and Prisma | Approved by user on 2026-10-05; supersedes the local MySQL baseline |
| Authentication uses NestJS Auth, JWT, Google OAuth, and backend-enforced RBAC | Approved direction |
| Swagger/OpenAPI is the authoritative frontend-backend contract | Approved |

## Decision record minimum

Each new decision should record: date, owner/approver, status, context, decision, affected repositories, source links, and migration or rollback implications. Link the exact Notion task for task-scoped work.

## Legacy-source clarification

Web Doc Final describes some Next.js full-stack capabilities, including Server Actions. For this platform's backend responsibilities, that guidance is superseded by the approved separate-repository architecture: Next.js is frontend only and NestJS is authoritative.

## 2026-10-05 Local PostgreSQL development

- Owner/approver: project user in the current Codex chat.
- Status: approved for local development and testing.
- Context: backend developers need a shared schema on private local databases before the Database committee provides the official PostgreSQL database.
- Decision: use local PostgreSQL, pgAdmin for inspection, and committed Prisma schema/migrations for reproducible setup. Keep credentials in ignored `.env` files.
- Affected repository: backend; frontend continues to consume the NestJS API.
- Source: user's local-database instructions and authorization to begin setup in this chat; no external source URL supplied.
- Migration/rollback: the current Prisma schema contains no models or migrations. Use a separate PostgreSQL Docker volume; do not delete or transfer any existing MySQL data. Official database migration/transfer remains a later coordinated task.

## 2026-10-05 Supabase authentication ownership

- Owner/approver: project user in the current Codex chat.
- Status: approved direction; implementation remains pending.
- Decision: Supabase Auth owns credentials. NestJS verifies provider identity and enforces local roles, permissions, membership, and committee scope. Do not store password hashes in local users.
- Source: user explicitly stated “اعتمد الsupabase auth” during the schema review.
- Schema implication: proposed nullable unique users.auth_user_id UUID links pre-existing local records to provider identities. No cross-database foreign key is assumed.
- Supersedes: the supplied workflow's local password-hash ownership; the first-login invitation/reset workflow must be adapted with the auth owner before implementation.
- Migration/rollback: no auth columns or migrations have been applied. No existing accounts or passwords are transferred by this decision.

## 2026-10-05 PR registration scope and QR attendance

- Owner/approver: project user in the current Codex chat.
- Status: approved workflow direction; schema implementation pending.
- Source: supplied Backend Workflow sections 19–20, clarified by the user; the user's subsequent QR attendance requirements.
- Decision: authorized PR staff see events requiring registration management without a separate event-assignment step. Event ownership/editing remains a separate authorization rule.
- QR decision: acceptance precedes confirmation; issue the registration-specific secure QR only after user confirmation, show the same QR in the platform and confirmation email, and permit a single backend-validated check-in by authorized staff.
- Schema impact: plan token identity and check-in metadata tied to registrations, including non-member registrations; no event-to-PR assignment table. No personal data in the QR.
- Migration/rollback: no schema or migration has been applied; exact token storage and check-in lifecycle constraints remain proposed in the design review.

## 2026-10-07 Registration lifecycle approval

- Owner/approver: project user in this chat; explicit approval: “ok done, take the approve”.
- Status: approved behavior; implementation pending.
- Decision: use the original eleven categorized registration statuses (superseded by the 2026-10-09 update below) documented in the core database design. DECLINED includes voluntary waitlist withdrawal; remaining waitlisted users become NOT_SELECTED at event start, without a warning or later promotion.
- Confirmation: authorized admin sets the event window (default 24 hours); existing approval deadlines remain unchanged when it is edited.
- Cancellation: at least two hours before start uses CANCELLED; cancellation within the final two hours uses LATE_CANCELLATION. EXPIRED and LATE_CANCELLATION create incident warnings visible to PR, without blocking registration.
- Excuse: PR may set EXCUSED and resolve the corresponding incident warning while preserving history; other unresolved warnings remain visible.
- Source: subsequent user clarifications/approval in this chat supersede the original registration-state allocation. Full transition rules and remaining event-time edge cases are recorded in the core design document.
- Migration/rollback: documentation only; no migration, seed, or database operation performed. Warning storage expands the original 12-table core and remains a proposed schema detail.

## 2026-10-07 Full registration and attendance decision approval

- Owner/approver: project user; explicit “approved” annotation on the full decision summary.
- Status: approved business behavior; implementation pending.
- Decision: new confirmation deadlines are capped at event start; admin window edits affect future approvals only. The initial PENDING/WAITLISTED cleanup proposal is superseded by the 2026-10-09 transition contract below.
- Check-in: opens one hour before start and closes at event end. CONFIRMED with no recorded check-in at end creates a NO_CHECK_IN blacklist incident; actual attendance remains separate from registration status.
- Questions: questions/options cannot be changed or deleted after the first registration.
- Blacklist: EXPIRED, LATE_CANCELLATION and NO_CHECK_IN create informational incidents, never registration blocks. PR may excuse an incident, preserving history and unrelated incidents. Participant wording is Attendance notice; Blacklist is internal/database terminology.
- Scope: all other approved authentication, group membership, PR scope, capacity, QR, cancellation, waitlist remain in force; the status set is superseded by the 2026-10-09 update below. See the core database design's Full business decision approval section.
- Source/precedence: the user's approved full summary supersedes older open questions about these workflows; it does not approve unspecified physical-schema or cryptographic choices.
- Migration/rollback: documentation only; no code, schema, database migration, commit, push or deployment performed by this approval-recording task.

## 2026-10-09 Twelve-status schema planning update

- Owner/approver: project user; latest approved status and Reject Remaining clarifications in this chat.
- Status: approved workflow; schema/migration implementation pending.
- Status set: PENDING, WAITLISTED, AWAITING_CONFIRMATION, CONFIRMED, DECLINED, CANCELLED, LATE_CANCELLATION, NOT_SELECTED, REJECTED, EXPIRED, NO_CHECK_IN, EXCUSED. Default PENDING.
- EXPIRED: PR accepted but the user missed confirmation; create a blacklist incident.
- NO_CHECK_IN: confirmed user with no recorded scan at event end transitions from CONFIRMED to NO_CHECK_IN; create a blacklist incident and preserve confirmation history. This supersedes leaving the registration CONFIRMED after missing check-in.
- Selection: explicit Reject Remaining changes only PENDING to REJECTED. At event start, remaining WAITLISTED become NOT_SELECTED without a warning. This supersedes automatic PENDING-to-NOT_SELECTED cleanup; no new rule is inferred for forgotten PENDING applications.
- Attendance: successful check-in keeps CONFIRMED and sets checked_in_at/checked_in_by. PR may excuse an incident without deleting history or releasing a seat twice.
- Affected repository: backend design and decision documentation; no API or database migration applied.
- Source: user's approvals and request to update the plan with twelve statuses. Exact transitions are in the core design's Current transition contract section.


## 2026-10-09 Physical schema implementation proposal

- Status: proposed for review, not a new approved business decision or applied schema.
- Context: translate the approved twelve-status workflow into reproducible migrations.
- Proposal: thirteen tables including registration-linked blacklist history; required starts_at/ends_at instants support multi-day camps; canonical unique login email; JSONB choice options and JSON-encoded checkbox answers. Exact columns, constraints and mapping are in the core database design.
- Execution checklist: [Database Schema Migrations Implementation Plan](superpowers/plans/2026-10-09-database-schema-migrations.md). Permission seeds and feature endpoints remain separate.
- Migration/rollback: planning only. Future verification uses dedicated disposable databases, preserving the active developer database and Docker volumes.
