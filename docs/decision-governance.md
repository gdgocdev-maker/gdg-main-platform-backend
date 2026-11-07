# Decision and Source Governance

## Purpose

This document prevents product, technical, and task sources from being silently mixed or overridden. It applies to all backend changes.

## Terminology

GDG on Campus UJ is a **group**, not a club. Use “group” in documentation and participant-facing copy, as clarified by the user on 2026-10-07. Membership means group membership.

## Source Authority by Domain

- **Approved decisions** define the current accepted direction only when they explicitly supersede an older decision or document. Record material architecture and product decisions here.
- **Notion tasks** define the requirements and Definition of Done for the assigned task. They do not define unrelated architecture or current implementation details unless explicitly approved as a decision.
- **Swagger/OpenAPI** defines the current frontend-backend API contract: routes, methods, request and response schemas, authentication requirements, documented errors, and compatibility expectations.
- **Repository code, tests, configuration, Prisma schema, and committed migrations** define current implemented behavior. If implementation materially differs from documentation, report the discrepancy; do not silently reconcile it.
- **Unified Platform Proposal** defines original product intent, platform goals, major product domains, and high-level user journeys. It is not a source for current low-level implementation details.
- **Web Doc Final** defines the approved technical baseline unless a later approved decision explicitly supersedes it. The current baseline is Next.js, React, TypeScript, Tailwind CSS, Framer Motion, and GSAP for frontend; NestJS, Node.js, and TypeScript for backend; MySQL and Prisma for persistence; NestJS Auth, JWT, Google OAuth, and RBAC for authentication and authorization; and Swagger/OpenAPI for the API contract.

## Conflict handling

Do not silently choose one source when sources conflict. First identify the conflict's domain, then apply the authority for that domain. If documented authority cannot resolve it, mark it `TBD` and request team clarification. Record material architecture or product decisions here. Do not change product behavior merely to make sources appear consistent.

## Current binding decisions

| Decision | Status |
| --- | --- |
| Frontend and backend are separate repositories | Approved |
| Next.js is frontend only | Approved |
| NestJS is the authoritative backend | Approved |
| Local development/testing uses PostgreSQL and Prisma | Approved by user on 2026-10-05; supersedes the local MySQL baseline |
| Authentication uses NestJS Auth, JWT, Google OAuth, and backend-enforced RBAC | Approved direction |
| Swagger/OpenAPI is the authoritative frontend-backend contract | Approved |
| Personal email/password are the only signup/login credentials; optional university email is unverified profile data | Approved by user on 2026-10-27 |

## Decision record minimum

Each new decision should record: date, owner/approver, status, context, decision, affected repositories, source links, and migration or rollback implications. Link the exact Notion task for task-scoped work.

## 2026-11-06 Public membership number and owner-controlled Wallet links

- The project user approved a fixed numeric membership number issued by the platform and shared by the ID and Profile passes for the same member. PostgreSQL assigns it from 100001 to existing and new members. The current internal `memberId` remains the key for existing platform APIs. Sequence values may have gaps.
- A link references an existing owner-verified Wallet record for a pass pair. One person may have links for multiple committees. A committee-scoped link requires an existing membership in that committee. Group-wide links use a null committee and are excluded from committee routes. The owner verifies each match before it is entered. Barcode aliases retain only the lowercase SHA-256 digest of the exact existing payload.
- [The phase-one API](wallet-membership-openapi.yaml) returns the number and link status to active Leaders and Co-Leaders in the specified committee. There is no platform mutation endpoint for link provisioning or pass issuance. The owner retains pass files, download URLs, signing, and issuance. Actual owner-approved mappings and presentation of the number on passes are later integration steps.
- The backend migration adds data without renumbering existing internal IDs. An application rollback can retain the additive schema. Do not drop or reset issued membership numbers when rolling back the application.

## 2026-11-06 Event attendance and Wallet projection

- The project user approved keeping the existing seat-confirmation step. New member confirmations use the member's existing card barcode. Guests receive a per-registration QR. Existing confirmed registrations keep their existing QR and have a null attendance method.
- PR registration staff may requeue the latest failed email. The decision and barcode are retained. Registration email intents are committed with their decisions and no recipient addresses or raw QR payloads are duplicated in the delivery table.
- A published event's schedule can be edited by its authorized committee staff. A new start must be set before the event starts. Outstanding offer deadlines are capped at the new start. Updates take the same event lock as confirmations and check-ins.
- Wallet projections use the owner-issued field and committee grants on the existing integration API. Both connection variables are required. Each verified link has independent opt-in flags for Next Event and points, defaulting to false. Enabling a flag delegates that field to the platform for that link. Leave it off for manually managed fields. A queued update is reconciled on a later poll after the owner's worker finishes it.
- Production requires verified card mappings, scoped credentials and activation of the guest relay. For confirmed guests, Wallet publishes the temporary pass and GDG emails its link and attendance QR using its existing mail service. GDG retains the recipient address and tracks delivery.
- The signing worker runs as a private process in the owner's existing CranL app. It uses durable private storage and scoped publication credentials. The GDG backend uses separate credentials for approved member updates and guest requests.

## Legacy-source clarification

Web Doc Final describes some Next.js full-stack capabilities, including Server Actions. For this platform's backend responsibilities, that guidance is superseded by the approved separate-repository architecture: Next.js is frontend only and NestJS is authoritative.

## 2026-10-27 Personal email verification and university email

- Owner/approver: project user in this chat.
- Status: approved.
- Decision: the required personal email and password identify the account. Verify only the personal email. An unverified account that submits the correct password at login receives a resent personal-email verification code and is sent to code entry. University email is optional profile information only; do not verify it or use it as a login identity. If supplied, it must differ from the personal email, ignoring surrounding whitespace and letter case. Do not enforce university-email uniqueness across accounts.
- Affected repositories: frontend and backend.
- Migration implications: remove university-email uniqueness while preserving personal-email uniqueness; existing university identity rows may remain but must not be treated as login identities. Do not change historical applied migrations.
- Source: explicit user instruction in the current chat on 2026-10-27.

## 2026-10-05 Local PostgreSQL development

- Owner/approver: project user in the current Codex chat.
- Status: approved for local development and testing.
- Context: backend developers need a shared schema on private local databases before the Database committee provides the official PostgreSQL database.
- Decision: use local PostgreSQL, pgAdmin for inspection, and committed Prisma schema/migrations for reproducible setup. Keep credentials in ignored `.env` files.
- Affected repository: backend; frontend continues to consume the NestJS API.
- Source: user's local-database instructions and authorization to begin setup in this chat; no external source URL supplied.
- Migration/rollback: the current Prisma schema contains no models or migrations. Use a separate PostgreSQL Docker volume; do not delete or transfer any existing MySQL data. Official database migration/transfer remains a later coordinated task.

## 2026-10-05 Supabase authentication ownership

- Owner/approver: project user in the current Codex chat.
- Status: approved direction; implementation remains pending.
- Decision: Supabase Auth owns credentials. NestJS verifies provider identity and enforces local roles, permissions, membership, and committee scope. Do not store password hashes in local users.
- Source: user explicitly stated “اعتمد الsupabase auth” during the schema review.
- Schema implication: proposed nullable unique users.auth_user_id UUID links pre-existing local records to provider identities. No cross-database foreign key is assumed.
- Supersedes: the supplied workflow's local password-hash ownership; the first-login invitation/reset workflow must be adapted with the auth owner before implementation.
- Migration/rollback: no auth columns or migrations have been applied. No existing accounts or passwords are transferred by this decision.

## 2026-10-05 PR registration scope and QR attendance

- Owner/approver: project user in the current Codex chat.
- Status: approved workflow direction; schema implementation pending.
- Source: supplied Backend Workflow sections 19–20, clarified by the user; the user's subsequent QR attendance requirements.
- Decision: authorized PR staff see events requiring registration management without a separate event-assignment step. Event ownership/editing remains a separate authorization rule.
- QR decision: acceptance precedes confirmation; issue the registration-specific secure QR only after user confirmation, show the same QR in the platform and confirmation email, and permit a single backend-validated check-in by authorized staff.
- Schema impact: plan token identity and check-in metadata tied to registrations, including non-member registrations; no event-to-PR assignment table. No personal data in the QR.
- Migration/rollback: no schema or migration has been applied; exact token storage and check-in lifecycle constraints remain proposed in the design review.

## 2026-10-07 Registration lifecycle approval

- Owner/approver: project user in this chat; explicit approval: “ok done, take the approve”.
- Status: approved behavior; implementation pending.
- Decision: use the original eleven categorized registration statuses (superseded by the 2026-10-09 update below) documented in the core database design. DECLINED includes voluntary waitlist withdrawal; remaining waitlisted users become NOT_SELECTED at event start, without a warning or later promotion.
- Confirmation: authorized admin sets the event window (default 24 hours); existing approval deadlines remain unchanged when it is edited.
- Cancellation: at least two hours before start uses CANCELLED; cancellation within the final two hours uses LATE_CANCELLATION. LATE_CANCELLATION creates an incident warning visible to PR, without blocking registration.
- Excuse: PR may set EXCUSED and resolve the corresponding incident warning while preserving history; other unresolved warnings remain visible.
- Source: subsequent user clarifications/approval in this chat supersede the original registration-state allocation. Full transition rules and remaining event-time edge cases are recorded in the core design document.
- Migration/rollback: documentation only; no migration, seed, or database operation performed. Warning storage expands the original 12-table core and remains a proposed schema detail.

## 2026-10-07 Full registration and attendance decision approval

- Owner/approver: project user; explicit “approved” annotation on the full decision summary.
- Status: approved business behavior; implementation pending.
- Decision: new confirmation deadlines are capped at event start; admin window edits affect future approvals only. The initial PENDING/WAITLISTED cleanup proposal is superseded by the 2026-10-09 transition contract below.
- Check-in: opens one hour before start and closes at event end. CONFIRMED with no recorded check-in at end creates a NO_CHECK_IN blacklist incident; actual attendance remains separate from registration status.
- Questions: questions/options cannot be changed or deleted after the first registration.
- Blacklist (superseded by 2026-11-05): LATE_CANCELLATION and NO_CHECK_IN create informational incidents, never registration blocks. A missed-confirmation cancellation releases its seat and promotes the waitlist without a blacklist incident.
- Scope: all other approved authentication, group membership, PR scope, capacity, QR, cancellation, waitlist remain in force; the status set is superseded by the 2026-10-09 update below. See the core database design's Full business decision approval section.
- Source/precedence: the user's approved full summary supersedes older open questions about these workflows; it does not approve unspecified physical-schema or cryptographic choices.
- Migration/rollback: documentation only; no code, schema, database migration, commit, push or deployment performed by this approval-recording task.

## 2026-10-09 Twelve-status schema planning update

- Owner/approver: project user; latest approved status and Reject Remaining clarifications in this chat.
- Status: approved workflow; schema/migration implementation pending.
- Status set: PENDING, WAITLISTED, AWAITING_CONFIRMATION, CONFIRMED, DECLINED, CANCELLED, LATE_CANCELLATION, NOT_SELECTED, REJECTED, EXPIRED, NO_CHECK_IN, EXCUSED. Default PENDING.
- EXPIRED: historical status for missed confirmation deadlines. New missed deadlines cancel the unconfirmed offer, release the seat, and promote the waitlist without a blacklist incident (updated 2026-11-05).
- NO_CHECK_IN: confirmed user with no recorded scan at event end transitions from CONFIRMED to NO_CHECK_IN; create a blacklist incident and preserve confirmation history. This supersedes leaving the registration CONFIRMED after missing check-in.
- Selection: explicit Reject Remaining changes only PENDING to REJECTED. At event start, remaining WAITLISTED become NOT_SELECTED without a warning. This supersedes automatic PENDING-to-NOT_SELECTED cleanup; no new rule is inferred for forgotten PENDING applications.
- Attendance: successful check-in keeps CONFIRMED and sets checked_in_at/checked_in_by. PR may excuse an incident without deleting history or releasing a seat twice.
- Affected repository: backend design and decision documentation; no API or database migration applied.
- Source: user's approvals and request to update the plan with twelve statuses. Exact transitions are in the core design's Current transition contract section.


## 2026-10-09 Physical schema implementation proposal

- Status: proposed for review, not a new approved business decision or applied schema.
- Context: translate the approved twelve-status workflow into reproducible migrations.
- Proposal: thirteen tables including registration-linked blacklist history; required starts_at/ends_at instants support multi-day camps; canonical unique login email; JSONB choice options and JSON-encoded checkbox answers. Exact columns, constraints and mapping are in the core database design.
- Execution checklist: [Database Schema Migrations Implementation Plan](superpowers/plans/2026-10-09-database-schema-migrations.md). Permission seeds and feature endpoints remain separate.
- Migration/rollback: planning only. Future verification uses dedicated disposable databases, preserving the active developer database and Docker volumes.

## 2026-10-15 Fresh local people and membership schema

- Owner/approver: project user in this chat; explicitly requested a fresh start with no links between old/new records and authorized the next implementation stage.
- Status: approved direction for local development/testing; this does not authorize a production deployment or commit without the separate stage confirmation.
- Decision: implement person/member/committee/member_committee directly from the documented DBA release 2.3 shape, excluding Coordinator. No backfill, inferred identity matching, or temporary legacy identity bridges.
- Migration: preserve the initial committed migration. A new transactional migration must lock all thirteen initial project tables and reject any populated table before changing their structure. Use a separate empty database; do not delete or reset an existing application database.
- Dependencies: participant registrations reference Person; creators/reviewers/check-in/excuse/resolution actors reference Member. Remove User/UserRole; role assignments land as member_role in Stage C, while the existing role/permission registries remain temporarily unchanged.
- Source: the user's fresh-start clarification and authorization in this chat; target columns are recorded in the English people/membership plan and sourced from the DBA release 2.3 structure PDF, with SQL 2.2 as supporting evidence only.
- Remaining limits: the official Supabase auth FK, RLS/guards/audit, views, permissions and other event/incident structures are not verified or claimed complete here. Existing populated databases are rejected and preserved, not automatically upgraded.
- Supersedes: the original people/membership expansion/backfill proposal and User/Member proposal where they conflict with this fresh-start scope.

## 2026-10-15 Role registry and initial values approval

- Owner/approver: project user in this chat; explicitly approved implementing role with ADVISOR, GROUP_LEADER and GROUP_CO_LEADER.
- Scope: role_code text primary key, optional description, is_privileged default true; initial descriptions are Club advisor, Club (group) leader and Club (group) co-leader. All three approved values have is_privileged=true. These are initial definitions, not member assignments or automatic authorization.
- Necessary dependency: change only the role side of existing role_permissions from numeric role_id to role_code, keeping numeric permission IDs and the current link table until the separately approved permission step. Referenced roles cannot be deleted.
- Preservation: new transactional migration rejects populated old roles or role_permissions before DDL, without transferring or deleting their records. Other tables are preserved. Earlier migrations are unchanged.
- Approval does not cover permission seeds/distribution, member_role, skills, deployment, commit, push or PR. Production data is reference evidence only; the repository remains the implementation authority.

## 2026-10-15 Member-role assignment table approval

- Owner/approver: project user explicitly approved member_role without initial assignments.
- Scope: the eight columns from the approved people/membership contract: id, member_id, role_code, starts_on, ends_on, assigned_by, notes and created_at. Dates, assigner and notes remain optional; no new required-start or inferred assignment rule is introduced.
- Constraints: one open-ended assignment per member/role (ends_on IS NULL), repeated ended history allowed, end not before start when both exist, required recipient/role FKs and optional assigning-member FK with delete RESTRICT/update NO ACTION.
- Migration is additive and transactional; preserve existing people, memberships, roles and permissions, with no seed assignments, transfers or changes to earlier migrations.
- Does not approve authorization endpoints, automatic expiry, permission distribution, skills, deployment or commit. Commit requires separate user confirmation.

## 2026-10-15 Skill registry and production reference values approval

- Owner/approver: project user explicitly approved skill with the 32 production values reviewed in this chat, without linking any members.
- Scope: skill_id integer BY DEFAULT identity primary key and skill_name required unique varchar(255). Preserve the reviewed reference IDs 1–32 and their exact names as initial definitions. Automatic IDs start at 1000, matching the supporting SQL 2.2 and observed Supabase identity definition; explicit reference IDs do not advance this sequence.
- Source: the user-approved production snapshot is embedded in the new local migration and asserted by test/fixtures/approved-skills.json. Production remains read-only reference evidence, not an automatic synchronization source or implementation authority.
- Preservation: additive transactional migration, no changes to prior records or migrations, no member_skill table/links, no inferred personal data or assignments. No extra name normalization or domain constraints beyond the approved shape.
- Commit requires separate confirmation. Member linking, permission redesign, APIs, Supabase deployment, push and PR remain outside this authorization.

## 2026-10-15 Member-skill junction approval and conditional commit

- Owner/approver: project user approved the reviewed three-column member_skill design and explicitly requested a commit if the implementation is good. This authorizes implementing this step and committing after passing verification and review, without a further approval question.
- Scope: generated integer identity id, required member_id and skill_id, unique member/skill pair, delete RESTRICT/update NO ACTION FKs and a skill lookup index. Start empty, with no initial member selections or proficiency fields.
- Preservation: additive transactional migration, unchanged earlier migrations and existing data. Removing a link does not remove its member or skill; referenced members/skills cannot be deleted until unlinked.
- Commit is authorized for this step only. Selection APIs, authorization, permission redesign, deployment, push and PR remain outside scope.

## 2026-10-15 Permission registry design acceptance

- Owner/approver: project user accepted the reviewed five-column permission design in this chat after discussing its suitability.
- Scope: code text primary key, required description/scope, optional grant_permission self-reference, is_sensitive default false. Scope is global/event/committee; codes contain one literal dot between lowercase/underscore segments. Grant references use delete/update NO ACTION.
- Necessary dependency: replace numeric permission_id with code in the existing role_permissions link, retaining its surrogate ID/plural name until that table's separate step. Preserve unique pairs and restrictive deletion; no permission definitions or distribution are implicitly approved by accepting the table.
- New migration locks and rejects either populated old permission table before any DDL; no backfill, inferred matching or deletion of old records. Earlier migrations and unrelated rows remain unchanged.
- Commit requires separate user confirmation. Permission seeds/distribution, final role_permission shape, authorization enforcement, deployment, push and PR are outside this step.

## 2026-10-15 Final role-permission table approval

- Owner/approver: project user explicitly approved role_permission without initial links, requesting test results before any commit.
- Scope: required role_code and code text columns, composite primary key, no surrogate ID, delete RESTRICT/update NO ACTION FKs and retained reverse code lookup index. No permission definitions or distribution is approved by this structural change.
- Preservation: lock/reject a populated legacy role_permissions table before renaming it and dropping its unused ID. No data transfer, row deletion, inferred links or seed assignments. Other data and earlier migrations remain unchanged.
- Verification is isolated. Commit requires separate confirmation; authorization enforcement, permission seeds/distribution, deployment, push and PR remain outside scope.

## 2026-10-15 Optional local development seed approval

- Owner/approver: project user supplied four people and their email/committee/global-role details, delegated a fictional fifth person and skill selection, accepted mixed current/alumni examples with the club leader current, confirmed Web/Cyber under Development with PM/PR independent, and explicitly approved the English seed plan for implementation and tests before commit.
- Scope: optional pnpm seed:dev command, 5 people/members, 5 committees, 8 committee memberships, 1 GROUP_LEADER assignment and 15 selections from the approved skill registry. The exact fixture is recorded in the local seed plan; Mohmmad is the alumni example and Sara the fictional fifth member. No extra global roles are inferred from committee leadership.
- Separate from migrations and Docker startup. Local loopback/Compose-db targets only, non-production mode, one transaction, generated IDs, compatible-row reuse and conflict rejection. Preserve unrelated records, optional details and additional links; never reset/delete or overwrite conflicts.
- No Supabase data transfer, Auth accounts, password seeding, outgoing messages, permission definitions/distribution, event fixtures or automatic startup seeding. These demo records do not implement login/authorization.
- Commit requires separate user confirmation after verification results. Push, PR and deployment remain unauthorized.

## 2026-10-16 Shared HTTP response envelope approval

- Owner/approver: project user explicitly approved the displayed response shape and requested an English implementation plan with phases and tests before execution.
- Contract: JSON API responses use success/message/data/error. Success has success=true and error=null; failure has success=false, data=null and error={code,details}. Details is always an array; only DTO validation adds pointer/message entries. Real HTTP statuses remain authoritative.
- Public error messages come from the reviewed catalog; no raw exception/SQL/token/input values are exposed. Existing root text/readiness behavior and bodyless responses are preserved. Authentication/authorization decisions remain with their owner.
- Source: [Approved design](superpowers/specs/2026-10-16-api-error-handling-design.md); [implementation plan](superpowers/plans/2026-10-16-api-error-handling.md). This decision supersedes the earlier unapproved Problem Details proposal for this task.
- After reviewing the split plan, the user authorized Phase 1A only: envelope types, success helper, owned validation metadata, tests and documentation, with results before commit. Global error-filter implementation/activation and shared validation remain pending. Commits, push, PR and deployment require separate authorization. No schema, migration, seed, frontend or authentication change is approved here.

- After reviewing Phase 1A results, the user explicitly authorized its commit on 2026-10-16 and requested an explanation of Phase 1B before implementation. The user subsequently authorized Phase 1B implementation and tests with results before commit. Phase 1C activation, further commits, push, PR and deployment require separate authorization.

- After reviewing Phase 1B results, the user authorized its commit on 2026-10-16 and requested the Phase 1C explanation before implementation. That commit/explanation request did not authorize Phase 1C runtime work, push, PR or deployment.

- The user subsequently authorized Phase 1C implementation/tests with results before commit: register the tested filter through APP_FILTER in AppModule, verify real HTTP behavior with PrismaService replaced before compilation, and document the active error contract. DTO validation, final compatibility/startup verification and any commit/push/PR/deployment remain separate steps.

- After reviewing Phase 1C results and global filter registration, the user authorized its commit on 2026-10-16 and requested the Phase 2 explanation. Phase 2 execution, further commits, push, PR and deployment require separate authorization.

- The user reviewed the Phase 2 split and authorized 2A implementation/tests with results before commit: convert class-validator errors into pointer/message details with stable ordering, private metadata omission and input preservation. Shared pipe construction (2B), global validation (2C), commits, push, PR and deployment remain separate steps.

- After reviewing Phase 2A results, the user authorized its commit on 2026-10-16 and requested the Phase 2B explanation before implementation. Phase 2B execution, further commits, push, PR and deployment require separate authorization.

- The user subsequently authorized Phase 2B implementation/tests with results before commit: build the shared validation pipe using the reviewed settings and existing owned factory/converter, and verify direct test-only DTO validation. AppModule registration/global validation (2C), commits, push, PR and deployment remain separate steps.

- After reviewing Phase 2B results, the user authorized its commit on 2026-10-16 and requested the Phase 2C explanation before implementation. Phase 2C execution, further commits, push, PR and deployment require separate authorization.

- After the Phase 2C explanation and discussion of frontend/backend validation responsibilities, the user asked to complete the current task. This authorizes Phase 2C implementation/tests: register APP_PIPE with the reviewed ApiValidationPipe, verify decorated test-only DTO requests through the real AppModule without database access, and document the active validation policy. Standing results-before-commit approval remains in force; Phase 3, commit, push, PR and deployment remain separate steps.

- After reviewing Phase 2C results, the user authorized its commit on 2026-10-16 and requested the Phase 3 explanation before implementation. Phase 3 execution, further commits, push, PR and deployment require separate authorization.

- The user subsequently authorized Phase 3 implementation, tests and review, with results before commit: complete success/status/bodyless HTTP compatibility assertions, contributor documentation, a disposable Docker startup regression and an independent read-only review of the HTTP feature. This delivery introduces no runtime component, business endpoint, authentication policy, Swagger installation or database change. Commit, push, PR, merge and deployment remain separately authorized actions.

- Phase 3 verification completed locally on 2026-10-16: 130 focused HTTP tests, 153 unit/helper tests via pnpm check, build/format/diff checks and one isolated Docker startup regression passed. The startup runner verified two clean schema replays, preservation/recovery guards, schema/application e2e, readiness after migrations, restart data preservation and fail-closed incompatible-schema startup; its temporary resources were removed. Independent read-only review found no actionable issues. See the [verification record](superpowers/plans/2026-10-16-api-error-handling.md#phase-3-compatibility-documentation-and-final-verification). The existing database PR #4 remains open/unmerged; integration is separate. Results are ready for user review before any Phase 3 commit.

- After reviewing Phase 3 results, the user authorized its commit on 2026-10-16 and requested the next-step explanation and a comparison against the supplied backend team assignments (Person 1). This does not authorize the next implementation phase, push, PR, merge or deployment.

## 2026-10-16 Permission reference definitions approval

- Owner/approver: project user approved adding the 30 displayed production permission definitions locally, without linking them to roles, and requested implementation/tests with results before commit.
- Scope: preserve exact code, description, scope, grant_permission and is_sensitive metadata from the approved production snapshot. One additive transactional Prisma migration; no schema/model changes, old migration edits, role_permission/member_role inserts or authorization enforcement. Scopes: 19 global, 8 event, 3 committee; 6 sensitive definitions and 4 grant references.
- Existing-code collisions fail atomically, including identical rows, instead of overwriting or silently accepting local definitions. Preserve unrelated permissions, existing links and all other data. Reference definitions are installed by migrations; the optional local people seed remains separate.
- Production was rechecked read-only and matched the approved snapshot. No Supabase deployment/data mutation, production role-link transfer, push, PR or commit is authorized. Commit requires separate confirmation after verification results. This supersedes only the earlier unapproved permission-definition list; permission distribution remains undecided.
- Plan: [Permission reference values](superpowers/plans/2026-10-16-permission-reference-values.md).
- Verification completed locally: two clean 140-test schema replays, 144 combined schema/application e2e tests, optional-seed preservation, identical/conflicting collision rollback, upgrade preservation and latest-migration failure/recovery passed. `pnpm check` passed 153 unit/helper tests plus lint/TypeScript; build/formatter/diff checks passed. Independent read-only review found no actionable issues. No configured application/Supabase database was changed, and no commit/push occurred. Results await user review.
- After reviewing the permission-reference results, the user authorized committing this delivery on 2026-10-16 and requested a proposed role_permission mapping against the team tasks before any implementation. This authorizes the reference-definition commit only; role links, authorization policy changes, push, PR and deployment remain unapproved.

## 2026-10-16 Committee permission registry and DATA examples approval

- Owner/approver: project user approved the displayed six-column committee_permission structure, eight DATA/PR rules and local DATA reference, then explicitly requested optional DATA Leader/Co-Leader/Member demo memberships and tests. Results must be shown before a separately authorized commit.
- Rules: DATA Leader/Co-Leader -> events.create/own; PR Leader/Co-Leader/Member -> registrants.view/all and registrations.review/all. Every rule has include_sub_committees=false and a resolved non-NULL local committee ID. No global role_permission links are approved.
- Necessary prerequisite: PR existed only in the optional people seed. To make all eight approved rules available on normal fresh migration replay, install missing DATA/Data and PR/Public Relations root references; reuse compatible code/name/parent definitions and their existing IDs, and fail atomically on conflicts without overwriting existing data. No production IDs are copied.
- Structure: BY DEFAULT identity id; nullable committee_id; required committee_role/code/applies_to; include_sub_committees default false; restrictive FKs; allowed roles/scopes; NULL committee requires own; COALESCE-based uniqueness as observed in production. Normal lookup/FK indexes are added locally. Prisma model/relations and SQL CHECK/expression-index documentation stay aligned.
- Optional examples: Noura Demo/data.leader@example.test, Faisal Demo/data.coleader@example.test and Hala Demo/data.member@example.test, all current, mapped to DATA Leader/Co-Leader/Member respectively. No Auth accounts, global roles or added skill selections. Preserve the original five people and their links. Migrations add no people; optional seed never runs automatically.
- Scope remains data structure/policy metadata and isolated verification only. The prior approved PR workflow requires no per-event assignment; DATA event ownership remains separate. NestJS authorization stays with its owner. Supabase, configured application databases, old migrations and unrelated work remain untouched; commit/push/PR/deployment are not authorized.
- Plan: [Committee permissions](superpowers/plans/2026-10-16-committee-permissions.md).
- Verification completed locally: final two clean 166-test schema replays, 170 schema/application e2e cases, 153 unit/helper tests with lint/TypeScript, build, Prisma validation, formatting and diff checks passed. Optional seed exact graph/reuse/rollback and membership-to-policy joins passed, including Docker execution and unchanged restart data. Migration conflicts/missing references and injected rollback/recovery passed. Review found and verified a performance-fixture ID fix; representative query-plan checks passed. Minor skill-count documentation was corrected. No remote/configured application database changes or commit/push occurred; results await review.
- After reviewing the committee_permission and optional-seed results, the user authorized committing this delivery on 2026-10-16 and requested a Person 1 task-completion review. Global role-permission distribution, further fixture additions, push, PR, merge and deployment remain separately authorized actions.

## 2026-10-16 Club-role permission distribution approval

- Owner/approver: project user explicitly approved two role_permission links, GROUP_LEADER -> members.manage and GROUP_CO_LEADER -> members.manage, leaving ADVISOR without initial permissions. Implementation and tests are authorized; results must be shown before a separately approved commit.
- This supersedes the earlier empty initial role_permission policy only for these two pairs. Add one transactional data migration; preserve the schema, all earlier migrations, unrelated links and other records. Duplicate pairs fail atomically rather than silently accepting or overwriting local policy. Missing references fail through existing foreign keys.
- members.manage covers members, committees and non-leader committee positions; it does not authorize leadership appointments. No global event, PR review, sensitive-data, account or temporary-grant permissions are added. Existing DATA/PR rules and event ownership requirements remain unchanged.
- No new member-role assignments or demo people are approved here. The optional seed preserves policy and its existing Leen assignment matches members.manage. is_privileged does not imply additional permissions. Actual NestJS authorization remains separate work with the authentication owner.
- Verification uses disposable PostgreSQL only. No configured application/Supabase database updates, commit, push, PR, merge or deployment are authorized by this approval.
- Verification completed locally: RED failed the new policy expectations before the new migration; GREEN passed two clean replays with 167 schema tests each and 171 combined schema/application e2e cases. Optional seed graph/preservation and the Leen policy join passed; both duplicate-pair cases, missing references, upgrade preservation, injected migration rollback/recovery and repeat-deploy no-op passed. pnpm check passed 153 unit/helper tests plus lint/TypeScript; build, Prisma validation, changed test/fixture formatting and diff checks passed. Final diff review found no further issues. The schema and all earlier migrations are unchanged; protected unrelated files retain their hashes. Temporary test resources were removed. Docker backend startup and performance scenarios were not rerun for this data-only change. No commit or external database change occurred; results await user review.
- After reviewing the results, the user authorized committing this role_permission phase on 2026-10-16 and requested a Person 1 remaining-task review. This does not authorize additional fixture members, push, PR, merge or deployment.

## 2026-10-16 Optional club-role demo members approval

- Owner/approver: project user approved adding one fictional GROUP_CO_LEADER member and one fictional ADVISOR member to the optional local seed, with assistant-selected data. Tests and results must be shown before a separate commit approval.
- Fixture: Omar Demo / club.coleader@example.test / current / GROUP_CO_LEADER and Rania Demo / club.advisor@example.test / current / ADVISOR. Both have no committee positions or skills, and NULL auth_user_id with no login accounts. Reuse the existing seed transaction, advisory lock, matching and conflict behavior; no new seed command or startup behavior.
- The optional fixture now contains ten people/members and three global role assignments; six committees, eleven committee memberships and fifteen skill selections remain unchanged. Existing records and timestamps must be preserved when extending the previous eight-member fixture or re-running the seed.
- Existing policy is unchanged: GROUP_LEADER/GROUP_CO_LEADER each match members.manage; ADVISOR has no initial permissions. No migration/schema/policy changes, external writes, commit, push, PR, merge or deployment are approved in this step. Verification uses only runner-owned disposable databases.
- Verification completed locally: the expanded fixture expectation failed before the new SQL rows were added. Final optional-seed checks passed exact ten-member/three-role metadata, both members.manage joins, empty ADVISOR permissions, extension of the prior eight-member fixture without changing existing rows/timestamps, repeat/no-op, missing-role checks for all three roles and full rollback on a conflicting advisor. The email-order assertion was made explicitly case-insensitive. The combined disposable runner passed two clean 167-test schema replays, 171 schema/application e2e cases, migration preservation/recovery, Docker seed execution, migration-before-readiness, unchanged restart data and incompatible-schema startup rejection. pnpm check passed 153 unit/helper tests plus lint/TypeScript; build, changed runner formatting and diff checks passed. Final diff review found no further issues. Schema/migrations/launcher and protected unrelated files are unchanged; temporary resources were removed. No configured application/Supabase database change or commit occurred; results await user review.
- After reviewing these results, the user authorized committing the optional club-role demo members on 2026-10-16 and requested a Person 1 remaining-task review. No further implementation, push, PR, merge or deployment is authorized by this approval.

## 2026-10-16 Backend handoff and pull request approval

- Owner/approver: after final review and isolated verification, the user requested PRs to main for their backend branches and explicitly excluded frontend work.
- Scope: commit the backend setup/architecture/auth/workflow documentation corrections and handoff review; publish the four pending feature branches; reuse the existing database PR to main and avoid duplicate PRs for previously merged branches. All PR bases are main, with their shared history and review order documented.
- No frontend changes, PR merges, production/Supabase operations or unrelated files are authorized. The untracked member proposal and frontend package lock remain preserved.


## 2026-11-04 Committee and group leadership assignment

- Owner/approver: project user in this chat.
- Status: approved implementation requirement.
- Decision: committee Leaders and Co-Leaders in CONTENT, PM, PR, DMD, DATA, CYBER, ROBOTICS, WEB, AUTOMATION, and AI may add existing platform accounts as Members to their own committee only. The sole overall Developer Committees Leader may assign existing accounts as Member, Leader, or Co-Leader to any of the six child committees under DEV, and may review developer leader applications; there is no overall Developer Committees Co-Leader role. Group Leaders and Co-Leaders may assign existing accounts as Member, Leader, or Co-Leader to any leaf committee, or assign the global ADVISOR or DEVELOPER_COMMITTEES_LEADER role. Assignment is by the account's personal login email; no account/person is created from an email address.
- A non-member account is promoted to a Member record only when an authorized assignment is made. A person without an existing authenticated platform account cannot be assigned.
- Affected repositories: backend and frontend.
- Migration implications: add developer_committees.members.assign to the existing DEVELOPER_COMMITTEES_LEADER role only; no overall Developer Committees Co-Leader role is created. No existing rows are rewritten.
- Source: explicit user instruction in this chat on 2026-11-04.

## 2026-11-05 Registration blacklist reasons

- Owner/approver: project user in this chat.
- Status: approved implementation requirement.
- Decision: the blacklist has exactly two incident reasons: a confirmed attendee without a check-in after the event ends, and a confirmed attendee who cancels within two hours before event start. An accepted attendee who misses the confirmation deadline is cancelled, receives no blacklist incident, releases the seat, and allows the next waitlisted person to be promoted.
- Scope: the confirmation deadline and expiry behavior remain in place; only its blacklist incident is removed. The existing late-cancellation and no-check-in rules remain unchanged.
- Migration: remove legacy CONFIRMATION_EXPIRED blacklist rows and narrow the database enum. Do not apply the migration to any database as part of this change.

### Wallet data ownership and outbound guest relay

GDG owns member records, committee assignments, the original points ledger, and workshop registration decisions. The Wallet backend keeps scoped change requests, the applied card values, signed passes, and delivery evidence. The Wallet service receives requests over HTTPS and does not connect to the GDG database. The GDG points ledger remains the source of truth for the absolute total projected per committee.

Use the stable numeric membership number and the exact committee to find the GDG record. Store a separate explicit link to the existing Wallet ID and Profile pair. The numeric number is an identifier. API credentials and server-side authorization enforce permissions. A person can have one stable number and multiple scoped Wallet links. Existing members and points are preserved when a link is saved.

The GDG backend can submit a confirmed guest's issuance or schedule change to the owner's relay, using a dedicated credential and an allowlist. The signer processes the request from the Wallet backend and can continue after the GDG server disconnects. The registration's authoritative decision remains in GDG. See [outbound guest relay API](wallet-guest-relay-openapi.yaml).
