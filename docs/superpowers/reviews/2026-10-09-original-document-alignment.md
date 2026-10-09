# Original Document Alignment — 2026-10-09

Scope: Prisma model definitions, compared directly with GDGoC_Database_Schema.docx, GDG_UJ_Backend_Workflow (1).pdf and the pasted five-person allocation. Documents are source evidence, not permission to deploy or apply DDL. Latest approved user decisions override conflicting legacy requirements. This review does not establish implemented API behavior.

## Source coverage

Re-extracted the original DOCX tables and shading: exactly twelve table headers use green 00B050. All twelve are represented; the blue future-domain tables are outside person 1's assigned schema scope. Compared their column names against Prisma mappings, allowing only the documented password, creator and schedule replacements below. Re-read all eighteen PDF pages and the pasted allocation.

| Original table | Alignment and intentional differences |
| --- | --- |
| users | All source columns retained except password_hash, which the DOCX notes and approved Supabase decision explicitly remove. Add full_name for public accounts and auth_user_id for provider linkage. member_id remains optional and unique, matching the allocation and source one-to-one relationship. |
| roles | Original fields, role-name uniqueness and lengths retained. Exact role seed set remains pending, not silently removed. |
| user_roles | Original fields and UNIQUE(user_id, role_id) retained. |
| permissions | Original fields, uniqueness and lengths retained. Source examples include manage_users; final permission catalog/grants remain pending approval. |
| role_permissions | Original fields and UNIQUE(role_id, permission_id) retained. |
| member | All original fields and lengths retained, including profile_image_url VARCHAR(255). current/alumni are stored using enum maps. Branch value CHECK remains pending migration. |
| committee | Original identity/name/parent fields retained. Add stable committee_code for DATA_ANALYSIS/PR authorization vocabulary; hierarchy seeds remain pending. |
| member_committee | Original association fields retained; role is represented by a Prisma enum mapped to Leader/Co-Leader/Coordinator/Member source labels. Add association uniqueness and lookup index. |
| events | Keep source information and image_url VARCHAR(255). Replace organizer_id → member with created_by → users following PDF sections 10–12 and person 3's allocation. Replace event_date/event_time with starts_at/ends_at instants to support the approved scan window and multi-day events. Add admin confirmation window and updated_at. Source event status strings remain lowercase in PostgreSQL. |
| event_questions | Original fields retained. Add ordered position and JSONB options because the original choice types require choices; map enum values to text/select/radio/checkbox. |
| registration_answers | Original fields and TEXT answer storage retained. Add event_id for two composite FKs that reject cross-event answers, plus unique registration/question. Checkbox JSON-in-TEXT is the reviewed storage convention, not a published API contract. |
| event_registrations | All original review/confirmation/waitlist fields retained. Use the latest twelve states instead of conflicting legacy examples. Add cancellation/excuse/QR/check-in fields, preserving UNIQUE(event_id, user_id). |
| registration_blacklist_entries | Additional thirteenth table supports approved informational warnings, incident uniqueness and independent excuse resolution. Owner is obtained through registration; no duplicated blacklist boolean. |

Original VARCHAR question/committee-role fields become restricted enums using the documented values. Missing NOT NULL/default/delete rules in source documents are not proof of an existing database contract: the reviewed schema makes active-workflow references required, applies explicit deletion rules, uses integer autoincrement keys and TIMESTAMPTZ(3), and Prisma-managed updated_at. These are physical-design choices, not original literal DDL. In particular committee_id is nullable in the DOCX but required here because events are created in a committee scope; draft schedule/capacity/deadline are required by the reviewed minimal model. No official database DDL/data has been supplied; later integration needs a compatibility review.

## Corrections made by this review

- Restored member.profile_image_url and events.image_url from TEXT to original VARCHAR(255); no approved requirement justified widening them.
- Added enum @map values for original event/member/question/committee-role vocabulary. Prisma symbols stay uppercase, while stored values follow source labels. The new registration states stay uppercase as approved. Incidental spaces in DOCX enum examples are trimmed.
- Updated the design documentation to match these corrections. No live data needs conversion because no migration has been applied.

## Workflow coverage and remaining work

Schema supports committee-scoped authorization, authenticated event creator, published-event queries, user registrations and answers, review, ordered waitlist, deadlines and attendance history. It does not enforce PR/leader permissions, question freeze, capacity, confirmation/cancellation cutoffs, job behavior or email delivery; these require backend code/tests. Public signup must not create membership/MEMBER grants despite the older PDF signup example.

Preserve the original allocation's pagination, name/email search, registrant answers, status filters and statistics. List projections may omit sensitive QR credentials and load answers in one batch for the current page or a detail view; they must not silently remove PR's access to answers. At 100–400 registrations/event, measure a bounded event-scoped name/email search before adding a text-search index.

The allocation already authorizes PR to remove/reorder waitlist entries. The state assigned on PR removal is unspecified; this is not the same as voluntary DECLINED. Do not say the removal capability itself is undecided, infer a terminal state, or implement a guessed transition. The latest user-approved NOT_SELECTED cleanup covers WAITLISTED only; forgotten PENDING cleanup remains undefined.

Role/permission/committee/test-member seeds, general error/response handling and later setup migration integration remain assigned work, not completed by these model definitions. No PASSWORD_SETUP_REQUIRED logic may be derived from a removed local password hash; the auth owner must adapt it to Supabase.

## Verification

Prisma format/validate, offline generated-DDL checks for source URL lengths/enums plus structural FK/uniqueness checks; all original green-table column names accounted for with explicit replacement exceptions. pnpm check (lint, TypeScript, one unit test), pnpm build and git diff --check passed. These checks do not execute constraints in PostgreSQL. Migration CHECK constraints, integration tests, query-plan and traffic tests remain pending. No migration, commit or push performed.
