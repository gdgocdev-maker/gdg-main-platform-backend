# Backend Development Workflow

## Before implementation

1. Identify the approved product outcome, exact Notion task, linked decision, affected domain, access control, and data impact.
2. Inspect the existing NestJS modules, API contract, Prisma schema, migrations, and tests once source code exists.
3. Record any unknown request fields, lifecycle rule, permission, external integration behavior, or acceptance criterion as `TBD`.
4. Coordinate contract changes that affect the separate frontend before implementing incompatible behavior.

## During implementation

- Keep controllers, services, DTO validation, authorization, and persistence responsibilities clear according to NestJS conventions established in the repository.
- Validate external input at the API boundary.
- Enforce roles and permissions on the server for every protected action.
- Use Prisma schema changes and migrations for persistent data changes; never modify a deployed database manually as a substitute for a reviewed migration.
- Keep secrets out of source code, logs, error responses, and commits.
- Keep product decision-making outside code when its criteria or owner are not approved; label the dependency `TBD`.

## Before handoff

1. Run available checks relevant to the change: lint, type check, tests, build, API checks, and/or migration validation as supported by the repository. Exact commands are **TBD** until project configuration exists.
2. Update and validate the Swagger/OpenAPI contract; assess compatibility and communicate any frontend action required.
3. Document API, auth/RBAC, schema, migration, and environment impacts.
4. Report checks actually run and unresolved `TBD` items.

## Local development baseline

The technical guide uses `npm run start:dev` for the backend and `http://localhost:3001` as its local address. It also shows `npx prisma generate` and `npx prisma migrate dev`. Treat these as initial guidance; the final commands and ports are governed by the actual repository configuration once created.

Branch naming, commits, PRs, review ownership, CI, Docker workflow, Swagger route, release process, and deployment process are **TBD** and intentionally not invented here.
