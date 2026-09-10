# Backend Testing

## Current status

No test framework, test commands, coverage threshold, test database approach, contract-test tooling, CI workflow, or deployment gate has been confirmed for this separate repository. They are **TBD**.

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

Never use production credentials or production data as a default test target. External-service sandboxing, test secrets, AI-evaluation test fixtures, and cleanup policy are **TBD** and must be agreed before integration tests are introduced.
