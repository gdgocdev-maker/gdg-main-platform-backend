# Authentication and RBAC

## Approved direction

The user confirmed Supabase Auth as the credential owner on 2026-10-05. NestJS verifies the provider identity and enforces local role-based and committee-based access control. The backend is the authoritative enforcement point. Google OAuth remains a potential provider flow requiring configuration review.

Do not store password hashes in the local users table. The proposed schema links local accounts to Supabase identities through a unique auth_user_id UUID. Pre-existing local records may remain unlinked until invitation/setup completes. Invitation, reset, token verification, and idempotent provider-to-local provisioning must be designed with the authentication owner.

The proposal identifies these user roles: Member, Volunteer, Organizer, Employee/Staff, Admin, and later proposes Alumni. It gives examples of capabilities for Member, Volunteer, Organizer, and Admin.

## What is confirmed

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

## TBD before implementation

The following must be confirmed before coding the full auth system:

- exact role set and whether Employee/Staff and Alumni are active in the first release;
- permission matrix by role and resource;
- account provisioning, deactivation, alumni transition, and role-change workflow;
- Google OAuth restrictions, consent-screen settings, callback routes, and allowed email domains;
- token transport/storage, expiry, refresh, logout, revocation, and session policy;
- Supabase password/invitation/reset flows and which OAuth providers are enabled;
- audit-log, account-recovery, privacy, and retention requirements.
- CORS allowlist, OAuth redirect allowlist, CSRF policy if cookies are used, and Swagger/OpenAPI access policy.
