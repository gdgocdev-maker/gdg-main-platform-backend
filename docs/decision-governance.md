# Decision and Source Governance

## Purpose

This document prevents product, technical, and task sources from being silently mixed or overridden. It applies to all backend changes.

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
