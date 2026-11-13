# Backend Local Setup

Run NestJS, PostgreSQL, and pgAdmin on your computer. Each developer has a separate local database and data.

> **Demo data is optional.** Starting Docker applies migrations and installs the 3 roles, 32 skills and 30 permission definitions. It also installs DATA/PR reference committees and eight committee permission rules. It installs two global role_permission links: GROUP_LEADER and GROUP_CO_LEADER each receive members.manage; ADVISOR receives none. API authorization is separate. It does **not** add demo people. After setup, run the [optional seed step](#optional-add-the-local-demo-people) if you want ten demo members, including three fictional DATA positions and examples of all three club roles. This data stays in your local database; it is not shared through Supabase.

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

The current people/membership migration requires a separate empty database. If you already have project records, preserve that database and its volume, and provision a different empty database before starting. Do not delete records, reset the database, or bypass the migration precondition. See [Fresh people/membership setup](docs/database-prisma.md#fresh-peoplemembership-setup).

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

You should see sixteen project tables, plus Prisma’s `_prisma_migrations` history table. Refresh **Tables** if needed. Everyone gets the same structure from the committed migrations. Do not create or change tables manually in pgAdmin.

After pulling backend updates in your backend clone, run `gdg backend run` again to apply any new migrations. Startup does not reset your database. Teammates use `migrate deploy` through startup; only schema authors create new migrations. If your database already contains manually created project tables, stop and ask the schema owner before proceeding; do not reset or baseline it yourself.

To verify the migration, run this from the backend folder:

```bash
docker compose exec -T backend pnpm exec prisma migrate status --config prisma7.config.ts
```

Prisma should report that the database schema is up to date. Fresh setup inserts the three approved role definitions (ADVISOR, GROUP_LEADER, GROUP_CO_LEADER), the 32 approved skill definitions and the 30 approved permission definitions, DATA/PR reference committees, eight committee permission rules and two role_permission links (GROUP_LEADER and GROUP_CO_LEADER each get members.manage); other project tables are empty. Setup does not create accounts, member-role assignments or sample events. For errors or schema changes, see [Database and Prisma](docs/database-prisma.md).

## Optional: Add the local demo people

Skip this section if you want only the tables and reference values. Otherwise, follow these steps from the backend repository:

1. Start the environment with `gdg backend run` and wait until it is healthy.
2. Confirm migrations are up to date with the migration-status command in step 5 above. Resolve any migration failure before seeding.
3. Run the seed explicitly:

```bash
docker compose exec -T backend pnpm seed:dev
```

4. Expect `Local development seed completed.` in the terminal.
5. In pgAdmin, refresh the tables. Right-click a table and choose **View/Edit Data → All Rows** to inspect the rows; leave them unchanged while checking.

On a fresh migrated database, the result is:

| Table | Rows | What to inspect |
| --- | --- | --- |
| `person` | 10 | Names and personal emails |
| `member` | 10 | Nine current members; Mohmmad is alumni |
| `committee` | 6 | DATA and PR reused from migrations; Web/Cyber under Development; PM independent |
| `member_committee` | 11 | Committee memberships and positions |
| `member_role` | 3 | Leen: GROUP_LEADER; Omar: GROUP_CO_LEADER; Rania: ADVISOR |
| `member_skill` | 15 | Three selections per original demo member; the five later examples have none |
| `role` / `skill` | 3 / 32 | Existing migration reference values, reused by the seed |
| `permission` | 30 | Migration reference definitions, unchanged by the seed |
| `role_permission` | 2 | Both club leadership roles have `members.manage`; ADVISOR has none |
| `committee_permission` | 8 | DATA leadership and PR rules installed by migrations; seed leaves them unchanged |

Leen's GROUP_LEADER and Omar's GROUP_CO_LEADER assignments match members.manage through role_permission. Rania's ADVISOR assignment has no permissions. Committee leadership alone does not give a global role. These are policy rows, not working API authorization.

Existing unrelated data is kept, so totals can be larger on a database you already use. `permission`, `role_permission`, `committee_permission` and event tables are unchanged by the optional seed.

| Member | Committee positions | Club role |
| --- | --- | --- |
| Ammar Babaset | Web Leader; PM Member | None |
| Leen Alghamdi | None | `GROUP_LEADER` |
| Abdullah Misar | Development Leader; Web Member | None |
| Mohmmad Alamri | Cyber Member; PR Member | None |
| Sara Alqahtani (fictional) | Web Co-Leader; PM Member | None |
| Noura Demo (fictional) | DATA Leader | None |
| Faisal Demo (fictional) | DATA Co-Leader | None |
| Hala Demo (fictional) | DATA Member | None |
| Omar Demo (fictional) | None | `GROUP_CO_LEADER` |
| Rania Demo (fictional) | None | `ADVISOR` |

Noura, Faisal and Hala are fictional examples with example.test emails. They have no global roles, skill selections or Auth accounts. The seed reuses DATA and PR without changing their IDs or rules. A membership-to-policy join matches events.create/own for the DATA Leader and Co-Leader, matches no rule for the DATA Member, and matches the two PR registration rules for Mohmmad. This is a data relationship check; NestJS must still enforce authentication, scope and event ownership.

Omar Demo (club.coleader@example.test) and Rania Demo (club.advisor@example.test) are fictional current members without committees, skills or Auth accounts. They cover GROUP_CO_LEADER and ADVISOR respectively. If you previously ran the eight-member seed, run the same optional command again: compatible existing rows are reused, and only missing demo records/links are added. No reset is needed.

These are database demo records. They do not create login accounts/passwords or modify permission policy rows, and do not enable dashboard/API features that have not been implemented.

**Run once when you want the demo data.** Stopping/restarting Docker keeps it; pulling code does not add it automatically. Running the command again reuses compatible rows without duplicates or timestamp changes and restores missing expected links while keeping additional data. If you intentionally changed a demo member's position or details, review that change before rerunning: a conflict rolls back the entire seed.

If the command fails:

| Message | Action |
| --- | --- |
| Requires a local PostgreSQL URL / non-production environment | Use the Docker command above with your local environment. Remote hosts and production mode are rejected. |
| `development_seed_conflict_*` | Inspect the affected person, member, committee, position or role in pgAdmin; ask the schema owner to resolve the mismatch. Existing rows are not overwritten. |
| `development_seed_missing_*` | Verify migrations and the role/skill registry, then ask the schema owner to inspect the missing reference. |
| Check migrations and local database availability | Check `gdg backend status`, `gdg backend logs` and migration status before retrying. |

Do not reset the database, remove its Docker volume or delete records to force the seed to succeed. No partial demo fixture is committed on failure.

Host development can use `pnpm seed:dev` after configuring a local DATABASE_URL and applying migrations. The launcher rejects production mode and remote hosts, including Supabase; it accepts loopback and the Compose db hostname. Keep connection credentials private. See [Optional development seed](docs/database-prisma.md#optional-development-seed) for counts, failure codes and isolated tests.

## Daily commands

On later workdays, run `gdg backend run`, work normally, then run `gdg backend stop`. After pulling reviewed backend updates, run `gdg backend run` again to apply pending migrations. Keep your existing `.env` and database volume. The optional seed is a separate action whenever you need the agreed demo fixture again.

| Command | Purpose |
| --- | --- |
| `gdg backend run` | Start the backend environment |
| `gdg backend stop` | Stop it and keep your data |
| `gdg backend status` | Show service status |
| `gdg backend test` | Run lint, type checks, and tests; start the environment first |
| `gdg backend logs` | Follow service logs; press Ctrl+C to exit |
| `docker compose exec -T backend pnpm seed:dev` | Optional: add/recheck the demo fixture; run from the backend folder after startup |

If you see `command not found: gdg`, open a new terminal after running `./gdg install`. If Docker is unavailable, open Docker Desktop, wait until it is running, and retry.

## Optional: Run the frontend too

From the backend folder, download the frontend into the same parent folder:

```bash
cd ..
git clone https://github.com/gdgocdev-maker/gdg-main-platform-frontend.git
gdg run
```

Open [the frontend](http://localhost:3000). Use `gdg stop` to stop all services and keep your data.

## Better Auth and Resend

Apply committed Prisma migrations before starting this backend. Set `BETTER_AUTH_SECRET` to a new random secret (at least 32 characters), `BETTER_AUTH_URL` and `FRONTEND_URL` to the public frontend origin, and retain the existing Google client credentials. Register `https://<frontend-origin>/api/auth/callback/google` in Google OAuth. The frontend proxies `/api/auth/*` unchanged to NestJS; app endpoints strip the outer `/api` prefix. Configure `TRUST_PROXY_HOPS` for the actual trusted proxy chain.

Set `RESEND_API_KEY` privately and `EMAIL_FROM="GDG on Campus UJ <noreply@gdguj.org>"`. The owner reports `gdguj.org` verified in Resend (Tokyo / ap-northeast-1), including DKIM and send/rsend records. Recommended owner DNS addition: TXT `_dmarc` → `v=DMARC1; p=none;`. Sender remains environment-driven. Never commit `.env` or keys. `EMAIL_TEST_TO` is optional and must be an owner-controlled inbox; without it, skip live mail tests.

Supabase URL/service key remain required only for Storage; existing SMTP configuration remains for non-auth event/membership messages. See [migration plan](docs/auth-migration-plan.md) for import, local checks and coordinated cutover.
