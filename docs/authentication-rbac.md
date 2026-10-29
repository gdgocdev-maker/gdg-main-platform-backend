# Authentication and RBAC

## Current signup and session flow (supersedes legacy endpoint descriptions below)

Browser sessions use HttpOnly `gdg_access` and `gdg_refresh` cookies through the frontend's same-origin `/api/*` proxy. The proxy cookies use `SameSite=Strict`; they are `Secure` in production. The access cookie is scoped to `/api` and the refresh cookie to `/api/auth`, keeping them off frontend page requests. During the two-service rollout only, the backend also emits the previous `/` and `/auth` cookie paths so the old frontend continues working until the new frontend is deployed. Remove that temporary compatibility after deployment; the legacy production cookies use `SameSite=None` and are not part of the final design. The proxy removes the `/api` prefix before forwarding to this backend and must forward `Origin` and `Cookie` request headers and pass `Set-Cookie` response headers unchanged. Cookie-authenticated mutations require an exact `Origin` match with `FRONTEND_URL`. CORS remains limited to that origin and allows credentials. The frontend does not read or persist access/refresh tokens. `/auth/refresh` rotates Supabase sessions; `/auth/logout` revokes the current access token digest locally, signs out the refresh session at Supabase, and clears both current and legacy cookie paths. Protected routes still enforce backend permissions.

`POST /auth/signup` requires a personal email, password, registration type, application data, committee selections, and requested global roles. The personal email is the only login identity and the only address that must be verified. University email is optional profile data: it is not verified and does not reserve an address across accounts. If supplied, it must differ from the personal email, compared case-insensitively after trimming. When an unverified account with a pending signup attempts password login, the backend resends its personal-email code and returns `EMAIL_NOT_VERIFIED`; the frontend opens the code-entry page. Codes expire after ten minutes, allow five attempts, and have a 60-second resend cooldown. Digests, not plaintext codes, are stored.

Signup choices remain in `pending_signup` on the server for up to 24 hours. No application, non-member record, active member, or role is created until the personal email is verified. Verified non-members are recorded in `non_member_registration`. Verified member applicants receive pending committee and global-role application rows. Each committee application is routed to its committee leaders; committee leadership in Automation, Data Analysis, Web Development, AI, IoT/Robotics, or Cybersecurity is routed to the Developer Committees Leader; other committee leaders and global leadership roles are routed to Group Leaders/Co-Leaders. The backend assigns requested positions only after the responsible approval. Self-approval is rejected.

The relevant committed signup migrations must be applied before deploying this behavior. Supabase email confirmation is required and Supabase sends the personal-email code for all new signups. Existing descriptions below that mention bearer-only browser sessions, token JSON responses, or signup without email confirmation are historical and must not be used as the current API contract.

Security review note (2026-10-27): account recovery returns the same success response for known and unknown personal emails. `POST /auth/check-email` still reveals whether an account exists to support the current email-first signup/login UX. Auth routes now use atomic PostgreSQL-backed fixed-window limits; also configure edge-level limits before public production traffic. Set `TRUST_PROXY_HOPS` to the exact trusted proxy count in deployment, or clients behind one proxy will share its IP bucket. The frontend `/api` proxy adds a hop, so verify the chain after deployment; never trust arbitrary forwarded headers or use blanket proxy trust. No live Supabase or SMTP transaction has been verified by repository tests.

## Approved direction

The user confirmed Supabase Auth as the credential owner on 2026-10-05. NestJS verifies the provider identity and enforces local role-based and committee-based access control. The backend is the authoritative enforcement point. Google OAuth remains a potential provider flow requiring configuration review.

Do not store password hashes locally. The current Person model maps to person and links to Supabase identities through the nullable unique person.auth_user_id UUID. This plain PostgreSQL setup does not install a foreign key to auth.users. Local person records may remain unlinked until invitation/setup completes. Invitation, reset, token verification, and idempotent provider-to-local provisioning must be designed with the authentication owner.

The proposal identifies these user roles: Member, Volunteer, Organizer, Employee/Staff, Admin, and later proposes Alumni. It gives examples of capabilities for Member, Volunteer, Organizer, and Admin.

## Historical implementation snapshot

The endpoint descriptions in this section predate the current cookie-based, staged signup flow described at the top of this document. Use that current flow and the published API contract when they differ.

Code lives in `src/auth/`.

**`GET /integrations/google/gmail/callback`** is reserved as the Gmail OAuth redirect URI. It currently responds with HTTP 501 because the OAuth authorization flow, state verification, token exchange, and credential storage are not implemented. Do not treat this route as a working Gmail connection yet.

**Environment** (`.env`, see `.env.example`):

- `SUPABASE_URL`: the Supabase project that issues login tokens. Without it the app still runs, logs a warning, and nobody can log in.
- `SUPABASE_PUBLISHABLE_KEY`: used by `POST /auth/login`. Without it (or `SUPABASE_URL`) the app starts, but login fails with 500.
- `SUPABASE_SECRET_KEY`: admin key, used for invites, setting passwords and undoing a half-finished signup. Keep it in `.env` only.
- `PASSWORD_SETUP_URL`: the frontend page the setup/reset email opens. Must also be listed in Supabase under Authentication > URL Configuration > Redirect URLs, or Supabase sends people to the project's Site URL instead.

**How a request is identified** (`AuthGuard`, runs before every route):

1. Reads `Authorization: Bearer <token>`.
2. Verifies the Supabase token: signature (Supabase's public keys), expiry, issuer, and audience `authenticated`.
3. Finds the `person` whose `auth_user_id` matches the token, plus their `member` row.
4. Sets `request.user = { personId, memberId, email, fromEmailLink }`. `memberId` is `null` unless the person is an active member. `email` is the login email from the token. `fromEmailLink` is `true` when the token came from clicking an invite/reset email (Supabase labels those sign-ins `otp` in the token's `amr` claim) rather than a password login.

The guard never rejects a request. No token, a bad or expired token, an unlinked account or a deactivated person all continue as a visitor with no `request.user`, so public pages keep working. Routes that need a login must return 401 when `request.user` is missing, and each route still checks its own permissions. If Supabase's keys can't be reached, the request fails with 500.

**`GET /me`**: 401 without a login. Otherwise returns `personId`, `memberId`, `fullName`, personal `email`, optional `universityEmail`, `phoneNumber`, `university`, `branch`, `college`, `major`, `level`, `gender`, `bio`, `socialLinks` (`github`, `portfolio`, `x`), `profileImageUrl`, `joinDate`, `committees` (`code`, `name`, `position`), `roles` (club roles current today, Saudi date), and `membershipRequestPending`. College and level are read from the saved membership application or non-member registration data. Inactive members get empty `committees` and `roles`; fields not collected or not set are null.

**`PATCH /me/bio`**: Requires a signed-in account. Body `{ "bio": string }`; accepts up to 500 characters, trims surrounding whitespace, and stores an empty value as `null`. Returns `{ "bio": string | null }` in the standard success envelope. Only the authenticated person's bio can be changed; identity and academic fields remain read-only through this route. Invalid input returns 400 `VALIDATION_ERROR`; unauthenticated requests return 401. The machine-readable operation is documented in [profile-bio-openapi.yaml](profile-bio-openapi.yaml).

**`PATCH /me/social-links`**: Requires a signed-in account. Accepts optional `githubUrl`, `portfolioUrl`, and `xUrl` values as HTTP(S) URLs up to 2048 characters; GitHub links must use `github.com` and X links must use `x.com`. Send `null` to clear a field. The response returns the saved `{ socialLinks: { github, portfolio, x } }` object in the standard success envelope. Updates are scoped to the authenticated person's own row. The fields are optional and do not affect authentication, membership, or permissions. Invalid input returns 400 `VALIDATION_ERROR`; unauthenticated requests return 401.

**Protecting a route** (`src/auth/current-user.ts`): `@UseGuards(AuthRequiredGuard)` returns 401 for visitors; `@CurrentUser()` gives `{ personId, memberId, email }`; `@OptionalUser()` gives the user or `null` on public routes. Each route checks its own permissions with `memberId` (for example against `member_committee` / `committee_permission`, like the registration review routes).

**`POST /auth/login`**: body `{ email, password }`. Supabase checks the password; nothing is stored locally. Returns `accessToken`, `refreshToken` and `expiresAt` (Unix seconds). A wrong email or password gets the same 401, so it doesn't reveal which emails exist. Other Supabase failures (including its rate limit) return 500. Login doesn't check the local `person`: an unlinked or deactivated account still gets tokens, but the guard treats it as a visitor, so `/me` and protected routes return 401.

**`POST /auth/check-email`**: body `{ email }`. Always 200 with `{ nextStep }`, which tells the frontend the next screen: `PASSWORD_REQUIRED` (a `person` with this email is linked to a Supabase account → password box), `PASSWORD_SETUP_REQUIRED` (a `person` exists but isn't linked yet → setup link), `SIGNUP_REQUIRED` (no `person` → signup). Looks in `email_personal` and `email_university`, ignoring letter case. Doesn't check `is_active`; a deactivated person can log in but the guard treats them as a visitor.

**`POST /auth/signup`**: body `{ fullName, email, password }` (password 8-72 characters; the frontend checks "confirm password"). If any `person` already has the email in `email_personal` or `email_university`, or Supabase already has the account, returns 409 `EMAIL_ALREADY_EXISTS`. Otherwise creates the Supabase account and a `person` row (`full_name`, the email in `email_personal`, linked `auth_user_id`) and returns 201 with the same tokens as login. It never creates a `member` row or role. If saving the `person` fails, the new Supabase account is deleted again; if that delete fails too, the account id is logged so it can be removed in the Supabase dashboard. Requires "Confirm email" to be off in Supabase; otherwise signup returns 500 and saves no `person`.

**Password setup for existing members** (two steps; the person has to prove they own the email):

1. **`POST /auth/setup-password/request`**: body `{ email, locale? }`, where optional locale is `en` or `ar` (defaults to `en`). The backend uses `PASSWORD_SETUP_URL` and appends `/{locale}/reset-password`. Existing people receive an invite or reset email; unlinked accounts are linked by Supabase user ID only. If no person exists, the endpoint returns the same generic success response without sending email, to avoid disclosing account existence. If a Supabase account exists but is not linked to the person, it returns 409. Provider email limits return 429. Success: 200, `data: null`.
2. Configure the Supabase **Reset Password** email template to link to `{{ .RedirectTo }}#token_hash={{ .TokenHash }}&type=recovery`, and the **Invite user** template to use `{{ .RedirectTo }}#token_hash={{ .TokenHash }}&type=invite`, rather than linking directly to `{{ .ConfirmationURL }}`. Add `PASSWORD_SETUP_URL` to Supabase's allowed redirect URLs. The app reads the credential from the URL fragment (not sent in the initial HTTP request), removes it from the address bar, and does not verify it on page load, so email link scanners cannot consume it by prefetching the page.
3. **`POST /auth/setup-password/complete`**: body `{ tokenHash, type, password }`, where `type` is `recovery` or `invite` and password is 8-72 characters. The backend verifies the one-time token hash with Supabase only when the user submits the form, checks that the verified Supabase account is linked to an active person, sets the password, and returns 200 with `{ passwordUpdated: true }`. The user then signs in normally. Invalid, expired, or already-used tokens return 401. The existing **`POST /auth/setup-password`** bearer-token route remains supported for links already sent before the template change.

**Testing as a demo person locally**: put a Supabase test user's id in that person's `auth_user_id`, log in as the test user with `POST /auth/login`, and send the returned `accessToken` as `Authorization: Bearer <token>`.

## Current local role policy

The current schema and later approved decisions use GROUP_LEADER, GROUP_CO_LEADER and ADVISOR in role; committee positions are Leader, Co-Leader and Member in member_committee. The original proposal's role names above describe historical intent, not current stored codes. GROUP_LEADER and GROUP_CO_LEADER each have only members.manage as their initial role_permission link; ADVISOR has none. This permits management of members, committees and non-leader committee positions, not leadership appointments. is_privileged is not a permission bypass. DATA event creation/ownership and PR registration rules remain separate; these policy rows do not implement NestJS enforcement. See [Database and Prisma](database-prisma.md#approved-club-role-permissions).

## Historical proposal capabilities

These capabilities describe original product intent, not the current role registry or permission grants. Implement authorization using the current local role policy and approved committee rules linked above.

- A user’s role affects the pages and actions available to them.
- Members can access community-facing capabilities such as event viewing/registration and their permitted profile/task information.
- Volunteers extend member capabilities with assigned volunteer work and event participation information.
- Organizers can manage events, registrants, and assigned tasks.
- Admins have broader management authority over members, applications, events, data, roles, teams, content, and system management.
- Recommendation capability is intended for leadership, described as Organizers and Admins, not general Members.
- AI-assisted application evaluation is advisory; an authorized committee makes the final decision.

## Enforcement rules

- Authenticate requests before granting protected access.
- Authorize every protected action server-side according to an approved permission model.
- Do not rely on frontend route guards, hidden controls, or claimed role fields for security.
- Validate OAuth callback configuration and store all client secrets outside source control.
- Do not log tokens, OAuth client secrets, or personally sensitive credentials.
- Use the backend's approved CORS allowlist; do not accept arbitrary browser origins.
- Protect role changes and other sensitive authorization actions with approved audit events once audit logging is implemented.

## Auth security audit follow-up (2026-10-27)

The API applies PostgreSQL-backed fixed-window limits in `AuthRateLimitGuard`. It stores only HMAC-SHA256 bucket identifiers (keyed by `SUPABASE_SECRET_KEY`), not raw IP addresses, emails, or tokens. Limits are per endpoint and per applicable IP/email/token dimension: login 30/IP and 10/email per 15 minutes; signup 20/IP per hour and 5/email per day; email check 60/IP and 10/email per minute; verification 30/IP per hour and 5/email per 10 minutes; resend 20/IP per hour, 1/email per minute and 5/email per hour; refresh 600/IP and 60/refresh token per 5 minutes; password setup request 20/IP and 3/email per hour; password completion 20/IP per hour and 5/token per hour; logout 120/IP per 5 minutes. Limits are enforced across instances through PostgreSQL. The new migration must be applied before deploying this code; limiter storage fails closed with 503 if unavailable. Set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies (0 for direct local access); never trust arbitrary forwarded headers.

### Enumeration and UX

`POST /auth/check-email` intentionally reveals whether an address belongs to a local or Supabase account through `nextStep`; duplicate signup also returns `EMAIL_ALREADY_EXISTS`. Rate limiting reduces automated probing but does not remove this account-enumeration signal. The current Next.js sign-in already asks for email and then the same password step for every valid address, and does not call `/auth/check-email`; preserve that UI and deprecate the revealing endpoint after checking other API clients. Login already returns the same generic 401 for unknown email and wrong password. For duplicate signup, use a neutral “If this address can be registered, check your inbox” confirmation and let sign-in/recovery guide the person; pending unverified accounts can receive a resend link. This changes the duplicate-signup API response contract, so check Swagger and other clients before shipping it. Do not use a different public message, status, or response timing for known and unknown addresses.

### Local verification checklist

Use a dedicated local Supabase stack or a disposable development Supabase project and a non-production PostgreSQL database. Do not run the migration or signup/recovery tests against production. For local Supabase CLI, start the stack with `supabase start`; Auth emails are captured by the local Mailpit UI (normally `http://localhost:54324`). Configure local templates and Auth URL settings in `supabase/config.toml` (the hosted dashboard template editor does not configure CLI-local Auth). For a hosted development project, use Authentication → URL Configuration and Authentication → Email Templates.

1. Set backend environment variables locally without committing them: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `FRONTEND_URL`, `PASSWORD_SETUP_URL`, and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `AUTH_EMAIL_FROM` for backend-sent signup verification codes. Supabase Auth itself sends recovery/invite emails through its Auth SMTP configuration. Keep these two SMTP paths separate. Never print or paste secret values.
2. Set Auth Site URL to `http://localhost:3000` and add exact redirects for `http://localhost:3000/en/reset-password` and `http://localhost:3000/ar/reset-password` (plus any actual signup callback route). The app sends a locale-specific reset URL; it must be on the allowlist. Hosted Supabase's built-in SMTP is restricted for development, so verify delivery in Mailpit locally or configure a dedicated test SMTP provider for a hosted dev project. Disable click tracking/link rewriting for auth messages.
3. Inspect the Reset Password and Invite templates in their source view. The Reset Password link should be `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>`; Invite should use the same link with `type=invite`. `RedirectTo` is the locale-specific URL built from `PASSWORD_SETUP_URL`. Submit the form and verify the app consumes the token only after the user submits the new password. This checkout has no `supabase/config.toml`; if you initialize a local Supabase CLI project, inspect its matching template entries in that project's `supabase/config.toml` and template files.
4. Inspect `.env` variable names only (never values), then run `pnpm exec prisma migrate status --config prisma7.config.ts` and `pnpm prisma:migrate:deploy` against the dedicated local database. Query `to_regclass('public.auth_rate_limit_bucket')` or inspect Prisma migration status to confirm the rate-limit migration is present. Re-run the lifecycle and DB schema tests against a dedicated test database.
5. In browser DevTools → Network, inspect login, refresh, and logout responses. After the rollout cleanup, both cookies must be HttpOnly, SameSite=Strict, and scoped respectively to `/api` and `/api/auth`; they must also be Secure in production. During rollout, temporary legacy cookies on `/` and `/auth` may also appear. Confirm the browser sends proxy-scoped cookies on refresh and logout, the frontend uses credentials, the frontend proxy forwards Origin/Cookie and passes Set-Cookie through, and backend CORS allows only the exact frontend origin. Use HTTPS for testing Secure behavior; localhost HTTP development intentionally does not set Secure.
6. Exercise one success and failure for each route: signup, wrong/expired verification code, login with wrong credentials, refresh then reuse old token, logout then call `/me`, recovery with known and unknown email, expired/reused recovery token, and authorized/unauthorized committee action. Confirm repeated attempts eventually return 429; verify a correct login/recovery still succeeds after the window expires. Use only synthetic accounts and disposable data.

These instructions describe checks to perform; no live Supabase, SMTP delivery, browser cookie behavior, or local database migration is claimed verified by the mocked HTTP tests in this audit.

## TBD before implementation

The following must be confirmed before coding the full auth system:

- any future role additions beyond the approved local registry;
- additional permissions beyond the approved initial club and committee mappings;
- account provisioning, deactivation, alumni transition, and role-change workflow;
- Google OAuth restrictions, consent-screen settings, callback routes, and allowed email domains;
- token transport/storage, expiry, refresh, logout, revocation, and session policy;
- Supabase password/invitation/reset flows and which OAuth providers are enabled;
- audit-log, account-recovery, privacy, and retention requirements.
- CORS allowlist, OAuth redirect allowlist, CSRF policy if cookies are used, and Swagger/OpenAPI access policy.
- first login for existing members: proposed email invite link instead of choosing a password directly (Backend Workflow section 4), so knowing a member's email isn't enough to claim the account; pending team confirmation;
- signup: proposed Supabase account + `person` row only, no `member` row or role, matching the schema (Backend Workflow section 5 says role MEMBER); pending team confirmation;
- one shared Supabase project for development, so every backend trusts the same logins;
- who sets up Swagger/OpenAPI for the project;
- signup email verification: with "Confirm email" off, anyone can sign up with an email they don't own, which blocks the real owner and sends them our registration emails; decide whether signup must verify the email first;
- optional signup/profile fields from the Backend Workflow form are collected only where present in the signup contract; no student or university ID is requested or exposed as a profile field;
- check-email reveals whether an email is registered (part of the email-first login flow); confirm that's acceptable;
- `SIGNUP_REQUIRED` is a proposed name; the task list only names `PASSWORD_REQUIRED` and `PASSWORD_SETUP_REQUIRED`;
- which email column existing members log in with (`email_personal` or `email_university`); check-email and signup look in both for now;
- setup-password uses two routes (`/auth/setup-password/request` + `/auth/setup-password`); the task list names only `POST /auth/setup-password`;
- the real frontend page for `PASSWORD_SETUP_URL`;
- login error code: plain `UNAUTHORIZED` for now; `INVALID_CREDENTIALS` would need adding to the shared error filter's domain codes;
- Supabase limits sign-ins per IP, and every login reaches Supabase from the backend's one IP, so all users share that limit; raise it or find another fix before launch.
