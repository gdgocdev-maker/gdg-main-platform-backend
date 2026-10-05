# GDG Main Platform Backend

The authoritative backend for the Google Developer Groups on Campus - University of Jeddah Unified Community Platform.

This repository is separate from the frontend. It owns the NestJS API, server-side authentication and RBAC enforcement, domain logic, Prisma data access, and PostgreSQL persistence. The Next.js repository consumes this API and is frontend only.

## Status

NestJS starter code, Docker configuration, and an empty Prisma schema are present. Local development/testing now uses PostgreSQL. Domain tables, migrations, seed data, and API contracts are not implemented yet.

## Approved technical direction

| Area | Direction |
| --- | --- |
| Backend framework | NestJS on Node.js with TypeScript |
| Database | PostgreSQL |
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

Start with the local database only:

1. Install and start Docker Desktop.
2. Copy `.env.example` to `.env`. Replace `CHANGE_ME` in `POSTGRES_PASSWORD` and `DATABASE_URL` with the same private, URL-safe password. Choose a separate private `PGADMIN_DEFAULT_PASSWORD`. Never commit `.env`.
3. Run `docker compose config --quiet` to validate the configuration without printing credentials.
4. Run `docker compose up -d db pgadmin --wait`.
5. Run `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database();"'` to verify the database.

PostgreSQL is available on `127.0.0.1:5432` by default. Open pgAdmin at `http://localhost:5050` and log in using `PGADMIN_DEFAULT_EMAIL` and `PGADMIN_DEFAULT_PASSWORD` from `.env`. The `GDG Local PostgreSQL` server is preloaded; expand it and enter `POSTGRES_PASSWORD` to connect. Inside Docker it uses `db:5432`. If port 5432 is occupied, change `POSTGRES_PORT` and the port in `DATABASE_URL` together.

`docker compose stop db pgadmin` stops both services and keeps their data. Database models/migrations and the NestJS Prisma connection service are subsequent steps. The existing backend container starts with `docker compose up --build backend`; application startup alone does not prove database connectivity.

See [local Docker setup](DOCKER_SETUP_GUIDE_DRAFT.md) for details.

## Product scope at a glance

The product proposal describes a unified platform for membership, applications, events and registrations, teams, tasks, announcements, recommendations, attendance, organizational information, member communication, and AI-assisted application review. These are product concepts, not an implemented schema or API guarantee.

## Sources

- [Unified Community Platform proposal](../../sources/GDG_منصة_موحدة.pdf) - product vision, roles, flows, and proposed capabilities.
- [Web Doc Final](../../sources/Web%20Doc%20Final.pdf) - technical stack and initial local setup guidance.
- Approved Notion tasks - task-scoped requirements and acceptance criteria; link the exact task in the relevant issue, PR, or decision record.

The paths above are reference links for the documentation package. Copy the two source files to the organization’s agreed documentation location, or replace these links, when this package is placed in its final repository.
