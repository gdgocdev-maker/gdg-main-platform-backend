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

Backend developers: start with the short [setup guide](SETUP.md), covering Docker, `gdg install`, local environment variables, and pgAdmin.

Start with the local database only:

1. Install and start Docker Desktop.
2. Copy `.env.example` to `.env`. Replace `CHANGE_ME` in `POSTGRES_PASSWORD` and `DATABASE_URL` with the same private, URL-safe password. Choose a separate private `PGADMIN_DEFAULT_PASSWORD`. Never commit `.env`.
3. Run `docker compose config --quiet` to validate the configuration without printing credentials.
4. Run `docker compose up -d db pgadmin --wait`.
5. Run `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database();"'` to verify the database.

PostgreSQL is available on `127.0.0.1:5432` by default. Open pgAdmin at `http://localhost:5050` and log in using `PGADMIN_DEFAULT_EMAIL` and `PGADMIN_DEFAULT_PASSWORD` from `.env`. The `GDG Local PostgreSQL` server is preloaded; expand it and enter `POSTGRES_PASSWORD` to connect. Inside Docker it uses `db:5432`. If port 5432 is occupied, change `POSTGRES_PORT` and the port in `DATABASE_URL` together.

`docker compose stop db pgadmin` stops both services and keeps their data. Database models/migrations are subsequent steps. NestJS now imports `PrismaModule` and connects using `PrismaService`. The existing backend container starts with `docker compose up --build backend`; startup now executes `SELECT 1` through Prisma and fails if PostgreSQL is unavailable.

See the [setup guide](SETUP.md) for step-by-step instructions.

## Run the full local platform

Clone the backend and frontend repositories into sibling folders:

```text
workspace/
  gdg-main-platform-backend/
  gdg-main-platform-frontend/
```

From the backend repository:

```bash
./gdg run                 # All four services
./gdg frontend run        # Frontend only
./gdg backend run         # Backend + PostgreSQL + pgAdmin
./gdg stop                # Stop all, keep data
./gdg frontend stop       # Stop frontend only
./gdg backend stop        # Stop backend + PostgreSQL + pgAdmin
./gdg status
./gdg test
```

`run` builds/starts four separate containers in one Compose project: PostgreSQL, pgAdmin, NestJS, and Next.js. It waits for HTTP/database readiness, keeps database/settings volumes, and refreshes dependency/build-cache volumes from the images. Source changes are watched through bind mounts. Docker Desktop (Compose 2.23.1+) and a POSIX shell (macOS/Linux or Git Bash/WSL) are required; host Node.js/pnpm are not required.

When `.env` is absent, the launcher creates it privately with random PostgreSQL and pgAdmin passwords. Existing `.env` files and database credentials are preserved. If your older `.env` lacks pgAdmin settings, copy their names from `.env.example` and set private values before running.

URLs: frontend `http://localhost:3000`, backend `http://localhost:3001`, pgAdmin `http://localhost:5050` by default. pgAdmin login details are in `.env`. Stop any host dev servers using ports 3000/3001 before starting Docker. Existing product pages still require real API implementation; launching both repos does not implement their API integration.

Each team member installs the command once from their backend clone:

```bash
./gdg install
```

Open a new terminal, then use `gdg run`, `gdg stop`, `gdg frontend run`, or `gdg backend run` from any directory. The installer creates `~/.local/bin/gdg` as a link to this clone and adds its directory to the zsh/bash startup configuration. It preserves any different existing command and does not duplicate its PATH entry on repeated installation. Keep the clone at the installed location. No `sudo` or global Node.js package installation is required.

To use it immediately in the current terminal:

```bash
export PATH="$HOME/.local/bin:$PATH"
gdg status
```

Use `gdg logs backend` (or `frontend`, `db`, `pgadmin`) to inspect service logs. `gdg test` runs backend checks/integration tests and frontend lint/type checks in their containers. Use `gdg backend test` or `gdg frontend test` to check only one side; start the selected services first. The launcher itself can be checked with `sh test/gdg.test.sh` (no running Docker required).

Frontend-only mode uses `--no-deps` and does not start the backend/database. API-dependent pages still require the backend. Backend-only mode does not require a frontend clone.

For a different frontend location, export `FRONTEND_PATH` before running `./gdg run`; the default sibling path needs no configuration. Backend-only developers can continue using `docker compose up -d --build backend` without the frontend clone.

## Prisma connection and checks

`PrismaModule` exports `PrismaService`. Import the module into each feature module that needs database access, then inject `PrismaService` into its service. It reads `DATABASE_URL`, uses the PostgreSQL adapter, verifies connectivity on initialization, and disconnects on shutdown. `main.ts` enables NestJS shutdown hooks.

For host development:

If the backend Docker container is running, stop it first with `docker compose stop backend` to free port `3001`. Keep the database running.

```bash
pnpm install --frozen-lockfile
docker compose up -d db --wait
pnpm start:dev
```

Build/start/typecheck/test scripts generate the Prisma client automatically using `prisma7.config.ts`. Generated files stay ignored. After changing the schema, `pnpm prisma:generate` regenerates the client without applying migrations.

```bash
pnpm check
pnpm test:e2e
pnpm build
```

E2E tests require the local PostgreSQL database and `.env`. They verify the root response, a real SQL query, startup rejection for an unreachable database, and connection cleanup on application close. They do not create tables or modify project data.

## Product scope at a glance

The product proposal describes a unified platform for membership, applications, events and registrations, teams, tasks, announcements, recommendations, attendance, organizational information, member communication, and AI-assisted application review. These are product concepts, not an implemented schema or API guarantee.

## Sources

- [Unified Community Platform proposal](../../sources/GDG_منصة_موحدة.pdf) - product vision, roles, flows, and proposed capabilities.
- [Web Doc Final](../../sources/Web%20Doc%20Final.pdf) - technical stack and initial local setup guidance.
- Approved Notion tasks - task-scoped requirements and acceptance criteria; link the exact task in the relevant issue, PR, or decision record.

The paths above are reference links for the documentation package. Copy the two source files to the organization’s agreed documentation location, or replace these links, when this package is placed in its final repository.
