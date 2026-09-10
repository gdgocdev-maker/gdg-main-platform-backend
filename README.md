# GDG Main Platform Backend

The authoritative backend for the Google Developer Groups on Campus - University of Jeddah Unified Community Platform.

This repository is separate from the frontend. It owns the NestJS API, server-side authentication and RBAC enforcement, domain logic, Prisma data access, and MySQL persistence. The Next.js repository consumes this API and is frontend only.

## Status

This is an initial documentation package. Application source code, repository URL, schema, migrations, environment templates, API specification URL, Docker configuration, CI, deployment configuration, and release process are **TBD**.

## Approved technical direction

| Area | Direction |
| --- | --- |
| Backend framework | NestJS on Node.js with TypeScript |
| Database | MySQL |
| ORM and migrations | Prisma |
| Authentication direction | NestJS authentication, JWT/token-based auth, Google OAuth |
| Authorization | RBAC, enforced by backend |
| API contract | Swagger/OpenAPI, published and maintained by backend |
| Validation tooling named in guide | `class-validator` and `class-transformer` |
| Local backend address in the technical guide | `http://localhost:3001` |
| Node.js | LTS, version 20 or newer per the technical guide |

## Documentation

- [Architecture](docs/architecture.md)
- [Decision and source governance](docs/decision-governance.md)
- [Development workflow](docs/development-workflow.md)
- [API standards](docs/api-standards.md)
- [Authentication and RBAC](docs/authentication-rbac.md)
- [Database and Prisma](docs/database-prisma.md)
- [Testing](docs/testing.md)

## Getting started

The technical guide describes this expected local workflow once application code and `package.json` exist:

1. Install Node.js LTS (20+), Git, and a code editor; provision a local MySQL server or approved database access.
2. Clone this repository and run `npm install`.
3. Create `.env` from the approved environment template. `DATABASE_URL`, `FRONTEND_URL`, JWT, and Google OAuth configuration are expected categories; actual values are **TBD** and must not be committed.
4. Generate Prisma client and apply development migrations using the confirmed repository workflow. The guide uses `npx prisma generate` and `npx prisma migrate dev`.
5. Run the confirmed development command. The guide uses `npm run start:dev` and expects `http://localhost:3001`.

Do not add or assume scripts, Docker files, environment values, or the OpenAPI publication route until they are implemented and reviewed in this repository. Swagger/OpenAPI itself is required as the API contract.

## Product scope at a glance

The product proposal describes a unified platform for membership, applications, events and registrations, teams, tasks, announcements, recommendations, attendance, organizational information, member communication, and AI-assisted application review. These are product concepts, not an implemented schema or API guarantee.

## Sources

- [Unified Community Platform proposal](../../sources/GDG_منصة_موحدة.pdf) - product vision, roles, flows, and proposed capabilities.
- [Web Doc Final](../../sources/Web%20Doc%20Final.pdf) - technical stack and initial local setup guidance.
- Approved Notion tasks - task-scoped requirements and acceptance criteria; link the exact task in the relevant issue, PR, or decision record.

The paths above are reference links for the documentation package. Copy the two source files to the organization’s agreed documentation location, or replace these links, when this package is placed in its final repository.
