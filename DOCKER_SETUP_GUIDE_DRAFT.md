# Backend Docker and Local Environment Setup — Draft

**Status:** Draft for team-lead review. Do not publish to Notion until approved.

This setup provides a private PostgreSQL 17 database for development and tests. It does not create domain tables, seed data, or a connection to the official database.

## Prerequisites

Install Docker Desktop and wait until Docker is running. Node.js and pnpm are needed only when running backend/Prisma commands directly on the host.

## Start the database

1. Copy `.env.example` to `.env`.
2. Replace `CHANGE_ME` in `POSTGRES_PASSWORD` and `DATABASE_URL` with the same private password. Use letters/numbers or URL-encode the password in the URL.
3. Validate and start:

```bash
docker compose config --quiet
docker compose up -d db --wait
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database();"'
```

Compose creates `POSTGRES_DB` and a PostgreSQL user on the first initialization of the `postgres_data` volume. Changing environment values later does not update credentials or rename an existing database.

## Connection settings

For pgAdmin installed on your computer:

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
docker compose ps db

# Stop and keep data
docker compose stop db

# Start again
docker compose up -d db --wait

# Start the existing backend container when ready
docker compose up --build backend
```

The backend starter returns `Hello World!`; this does not prove a database connection. PrismaModule/PrismaService integration is a separate next step.

PostgreSQL uses its own volume. Existing MySQL data is not transferred or deleted. Do not run volume-deletion commands to perform routine setup.
