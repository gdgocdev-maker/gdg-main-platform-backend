# Database and Prisma

## Start here

For first-time setup, follow [Backend Local Setup](../SETUP.md). Docker provides PostgreSQL, pgAdmin, Node.js and pnpm; teammates do not need host Node.js/pnpm for the Docker workflow below.

The repository currently defines thirteen project tables and twelve registration statuses. `prisma/schema.prisma` defines the models; `prisma/migrations/` contains the versioned SQL, including PostgreSQL checks that Prisma models cannot express. `prisma7.config.ts` points Prisma to both paths. Keep all three in sync when changing the database. Never edit a migration that has already been applied or shared.

Each developer has a separate local database and data. The same committed migrations produce the same structure; they do not copy another developer's records or create Supabase accounts, roles, permissions or sample events. Connecting to the official database later requires a separately reviewed deployment/data-transfer procedure.

## Apply migrations — teammates

Run these commands from the backend clone after pulling the team's merged updates. Preserve your existing `.env`.

```bash
gdg backend run
```

The backend container runs `pnpm prisma:migrate:deploy` before starting NestJS. This applies pending SQL files once, in order, and records their results in `_prisma_migrations`. A repeat run with no new migrations makes no schema changes. Migration failure prevents NestJS startup. The launcher rebuilds/recreates the backend as needed; host watch mode alone does not apply new SQL migrations.

Startup does not reset the database or remove its named volume. Future migrations can still change or remove data if their SQL does so; review them before applying. Do not use `prisma migrate reset`, `prisma db push`, or `docker compose down -v` as routine setup/update steps.

## Verify success

```bash
gdg backend status
docker compose exec -T backend pnpm exec prisma migrate status --config prisma7.config.ts
```

The services should be healthy and Prisma should report that the database schema is up to date. Open `http://localhost:3001`; `Hello World!` confirms NestJS started after migration and its connection check. `migrate status` checks migration history; it does not prove that nobody changed tables manually.

In pgAdmin, expand **GDG Local PostgreSQL → Databases → gdg_platform → Schemas → public → Tables** and refresh **Tables**. Use your `POSTGRES_DB` value if you changed the default database name.

Expect these thirteen project tables, plus `_prisma_migrations`:

| Area | Tables |
| --- | --- |
| Accounts and access | `users`, `roles`, `user_roles`, `permissions`, `role_permissions` |
| Group membership | `member`, `committee`, `member_committee` |
| Events and applications | `events`, `event_questions`, `event_registrations`, `registration_answers` |
| Attendance incidents | `registration_blacklist_entries` |

An empty table is expected on fresh setup. Do not create tables manually or insert privileged accounts to test authentication.

## If migration fails

Run `gdg logs backend` to read the error; press Ctrl+C to stop following logs. Keep `.env` and connection strings private when sharing an error.

| Symptom | Next step |
| --- | --- |
| Connection refused / authentication failed | Check Docker, the database service and your local credentials. Editing `.env` alone does not change an existing PostgreSQL user's password. |
| P3005 / database is not empty | The initial migration expects an empty project schema. If you already created tables manually, stop and ask the schema owner to inspect them and plan preservation/transfer. Do not reset or baseline them yourself. |
| P3009 / a previous migration failed | Stop and ask the schema owner to inspect migration history and the actual database state. Do not delete `_prisma_migrations` or blindly mark a migration applied/rolled back. |
| Backend is healthy but tables are missing in pgAdmin | Refresh **Tables** and verify you opened the same database/server that Docker uses. Then check migration status above. |

The initial migration wraps domain DDL in a transaction. Its tested failure case rolls back tables/enums, but Prisma still records failed migration history. The schema owner must verify rollback before any `migrate resolve --rolled-back` recovery. Future migration failures need their own state inspection; do not assume all changes rolled back.

## Optional host development

Host development requires Node.js >=22.12.0 (`package.json`) and pnpm 12.3.4 (the Docker tooling version). Configure the ignored `.env` with your local host `DATABASE_URL`. Docker uses the internal `db:5432` hostname automatically; host commands use `localhost` and `POSTGRES_PORT` instead.

From the backend folder:

```bash
pnpm install --frozen-lockfile
docker compose stop backend
docker compose up -d db --wait
pnpm prisma:migrate:deploy
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm start:dev
```

The host backend uses port 3001 by default, so stop the Docker backend first. `pnpm prisma:generate` only updates the ignored TypeScript client; it does not create or update PostgreSQL tables.

## Schema authors only

Teammates apply committed files using `migrate deploy`; they do not generate their own migration for the same change.

1. Review the approved requirement, relationships, constraints, indexes and data impact. Edit `prisma/schema.prisma` as needed.
2. Use a separate disposable local authoring database with the existing migration history applied. Point the authoring environment's `DATABASE_URL` to it before running migration commands; never use a shared/official database. Prisma's development command also needs a separate disposable shadow database or local permission to create one.
3. Validate and create a draft using the repository's actual config filename:

   ```bash
   pnpm exec prisma format --schema prisma/schema.prisma
   pnpm exec prisma validate --config prisma7.config.ts
   pnpm exec prisma migrate dev --create-only --name describe_change --config prisma7.config.ts
   ```

   `--create-only` creates a draft instead of applying the new migration, but the development command still connects to databases and may request a reset on drift. Stop if it asks to reset; inspect the mismatch first.
4. Inspect the SQL, including data loss/locking and custom PostgreSQL checks. Do not assume Prisma generates custom CHECK constraints. Update the isolated test fixtures/expectations for the new migration. The current rollback fixture deliberately stops when migration history grows beyond the initial file; extend it before relying on the suite.
5. Run the checks below, review the final diff, and commit the schema, migration and relevant tests/docs together. Keep `.env`, real data and generated client files out of Git. Test and review official deployment separately.

## Isolated verification

With host Node.js/pnpm installed and Docker running, use:

```bash
pnpm check
pnpm build
pnpm test:schema:local
pnpm test:startup:local
pnpm test:performance:local
```

The three `:local` runners create their own disposable PostgreSQL server with random credentials and remove their test resources afterwards. They never use your application database. Schema checks cover integrity, two clean replays, repeat deploy and failure/recovery. Startup checks add the actual container command, HTTP readiness, restart preservation and failure protection. Performance checks add synthetic 100/400/800-registration events and 40,000 historical registrations; these are SQL query measurements, not API traffic guarantees.

For an explicitly provisioned disposable target only, `pnpm test:schema` requires `TEST_DATABASE_URL` pointing to a separate local `gdg_schema_test_*` database with the migrated schema. The command refuses missing/unsafe targets; it does not provision or migrate that database. Prefer the automatic `:local` runner. Normal application e2e skips schema cases when `TEST_DATABASE_URL` is absent.

## NestJS integration and remaining work

`PrismaModule` exports `PrismaService`, using the generated ESM client and `@prisma/adapter-pg`. It reads credentials through `ConfigService`, verifies connectivity with `SELECT 1` on initialization, and disconnects on shutdown. Build/start/typecheck/test commands generate the client automatically.

Storage constraints do not implement server permissions, state transitions, seat locking, QR issuance/scanning or scheduled expiry. Those require later NestJS features and tests. Official hosting, deployment approval, backup/restore and retention procedures remain to be agreed.
