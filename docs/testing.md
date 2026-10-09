# Backend Testing

## Current status

The repository uses Vitest. `pnpm check` runs lint, type checking and unit tests; `pnpm build` verifies compilation. `gdg backend test` runs checks and application e2e inside the running backend container. Coverage thresholds, contract-test tooling, CI and production deployment gates remain **TBD**.

For disposable migration, startup and representative SQL checks, follow [Database and Prisma](database-prisma.md#isolated-verification). The automatic runners require host Node.js/pnpm and Docker. They create their own PostgreSQL server and do not use the application database.

## Minimum verification expectation

For every change, run the relevant checks that the actual repository exposes and report only those actually run. Where relevant, verify:

- DTO validation and error handling;
- authentication and server-enforced RBAC behavior;
- both allowed and denied cases for every changed sensitive permission;
- service/domain behavior;
- Prisma queries and migration impact against a safe environment;
- API response compatibility with the published contract;
- OpenAPI specification validation and contract compatibility for changed operations;
- build/type/lint checks;
- regression paths for the affected domain.

## Database and integration safety

Never use production credentials or production data as a default test target. Application e2e reads the configured local database; isolated schema tests use a separate guarded target and clean their fixtures. The automatic migration runners remove their own temporary containers/networks. If Docker becomes unavailable during cleanup, runner-named resources may remain; do not use global prune to remove them. External-service sandboxing, AI-evaluation fixtures and production traffic validation remain **TBD**.
