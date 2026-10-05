# Database and Prisma

## Approved direction

Use PostgreSQL for local development and tests, with Prisma as the ORM/migration layer, following the user decision recorded in `decision-governance.md`. The official database connection and schema/data transfer will be coordinated when it is ready.

## Source of truth

Once implementation begins:

1. The committed Prisma schema defines the intended implemented model.
2. Committed migrations define how the schema evolves.
3. The deployed database is changed only through approved, environment-appropriate migration procedures.

The product proposal’s entity list is conceptual. It mentions users/members, applications, events, event registrations, teams, tasks, recommendations, announcements, attendance, roles/permissions, and related profile data. It does not define a final schema.

## Schema and migration safeguards

- Model relationships, constraints, enums, indexes, retention, and lifecycle states only from approved requirements.
- Review data and API impact before a schema change.
- Commit reviewed migrations with the matching schema change.
- Do not manually edit production data or schema to substitute for a migration.
- Do not run destructive migrations or production migration commands without explicit approval and confirmed target environment.
- Use non-production data for local development and tests. Test-data strategy is **TBD**.

## Environment configuration

The local PostgreSQL `DATABASE_URL` shape is:

```text
postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME?schema=public
```

Real connection values are secrets. They must stay in ignored local/deployment environment configuration, never in source code, documentation examples, logs, or commits.

## TBD

Database naming conventions, schema layout, seed policy, migration-review process, backup/restore, retention, data classification, production access, and database hosting configuration are **TBD**.
