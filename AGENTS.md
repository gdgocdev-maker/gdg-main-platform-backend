# GDG Main Platform Backend - Operating Rules

## Purpose and authority

This repository owns the authoritative backend for the GDG Main Platform: NestJS APIs, authentication and authorization enforcement, domain logic, persistence through Prisma/PostgreSQL, and integrations approved for the backend.

NestJS is the authoritative backend framework. The separate Next.js repository is frontend only; do not move backend authority into it or create a parallel backend.

## Source Authority by Domain

- Approved decisions define the current accepted direction when they explicitly supersede an older decision or document; record material architecture and product decisions in `docs/decision-governance.md`.
- An approved Notion task defines the assigned task's requirements and Definition of Done, not unrelated architecture or current implementation details unless it is explicitly approved as a decision.
- Published Swagger/OpenAPI defines the current frontend-backend API contract.
- Repository code, tests, configuration, schema, and migrations define current implemented behavior.
- The Unified Platform Proposal defines original product intent, major domains, and high-level user journeys; it does not define current low-level implementation details.
- Web Doc Final defines the approved technical baseline unless a later approved decision supersedes it.

Do not silently choose one source when two sources conflict. Identify the conflict's domain, apply the authority for that domain, and record the discrepancy. If documented authority cannot resolve it, mark it `TBD` and request team clarification. Do not change product behavior merely to make sources appear consistent.

## Architecture guardrails

- Use NestJS with TypeScript for server code and Prisma with PostgreSQL for persistence.
- Enforce authentication, authorization, validation, and business rules on the server. Client-side checks never replace them.
- Treat Prisma schema and committed migrations as the source of truth for implemented database structure.
- Publish and maintain Swagger/OpenAPI as the authoritative API contract. Update it in the same change as every endpoint or DTO change; do not make incompatible changes without coordinated frontend impact review and a documented migration decision.
- Keep secrets in local/deployed environment configuration only; never commit credentials or log them.
- Keep the AI evaluation integration as an integration boundary. Its evaluation model, criteria, and decisions belong to the authorized data/AI owners, not this repository unless explicitly approved.

## Change discipline

- Make the smallest correct, task-scoped change. Preserve unrelated work.
- Validate input through documented DTOs and return predictable, documented API behavior.
- Do not run destructive data operations or apply production migrations without explicit approval and environment confirmation.
- Update relevant API, auth, database, or setup documentation when approved behavior changes.
- Validate changed code with available repository checks and report only checks actually run.

## Handoff

State what changed, API/schema/migration impact, documentation updated, `TBD` items, and checks actually run. Branch conventions, commit format, PR process, release process, and deployment workflow are deliberately **TBD** until the team confirms them.
