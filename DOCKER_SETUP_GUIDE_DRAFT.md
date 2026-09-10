# Backend Docker and Local Environment Setup — Draft

**Status:** Draft for team-lead review. Do not publish to Notion until approved.

## Purpose

This guide lets each backend developer run the GDG Main Platform backend and a private MySQL database on their own computer. It does not use a shared, staging, or production database.

## Prerequisites

- Git
- VS Code or another code editor
- Docker Desktop

Open Docker Desktop and wait until it shows that Docker is running before continuing.

> Node.js and pnpm are useful for running project commands directly on your computer. They are not required for the Docker workflow below because the Docker image installs and runs the backend dependencies.

## Start the local environment

Clone the backend repository, open a terminal in the repository root, and run:

```bash
docker compose up --build
```

The first run can take several minutes. Docker will build the NestJS backend image, start MySQL, wait for MySQL to become healthy, and then start the backend in watch mode.

When the logs show `Nest application successfully started`, open:

```text
http://localhost:3001
```

The current root route returns `Hello World!`, which confirms that the backend is reachable.

## Local environment variables

Docker Compose automatically provides the backend with:

- `PORT=3001`
- `FRONTEND_URL=http://localhost:3000`
- a local-only MySQL `DATABASE_URL`

Developers using Docker do **not** need to create a `.env` file or manually enter database credentials. The database runs only in their local Docker environment.

The repository's `.env.example` is only for developers who intentionally run the backend outside Docker. Never commit a `.env` file or real/shared credentials.

## Everyday commands

```bash
# Start after the first build
docker compose up

# Start in the background
docker compose up -d

# View backend logs
docker compose logs -f backend

# View MySQL logs
docker compose logs -f db

# Stop containers and keep local database data
docker compose down

# Intentionally stop containers and delete local database data
docker compose down -v
```

## Important notes

- Source-code changes are watched automatically while Docker is running.
- Do not run `pnpm start:dev` at the same time as Docker Compose; both use port `3001`.
- If port `3001` is already used by another application, stop that application before running Docker Compose.
- `docker compose down` keeps the local MySQL database. Only `docker compose down -v` deletes it.
- This setup does not create seed users, test accounts, or remote database connections.
