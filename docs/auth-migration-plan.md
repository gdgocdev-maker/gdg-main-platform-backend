# Better Auth and Resend migration

Status: implementation and local validation complete, including Compose and independent review; deployment prerequisites below. Coordinated owner-approved cutover is still required.

## Source and base verification (2026-11-13)

Fetched all remotes with prune in both repositories and inspected remote branches ordered by commit date and all open PRs (none). Backend base: `origin/main`, `193ae5669bfc4258b21ec36246a72a45b4a97ead` (merged PR #62). Frontend base: `origin/main`, `15c68e2914f5de63fb1c8ac73486dedf3a068d5a` (merged PR #133). There is no dev/staging integration branch. Backend `origin/feat/wallet-integration` has a newer wallet-only commit `f1e4948`, but is six main commits behind and one ahead; it is not the integration line. Both migration branches start at current main. No push or PR is authorized.

The user's migration instruction supersedes the older Supabase credential-ownership decision. NestJS remains authoritative; Next.js remains a frontend/proxy. Existing membership approval policy is unchanged.

## Pre-migration auth inventory (audited before implementation)

| Location | Current dependency / migration requirement |
| --- | --- |
| `src/auth/auth.service.ts` | Supabase password sign-in/sign-up, refresh, logout, Google token exchange and verified identity checks, recovery/invitation, password updates, OTP verification/resend, admin account deletion. Contains staged signup and membership finalization logic which must be retained. Also contains legacy HMAC verification challenges and SMTP fallback. |
| `src/auth/auth.controller.ts` | Auth endpoints and `gdg_access`/`gdg_refresh` cookies, both legacy and proxy paths. Replace token exchange and cookie lifecycle with Better Auth; preserve profile endpoints and application envelope. |
| `src/auth/token-verifier.service.ts` | Supabase JWKS/issuer/audience validation and recovery AMR. Retire for browser auth; Better Auth opaque database sessions replace JWTs. |
| `src/auth/auth.guard.ts` | Global optional identity, token revocation, CSRF origin check, maps auth UUID to active Person/Member. Keep mapping and all downstream role/committee enforcement; verify Better Auth session server-side. |
| `src/auth/auth-rate-limit.guard.ts` | PostgreSQL limits with HMAC key derived from Supabase service secret. Switch key to Better Auth secret, retaining atomic limits for application routes. Better Auth endpoints also need persistent rate limiting. |
| `src/membership-requests/verified-supabase-email.guard.ts` | Bearer-only provider email verification. Replace with cookie session and verified-user check. |
| `src/common/email/smtp-email.service.ts` | Shared nodemailer transport. Auth must use Resend; retain non-auth mail callers unless explicitly migrated. |
| `prisma/schema.prisma` | `Person.authUserId` nullable unique UUID; staged SignupVerification and legacy PendingSignup/EmailVerificationChallenge; revoked tokens and rate buckets. Preserve UUID links, Person/Member IDs, applications and permission tables. |
| `frontend/lib/auth/supabase-browser.ts` | PKCE browser client used only for Google OAuth. Replace with Better Auth client. |
| `frontend/components/auth/GoogleAuthButton.tsx`, `app/[locale]/(auth)/auth/callback/page.tsx`, `signup/complete/GoogleSignupCompletion.tsx` | Supabase OAuth start, code exchange, temporary token handoff and local sign-out. Switch to server cookie session and existing profile completion. |
| Frontend login/signup/verify/reset components | Call backend auth APIs; preserve bilingual UI and staged application fields while replacing credential operations. |
| `frontend/lib/api/client.ts`, `lib/auth/session.ts` | Refresh retry, logout and sessionStorage authenticated hint. Use Better Auth session lifecycle; browser hints never authorize. |
| `frontend/proxy.ts`, `next.config.ts` | next-intl routing and `/api` rewrite stripping prefix. Keep proxy; add session-aware navigation without replacing backend authorization. |
| `supabase/`, `local-auth/`, `scripts/supabase-test.mjs`, auth tests | Local Supabase tooling and legacy tests. Retain storage tooling; replace auth tests and document obsolete auth-only commands. |

Repository SQL search found no `auth.uid()` policies, no FK to `auth.users`, and no auth.users-to-person synchronization triggers. Person provisioning occurs in AuthService. Existing triggers update timestamps and protect Wallet membership numbers. This finding covers committed SQL only; the owner must inspect deployed Supabase policies/triggers before cutover. Do not claim deployed policy parity without that inspection.

## Supabase usage that stays

`src/committee-dashboard/committee-event-image-storage.service.ts` uses Supabase Storage with the backend service key. Keep its SDK dependency, bucket, upload/delete behavior, URL and storage credentials. Prisma/Postgres remains the database, including any hosted Supabase Postgres deployment. Do not drop schemas, tables, policies, buckets or existing migration history. Frontend Supabase SDK can be removed once all OAuth calls are replaced.

## Target design

Use current stable Better Auth (npm latest inspected: 1.7.23), Prisma 7 adapter and existing PrismaService. Mount the Node handler on NestJS before body parsing. Use same-origin Next.js proxy: public `/api/auth/*` routes reach NestJS `/api/auth/*`. Public auth base URL is the frontend origin plus `/api/auth`; exact trusted frontend origins only. HttpOnly, Secure in production, SameSite=Lax cookies support OAuth callback navigation. No frontend database or auth authority. Retire Supabase sessions at cutover and require fresh login.

Create separate Better Auth User, Account, Session and Verification tables. IDs are UUID strings and imported users retain Supabase IDs. Person remains application authority, linked by authUserId; role, membership, committee scope, deactivation and approval checks remain unchanged. Never copy roles from OAuth metadata. Persist locale (en/ar); treat locale as presentation data only.

Enable verified email/password, Google, password reset, and verified email change. Keep Google client variable names found in environment examples. Restrict automatic linking to verified Google email and established identity IDs; reject conflicting mappings rather than overwriting Person links. Do not enable unused magic-link sign-in. Preserve staged profile choices and finalize only after verified identity; no direct sign-up path may grant memberships or roles.

One Resend SDK service uses `RESEND_API_KEY` and `EMAIL_FROM`; render escaped bilingual HTML plus plain text for verification, reset, welcome and email-change notifications, with email links replacing the former OTP UI; no unused OTP or magic-link sign-in is enabled. Reuse frontend GDG logo and Google palette, accessible CTA and RTL Arabic. Local tests inject a recording transport; never send to real addresses. Do not silently report success on failed delivery.

## Existing-account import

Implement a local-only, default-dry-run importer for owner-exported auth.users and auth.identities. Never connect to production from this workflow. Validate UUIDs, normalized email uniqueness, duplicate provider IDs, person links, unsupported identities and hash formats before a transactional import. Preserve source user UUID, verified timestamps, locale, bcrypt credential hash and Google `sub` as provider accountId. Do not import sessions, refresh tokens or OAuth access/refresh tokens. Reject banned/deleted source accounts for explicit owner reconciliation before import. Report counts without emails, hashes or tokens. Reruns must not overwrite passwords changed after import or attach conflicting users.

Password verification accepts imported bcrypt (including Supabase `$2a$`/`$2b$` variants); new/reset passwords use Better Auth's default hashing. Rehash only after successful verification, with compare-and-swap against the original hash. Test login with imported hashes, wrong passwords, repeated import and conflicts. Existing local unlinked people require proven email ownership before linking; never attach by an untrusted submitted email.

## Rollout and acceptance

1. Apply additive Prisma migration to isolated local Postgres; seed only synthetic accounts.
2. Validate signup → verify → login; reset single-use/expiry and session revocation; mocked Google callback/state/linking; role/deactivation guards; import idempotence and bcrypt login.
3. Run lint, typecheck, tests and build in both repos. The frontend routing tests run through `pnpm test`.
4. Run Compose locally, browser-test bilingual auth, save auth-page and email HTML/PNG screenshots.
5. Commit both branches locally. No push, PR or production migration. Live mail is limited to the subsequently authorized owner inbox test.
6. Owner supplies Resend key and verified sender domain, Better Auth secret, public frontend origin, existing Google client credentials and new callback allowlist; provides approved auth export and deployed RLS/trigger inventory. Agree maintenance window, backups, pending-signup handling and coordinated frontend/backend release. Existing reset links and sessions expire at cutover; provide resend path. Keep Supabase auth data until rollback window closes.

Environment observation: Node 26.13.0 is available; pnpm and Docker are absent from PATH and standard Docker Desktop/Homebrew paths. Package installs are being attempted through pinned `npx pnpm`; Docker/Compose validation remains outstanding.

## Final implementation and verification

Better Auth 1.7.23 owns credentials, verification, password reset, Google accounts and database sessions. Native endpoints mount before Nest body parsing. Application signup/profile endpoints use `/account/*`. Prisma migrations add auth tables and persistent rate limits without removing application or Supabase data. Existing roles, active-person checks and membership approvals remain authoritative. Nodemailer remains only for non-auth notifications; obsolete JWT/Passport dependencies and Supabase token verifier are removed.

Frontend uses the Better Auth client and same-origin proxy; no credential tokens enter browser storage. EN/AR verification and recovery screens preserve the existing design. Seven existing event page exports now wrap their shared component, fixing Next.js invalid page-prop build errors.

Checks on the migration worktree:
- Backend lint and typecheck pass; Nest build passes when run sequentially after Prisma generation. Unit suite: 266/266 Vitest tests plus importer/schema Node tests pass. Updated stale HTTP and committee test fixtures and repaired one Windows punctuation byte in an existing test file.
- Local auth integration: 4/4 pass (staged signup/verify/login; repeated import and bcrypt upgrade; unlinked-profile recovery; mocked Google/state/linking; email-change/session protections).
- Full backend e2e: 198 passed, 10 failed in the older database-schema suite. Its expected roles, committees, permissions, columns, IDs and constraint inventory lag existing main migrations; one CANCELLED-registration fixture also violates the current status-transition constraint. Nest auth lifecycle, Wallet membership and registration suites pass. These failures are not claimed as green.
- Frontend typecheck and 3 routing tests pass. `next build --webpack` passes. Default Turbopack build fails resolving its Google-font internal module. Full lint retains 6 pre-existing effect/setState errors in profile/dashboard components and 15 warnings. Auth changed-file lint has no errors.
- Browser through localhost:3000 → Nest :3101 → isolated Postgres: signup 201, login before verification 403, verification link redirects to localized landing, login/profile 200, HttpOnly token not readable in JS, reset request 200; submitting the actual reset form redirects to login; old password 401/new password 200. Recording transport sent no messages for synthetic accounts.
- Docker is absent on this machine, so Compose itself was not run. Native PostgreSQL 18 on loopback :55439 applied all 44 committed migrations instead. No hosted database was accessed or imported.

Artifacts: backend `artifacts/auth-emails/{verification,reset,welcome,email-change}-{en,ar}.{html,txt,png}`; frontend `artifacts/auth-pages/{login-en,login-ar,signup-en,verification-en,verification-ar,reset-en,forgot-en}.png`. Arabic previews were visually checked. All preview links are synthetic.

## Reproduce local checks

Run commands sequentially in each repository: Prisma generation/build must not race another generation process. Use the pinned package manager (`npx --yes pnpm@12.3.4` backend; `12.4.1` frontend if pnpm is not installed).

```sh
# Backend, against an explicitly chosen disposable local database only
export DATABASE_URL=postgresql://gdg_auth_local@127.0.0.1:55439/gdg_auth_migration
pnpm prisma:migrate:deploy
pnpm lint
pnpm typecheck
pnpm test
pnpm test:auth:local
# test:auth:local builds first and injects recording email + mocked Google transports.
# For all e2e, prepare a SECOND disposable local database with migrations:
TEST_DATABASE_URL=postgresql://gdg_auth_local@127.0.0.1:55439/gdg_schema_test_auth_browser BETTER_AUTH_SECRET=local-test-only-secret-at-least-32-characters pnpm test:e2e

# Default dry run; private export contains users[] and identities[] from Supabase.
pnpm build
pnpm auth:import /private/path/supabase-auth-export.json
# Local fixture import only, when ready; reruns are idempotent:
pnpm auth:import /private/path/supabase-auth-export.json --apply

# Recording local browser server (use a migrated disposable test database)
DATABASE_URL=postgresql://gdg_auth_local@127.0.0.1:55439/gdg_schema_test_auth_browser node scripts/run-auth-browser-local.mjs
# Frontend in another terminal
NEXT_PUBLIC_USE_API=true API_PROXY_TARGET=http://localhost:3101 pnpm exec next dev --webpack
pnpm lint
pnpm typecheck
pnpm test
pnpm exec next build --webpack
```

The importer intentionally refuses remote hosts, production mode and URL overrides; an owner-controlled production migration procedure must be approved separately. Keep exports outside Git and delete local copies according to the owner's data handling policy. Never run repository tests against the deployment database.

## Owner configuration and cutover

Set the random Better Auth secret, public frontend origin, Google credentials/callback, trusted proxy hop count, and existing DB/Storage credentials. Resend sender is environment-driven, with example `GDG on Campus UJ <noreply@gdguj.org>`. Owner reports gdguj.org verified in Tokyo (ap-northeast-1), including DKIM and send/rsend records. Recommended owner DNS addition: TXT `_dmarc` → `v=DMARC1; p=none;`. The private API key and test inbox belong only in ignored `.env`. Non-sending `domains.list` returned `restricted_api_key`; this permission result does not prove delivery.

Owner must inspect deployed RLS/policies/triggers not represented in Git, supply/reconcile an approved users+identities export, back up data, resolve importer conflicts, arrange coordinated release and rollback, and revoke old Supabase sessions. Old reset/verification links need reissue through the new UI. Keep Supabase DB/Storage and source auth data through the rollback period. Pending signups older than the staging window complete their profile again after verified login.

Reference docs: https://better-auth.com/docs/adapters/prisma, https://better-auth.com/docs/authentication/email-password, https://better-auth.com/docs/authentication/google, https://better-auth.com/docs/concepts/users-accounts.

## Authorized live Resend check

After the owner supplied a key in ignored `.env` and explicitly approved their inbox, the local Nest harness sent exactly one English verification and one English reset email through the production Resend SDK service. No other recipient or welcome message was sent. Resend accepted verification message `01a1d66c-e18e-7511-8a9a-d48b6d570961` and reset message `01a1d66d-1162-7b1c-ab25-06e70ca3ec87`. Both links use `http://localhost:3000`; following them through the Next.js proxy returned HTTP 200 at `/en/verify-email` and `/en/reset-password`. Verification was consumed; reset was not submitted. Inbox delivery/spam placement remains for the owner to confirm. Links are intentionally local test links, not deployment links. Arabic variants were rendered and screenshot-checked without extra live sends.

The harness `--live` mode requires the configured owner inbox/key/sender in ignored `.env`, uses an explicitly selected local test DB, rejects all other real recipients, and reserves each message kind before delivery to prevent repeat sending. Private mail links and receipts remain outside Git in `/tmp/gdg-auth-live-owner`. No key, password or live token is committed or logged.

## Compose configuration audit

The full-platform overlay now enables the frontend API client, proxies same-origin API requests to `http://backend:3001` on the Compose network, uses the frontend's pinned pnpm 12.4.1 and starts webpack. The backend service explicitly receives Better Auth, Google and Resend environment settings; the obsolete auth-bypass variable is removed. Both Compose YAML files parse successfully with Ruby YAML. Docker execution remains unverified because Docker is not installed here. On a Docker-equipped machine, use `FRONTEND_PATH=../frontend docker compose -f docker-compose.yml -f compose.platform.yml up --build` from this checkout after setting local Postgres variables and the auth placeholders in ignored `.env`. Do not exercise real-recipient auth flows during that check without further owner authorization; the two approved live messages have already been sent.

## Review correction: verified Google linking

Removed Google from Better Auth's `trustedProviders` (explicit empty list). Provider trust bypassed the provider's `email_verified` claim when linking an existing verified local user. The regression first presents a validly signed Google identity with `email_verified: false` and asserts error redirect, no session and no attached Google account; the same identity with `email_verified: true` still links successfully. All four local auth integration tests pass after the fix. Google signup locale/welcome review work remains in progress.

## Review correction: Google locale and welcome

Frontend Google sign-in now includes normalized EN/AR locale in OAuth state. Backend creates new Google users with that locale and uses a persisted atomic welcome-delivery claim plus a Resend idempotency key. Welcome runs for verified sessions as well as email verification, and repeat sign-ins do not resend it. Failed delivery releases the claim for a later login retry. Migration `20261113230000_auth_welcome_delivery` adds the nullable marker (45 migrations total). Local recording-only integration tests now pass 6/6, including both AR and EN Google signup and repeated login. No additional real email was sent during review fixes.

Docker/Colima and standalone Compose became available during final review. The merged Compose configuration validates with `docker-compose ... config --quiet`; actual runtime verification is in progress while Colima initializes. Earlier statements that Docker was absent describe the initial validation environment.

## Final Compose result and independent review

Docker/Colima initialization completed in the dedicated `gdg-auth-validation` VM. The existing frontend inline Dockerfile required BuildKit/Buildx rather than Docker's classic builder. Backend and frontend images built from the current migration branches. All three services (frontend, NestJS, Postgres 17) reported healthy. All 45 migrations applied to a separate local Compose database. All six recording-only auth integration tests passed against that database.

A full HTTP smoke test through the containerized frontend on localhost:3002 passed Arabic signup, unverified-login rejection, verification link landing, login/HttpOnly cookie, application profile with no granted roles, reset link landing/submission, previous-session revocation, old-password rejection and new-password login. The temporary validation overlay used backend port 3103, Postgres port 55440, a disabled API key and a synthetic-recipient-only Resend fetch recorder. No real mail or remote DB traffic occurred. Native browser/UI screenshots and the two earlier authorized live email receipts remain the separately documented evidence above. The validation stack and dedicated VM were stopped afterward; no unrelated VM was touched.

Independent re-review confirmed both Google findings fixed, six local auth integration tests passing, backend lint/typecheck/266 unit tests/build passing, frontend webpack build passing, and the same 198-pass/10-fail older schema e2e result. No further concrete code findings were reported. Frontend baseline lint/Turbopack limitations remain as described; they are not reported as passing.

For Compose on this checkout, ensure Buildx and Compose are discoverable, then use the documented full-platform command. The equivalent standalone invocation is `DOCKER_BUILDKIT=1 docker-compose -f docker-compose.yml -f compose.platform.yml up --build` with `FRONTEND_PATH=../frontend` and local-only environment settings. Avoid parallel Prisma generation/build checks against the same bind-mounted checkout.

## Email design v2 and publication authorization (2026-11-13)

The owner authorized a full branded bilingual email redesign, then explicitly
superseded the earlier local-only publication restriction: push
`feat/better-auth-resend` in both repositories and open linked PRs to `main`.
Do not merge or deploy. Earlier no-push statements above describe the original scope.

See [email design](email-design.md). Five templates now cover verification, reset,
welcome, email-change confirmation and a successful-password-reset security notice;
each has AR/EN HTML and plain text. Verification and recovery lifetimes are explicitly
one hour. The notice is best-effort after reset and does not cover authenticated
password changes. There are no API/schema/migration changes in the email redesign.

Current backend lint/typecheck/build pass; 271 Vitest tests and 15 Node tests pass.
Lint has four pre-existing warnings. All 40 desktop/mobile light/dark screenshots
pass layout, asset-fixture decode and contrast checks: minimum contrast 5.09:1;
maximum HTML 8,505 bytes. Artifacts and the six accepted Resend message IDs are in
`artifacts/auth-emails/v2/` (see `manifest.json` and `resend-receipts.json`). Exactly
one of each template in EN plus AR verification went only to the owner-authorized
inbox. These contain synthetic preview links, not usable authentication tokens.
Resend acceptance does not establish inbox delivery or client rendering.

Public website/PNG availability remains a cutover requirement: `gdguj.org` did not
resolve in this environment. Screenshots substituted the exact sibling frontend PNG
for its absolute production URL. Restore public DNS/HTTPS asset serving before
production emails. Gmail/Outlook/Apple Mail inbox checks remain owner validation;
Chromium screenshots are not native mail-client certification.

Pre-push gitleaks scanned full histories in both repositories with redaction.
Frontend: zero findings. Backend: two reviewed false positives only (synthetic
AUTH_USER_ID UUID in an old unit-test commit and stock NestJS abc123def456 badge
token in the initial README); a second scan excluded exactly those fingerprints
and passed. No real secret was found, no environment file is staged, and only
`.env.example`/`.env.test.example` are tracked. No historical credential data was
rewritten. Existing schema-e2e, frontend lint and Turbopack limitations documented
above are not attributed to this redesign.
