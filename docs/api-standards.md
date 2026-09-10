# API Standards

## Status and intent

Swagger/OpenAPI is the required, authoritative API contract between this NestJS backend and the separate Next.js frontend. The backend must publish and maintain a machine-readable specification and interactive documentation that represent implemented behavior.

The specification delivery URL, versioning convention, documentation access policy, generated-client strategy, error envelope, pagination convention, and publication process are **TBD**. They must be decided without weakening the contract-first rule.

## Contract requirements

Before an endpoint is available to the frontend, document:

| Concern | Required detail |
| --- | --- |
| Operation | HTTP method, path, and purpose |
| Input | DTO, required fields, formats, and validation behavior |
| Output | Success status and response DTO |
| Failure | Expected statuses and error-body shape |
| Access | Authentication and required server-enforced permission |
| Compatibility | Consumer impact and migration plan for breaking changes |
| OpenAPI | Updated operation, schemas, security requirement, and examples where useful |

## Implementation safeguards

- Use DTO validation at the boundary; the technical guide names `class-validator` and `class-transformer` for this role.
- Do not leak secrets, internal stack traces, database errors, or credentials in responses.
- Do not let UI visibility decide access. Controllers/services must enforce server-side authorization.
- Do not fabricate endpoints or response fields to match a frontend mockup.
- Treat generated OpenAPI material as a representation of implemented behavior, not as a substitute for implementation or review.
- Update the OpenAPI contract in the same change as an endpoint, DTO, response, or security-requirement change.
- Do not expose an endpoint for frontend consumption unless its OpenAPI operation documents its behavior and access requirement.

## Items awaiting team confirmation

- API prefix and URL structure;
- API versioning approach;
- Swagger/OpenAPI path and authentication access;
- standard error format;
- pagination/filter/sort format;
- request-id, logging, rate-limit, upload, caching, and idempotency policies;
- generated client or shared-contract approach.
- contract validation in CI and compatibility checks for breaking changes.
- CORS allowlist, rate limits, and the security policy for interactive API documentation.
