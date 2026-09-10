# Backend Architecture

## Responsibility

This repository is the authoritative backend for the GDG Main Platform.

```
Next.js frontend -> NestJS API -> Prisma -> MySQL
```

The NestJS API owns server-side authentication, RBAC enforcement, input validation, domain logic, persistence, and approved external-service integration. The separate frontend renders the user experience and consumes documented API endpoints.

## Approved stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js LTS (20+ in the technical guide) |
| Backend | NestJS with TypeScript |
| Database | MySQL |
| ORM | Prisma |
| Authentication direction | NestJS authentication, JWT/token-based auth, Google OAuth |
| Authorization | RBAC |

The technical guide also identifies potential external services for file storage, email, error monitoring, analytics, and AI evaluation. Specific providers, configuration, implementation timing, and ownership are **TBD** unless an approved task confirms them.

The Web Doc Final describes some Next.js full-stack capabilities, including Server Actions. Those descriptions are superseded for platform backend responsibilities by the approved separate-repository architecture: NestJS is the authoritative backend, and Next.js is frontend only.

## Product domains

The proposal describes these platform concepts: users/members, applications, events, event registrations, teams, tasks, recommendations, announcements, attendance, roles and permissions, organizational information, and directory communication. It also describes alumni accounts and AI-assisted application evaluation.

These are not a database schema. Entity fields, cardinality, lifecycle states, API routes, permission matrix, and release priority are **TBD** until approved and represented by the Prisma schema, migrations, and API contract.

## Boundaries

- The database is accessed through backend-owned Prisma code, never directly by the frontend.
- The backend must enforce authorization even if the frontend hides an action.
- The games platform is a separately deployed legacy subsystem in the current technical guide. Its future subdomain or route placement, identity integration, and data-sharing contract require an explicit approved decision.
- AI evaluation is an integration point. This backend may send approved input and store approved results, but it must not invent evaluation criteria or replace the responsible committee’s final decision.
