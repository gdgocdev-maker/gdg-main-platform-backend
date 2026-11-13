# Better Auth and Resend migration

Status: audit complete; implementation and validation pending. Do not deploy this branch until the acceptance checklist is complete.

## Source and base verification (2026-11-13)

Fetched all remotes with prune in both repositories and inspected remote branches ordered by commit date and all open PRs (none). Backend base: `origin/main`, `193ae5669bfc4258b21ec36246a72a45b4a97ead` (merged PR #62). Frontend base: `origin/main`, `15c68e2914f5de63fb1c8ac73486dedf3a068d5a` (merged PR #133). There is no dev/staging integration branch. Backend `origin/feat/wallet-integration` has a newer wallet-only commit `f1e4948`, but is six main commits behind and one ahead; it is not the integration line. Both migration branches start at current main. No push or PR is authorized.

The user's migration instruction supersedes the older Supabase credential-ownership decision. NestJS remains authoritative; Next.js remains a frontend/proxy. Existing membership approval policy is unchanged.

## Implemented auth inventory

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

Use current stable Better Auth (npm latest inspected: 1.7.23), Prisma 7 adapter and existing PrismaService. Mount the Node handler on NestJS before body parsing. Use same-origin Next.js proxy: public `/api/auth/*` routes reach NestJS `/auth/*`. Public auth base URL is the frontend origin plus `/api/auth`; exact trusted frontend origins only. HttpOnly, Secure in production, SameSite=Lax cookies support OAuth callback navigation. No frontend database or auth authority. Retire Supabase sessions at cutover and require fresh login.

Create separate Better Auth User, Account, Session and Verification tables. IDs are UUID strings and imported users retain Supabase IDs. Person remains application authority, linked by authUserId; role, membership, committee scope, deactivation and approval checks remain unchanged. Never copy roles from OAuth metadata. Persist locale (en/ar); treat locale as presentation data only.

Enable verified email/password, Google, password reset, and verified email change. Keep Google client variable names found in environment examples. Restrict automatic linking to verified Google email and established identity IDs; reject conflicting mappings rather than overwriting Person links. Do not enable unused magic-link sign-in. Preserve staged profile choices and finalize only after verified identity; no direct sign-up path may grant memberships or roles.

One Resend SDK service uses `RESEND_API_KEY` and `EMAIL_FROM`; render escaped bilingual HTML plus plain text for verification, reset, welcome and email-change notifications, including OTP if the existing verification UI retains codes. Reuse frontend GDG logo and Google palette, accessible CTA and RTL Arabic. Local tests inject a recording transport; never send to real addresses. Do not silently report success on failed delivery.

## Existing-account import

Implement a local-only, default-dry-run importer for owner-exported auth.users and auth.identities. Never connect to production from this workflow. Validate UUIDs, normalized email uniqueness, duplicate provider IDs, person links, unsupported identities and hash formats before a transactional import. Preserve source user UUID, verified timestamps, locale, bcrypt credential hash and Google `sub` as provider accountId. Do not import sessions, refresh tokens or OAuth access/refresh tokens. Disable banned/deleted accounts. Report counts without emails, hashes or tokens. Reruns must not overwrite passwords changed after import or attach conflicting users.

Password verification accepts imported bcrypt (including Supabase `$2a$`/`$2b$` variants); new/reset passwords use Better Auth's default hashing. Rehash only after successful verification, with compare-and-swap against the original hash. Test login with imported hashes, wrong passwords, repeated import and conflicts. Existing local unlinked people require proven email ownership before linking; never attach by an untrusted submitted email.

## Rollout and acceptance

1. Apply additive Prisma migration to isolated local Postgres; seed only synthetic accounts.
2. Validate signup → verify → login; reset single-use/expiry and session revocation; mocked Google callback/state/linking; role/deactivation guards; import idempotence and bcrypt login.
3. Run lint, typecheck, tests and build in both repos. Frontend currently has no test script; add appropriate auth tests.
4. Run Compose locally, browser-test bilingual auth, save auth-page and email HTML/PNG screenshots.
5. Commit both branches locally. No push, PR, production migration or real mail sending.
6. Owner supplies Resend key and verified sender domain, Better Auth secret, public frontend origin, existing Google client credentials and new callback allowlist; provides approved auth export and deployed RLS/trigger inventory. Agree maintenance window, backups, pending-signup handling and coordinated frontend/backend release. Existing reset links and sessions expire at cutover; provide resend path. Keep Supabase auth data until rollback window closes.

Environment observation: Node 26.13.0 is available; pnpm and Docker are absent from PATH and standard Docker Desktop/Homebrew paths. Package installs are being attempted through pinned `npx pnpm`; Docker/Compose validation remains outstanding.

## Implementation checkpoint

Foundations added: pinned Better Auth 1.7.23/Resend 6.38.0, additive Prisma models/migration, auth factory (not yet mounted), bcrypt-compatible verifier, bilingual HTML/plain-text templates, Resend service, local-only import planner/executor, and frontend client (not yet used by existing pages). Existing Supabase auth behavior is still active until integration is complete. Do not deploy this checkpoint.

Validation so far: generated Prisma client; backend TypeScript and Nest build pass; frontend TypeScript passes after `next typegen`; 12 password/template tests and 4 import unit tests pass. A native PostgreSQL 18 instance isolated at loopback port 55439 applied all 43 migrations. `test/better-auth-local.test.mjs` passes against it, exercising real Prisma signup/verification/login/reset and imported bcrypt login, including default dry-run and repeated import. Email transport is injected/recorded, never sent. Docker Compose itself was unavailable. Whole-repository lint has pre-existing failures: backend non-UTF-8 `member-assignment-security.spec.ts`; frontend profile effect and other existing issues. Changed-file backend lint passes.

Remaining work: wire auth factory into Nest before body parser; replace provider calls/guards/controller cookies while retaining staged membership finalization; synchronize verified email changes to Person identities safely; persistent auth endpoint rate limits; migrate all frontend flows and proxy; update OpenAPI/setup docs; Google callback/role/session tests; browser screenshots and email PNG renders; full checks and final local commits. Factory is currently a tested foundation, not an implemented application cutover.

Reference documentation consulted: https://better-auth.com/docs/adapters/prisma, https://better-auth.com/docs/authentication/email-password, https://better-auth.com/docs/authentication/google, https://better-auth.com/docs/concepts/users-accounts. Installed Next.js proxy/rewrites guides were read before adding frontend client code.

Full-suite checkpoint: `vitest run` reports 19 passing/6 failing files, 292 passing/42 failing tests; failures require investigation before final handoff. Frontend production build fails during Google font processing with `next/internal/font/google` module-resolution errors. Neither is reported as passing. Artifacts currently contain HTML/text previews only, not PNG screenshots.
