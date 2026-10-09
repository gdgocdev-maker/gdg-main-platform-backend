# Backend Local Setup

Run NestJS, PostgreSQL, and pgAdmin on your computer. Each developer has a separate local database and data.

## 1. Install the tools

- Install [Docker Desktop](https://docs.docker.com/get-started/get-docker/) for your computer. Open it and wait until Docker is running. Use Docker Compose 2.23.1 or newer.
- Install [Git](https://git-scm.com/downloads/). Use VS Code to open the project and edit code.
- Run the commands below in a zsh or bash terminal. On Windows, use WSL with Docker Desktop WSL Integration enabled.

Docker provides PostgreSQL, pgAdmin, and Node.js for this setup, so you do not need to install them separately.

## 2. Download the backend and install the shortcut

Open a terminal in the folder where you want to keep the project, then run:

```bash
git clone https://github.com/gdgocdev-maker/gdg-main-platform-backend.git
cd gdg-main-platform-backend
./gdg install
```

Run `./gdg install` once per computer. Then close the terminal, open a new one, and return to your `gdg-main-platform-backend` folder. Keep the project at this location so the installed shortcut continues to work.

## 3. Create your .env file

From the backend folder, run this once on a fresh clone:

```bash
cp .env.example .env
chmod 600 .env
```

`chmod 600` allows only your user account to read and edit this file.

If `.env` already exists, keep it and skip these commands.

Open `.env` in your editor before starting Docker:

1. Replace `CHANGE_ME` in `POSTGRES_PASSWORD` with your own local password. Use letters and numbers so it works directly in the connection URL.
2. Replace `CHANGE_ME` in `DATABASE_URL` with the same password.
3. Replace `CHANGE_ME` in `PGADMIN_DEFAULT_PASSWORD` with a separate password for pgAdmin. You can also change `PGADMIN_DEFAULT_EMAIL`.
4. Save the file. Keep the other default values for the initial setup.

Use these values when connecting:

| Variable | Used for |
| --- | --- |
| `PGADMIN_DEFAULT_EMAIL` | pgAdmin browser login email |
| `PGADMIN_DEFAULT_PASSWORD` | pgAdmin browser login password |
| `POSTGRES_PASSWORD` | PostgreSQL database connection password |
| `DATABASE_URL` | Backend connection when running outside Docker; Docker configures the internal backend connection automatically |

When entering credentials in pgAdmin, copy only the value after `=`, without quotation marks. Never upload `.env` or passwords to GitHub. Editing a password in `.env` alone does not update an existing database password or pgAdmin account.

## 4. Start the backend environment

```bash
gdg backend run
```

Wait until the services show `Healthy`. The first run may take several minutes to download images and dependencies.

This starts the backend, database, and pgAdmin. Open [the backend](http://localhost:3001). `Hello World!` means the app started successfully. Startup applies the committed migrations before starting NestJS and checks the database connection. If migration fails, the backend does not start; inspect `gdg logs backend`.

## 5. Open pgAdmin and connect

1. Open [http://localhost:5050](http://localhost:5050).
2. Log in with the pgAdmin email and password from `.env`.
3. Expand **Servers → Local development → GDG Local PostgreSQL**.
4. If prompted for the server password, enter the value of `POSTGRES_PASSWORD` from `.env`, not the variable name or the pgAdmin login password.
5. Expand **Databases → gdg_platform → Schemas → public → Tables**.

The browser version already includes the server connection. If you use the desktop pgAdmin app, register a server with host `127.0.0.1`, port `5432`, database `gdg_platform`, username `gdg_local`, and the value of `POSTGRES_PASSWORD` as the password.

You should see thirteen project tables, plus Prisma’s `_prisma_migrations` history table. Refresh **Tables** if needed. Everyone gets the same structure from the committed migrations. Do not create or change tables manually in pgAdmin.

After pulling backend updates in your backend clone, run `gdg backend run` again to apply any new migrations. Startup does not reset your database. Teammates use `migrate deploy` through startup; only schema authors create new migrations. If your database already contains manually created project tables, stop and ask the schema owner before proceeding; do not reset or baseline it yourself.

To verify the migration, run this from the backend folder:

```bash
docker compose exec -T backend pnpm exec prisma migrate status --config prisma7.config.ts
```

Prisma should report that the database schema is up to date. Fresh tables are empty; setup does not create accounts or sample events. For errors or schema changes, see [Database and Prisma](docs/database-prisma.md).

## Daily commands

| Command | Purpose |
| --- | --- |
| `gdg backend run` | Start the backend environment |
| `gdg backend stop` | Stop it and keep your data |
| `gdg backend status` | Show service status |
| `gdg backend test` | Run lint, type checks, and tests; start the environment first |
| `gdg backend logs` | Follow service logs; press Ctrl+C to exit |

If you see `command not found: gdg`, open a new terminal after running `./gdg install`. If Docker is unavailable, open Docker Desktop, wait until it is running, and retry.

## Optional: Run the frontend too

From the backend folder, download the frontend into the same parent folder:

```bash
cd ..
git clone https://github.com/gdgocdev-maker/gdg-main-platform-frontend.git
gdg run
```

Open [the frontend](http://localhost:3000). Use `gdg stop` to stop all services and keep your data.
