# Backend Docker and Local Environment Setup — Draft

**Status:** Draft for team-lead review. Do not publish to Notion until approved.

This setup provides a private PostgreSQL 17 database for development and tests. It does not create domain tables, seed data, or a connection to the official database.

## Prerequisites

Install Docker Desktop and wait until Docker is running. Use Docker Compose 2.23.1+ (required for inline `configs.content`). Node.js and pnpm are needed only when running backend/Prisma commands directly on the host.

## Start PostgreSQL and pgAdmin

1. Copy `.env.example` to `.env`.
2. Replace `CHANGE_ME` in `POSTGRES_PASSWORD` and `DATABASE_URL` with the same private password. Use letters/numbers or URL-encode the password in the URL.
3. Set `PGADMIN_DEFAULT_EMAIL` and a separate private `PGADMIN_DEFAULT_PASSWORD`.
4. Validate and start:

```bash
docker compose config --quiet
docker compose up -d db pgadmin --wait
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database();"'
```

Compose creates `POSTGRES_DB` and a PostgreSQL user on the first initialization of the `postgres_data` volume. Changing environment values later does not update credentials or rename an existing database.

## Open pgAdmin

Open `http://localhost:5050` (or the port in `PGADMIN_PORT`). Sign in using `PGADMIN_DEFAULT_EMAIL` and `PGADMIN_DEFAULT_PASSWORD` from your ignored `.env`.

Expand **Servers → Local development → GDG Local PostgreSQL** and enter `POSTGRES_PASSWORD` when prompted. The server definition is preloaded on first initialization and uses the internal Docker hostname `db` on port `5432`; `localhost` inside the pgAdmin container refers to pgAdmin itself.

Open **Databases → gdg_platform → Schemas → public → Tables** when using the example database name. There are no domain tables yet; committed migrations will create them in the next phase. Do not create or alter shared schema manually in pgAdmin. All developers must pull and apply the same migrations once available.

pgAdmin settings are stored in `pgadmin_data`. The initial login and server definition are imported only on first initialization. Changing `.env` later does not change an existing pgAdmin login; use pgAdmin's account settings to change its password. Update a saved server's connection settings in pgAdmin if database names/users change.

## Desktop pgAdmin connection settings

If using the desktop application instead of the Docker service:

- Host: `127.0.0.1`
- Port: `POSTGRES_PORT` from `.env` (default `5432`)
- Database: `POSTGRES_DB` from `.env`
- Username: `POSTGRES_USER` from `.env`
- Password: `POSTGRES_PASSWORD` from `.env`

Host Prisma commands use `DATABASE_URL`. Compose supplies the backend container with an internal URL using `db:5432`. If port 5432 is occupied, change `POSTGRES_PORT` and the port in the host `DATABASE_URL` together.

Never commit `.env` or credentials. The tracked `.env.example` contains placeholders only. Avoid printing resolved Compose configuration because it includes passwords.

## Everyday commands

```bash
# Check database status
docker compose ps db pgadmin

# Stop and keep data
docker compose stop db pgadmin

# Start again
docker compose up -d db pgadmin --wait

# Start the existing backend container when ready
docker compose up --build backend
```

The backend starter returns `Hello World!`; this does not prove a database connection. PrismaModule/PrismaService integration is a separate next step.

PostgreSQL uses its own volume. Existing MySQL data is not transferred or deleted. Do not run volume-deletion commands to perform routine setup.

## Reference

The container setup uses the official [pgAdmin container deployment documentation](https://www.pgadmin.org/docs/pgadmin4/9.18/container_deployment.html).
