# Membership requests API

All routes below use the existing Supabase Auth bearer token. `POST` additionally asks Supabase Auth to confirm the token's email is verified before saving a request. Applicant identity comes from the token's `sub` mapped to `person.auth_user_id`; request bodies cannot supply a person or member ID.

## Submit an application

`POST /membership-requests`

```json
{
  "applicationData": {
    "phoneNumber": "+966500000000",
    "universityEmail": "applicant@example.test",
    "university": "University of Jeddah",
    "college": "College of Computer Science and Engineering",
    "major": "Computer Science",
    "level": "Level 4",
    "gender": "female"
  },
  "committees": [
    { "committeeCode": "DATA", "requestedRole": "Member" },
    { "committeeCode": "PR", "requestedRole": "Member" }
  ]
}
```

The initial request and each committee decision are `PENDING`. Repeated submissions for the same authenticated person return the existing request; they do not overwrite its application or duplicate committee rows.

## List requests for a committee

`GET /membership-requests?committeeCode=DATA`

Requires an active committee member who holds `applications.decide` for the requested committee. The migration grants that permission to DATA and PR Leaders and Co-Leaders only. Pending committee decisions are returned first. Applicant contact details and application data are returned only to authorized leaders.

## Decide for one committee

`PATCH /membership-requests/:requestId/committees/:committeeCode`

```json
{ "decision": "APPROVED" }
```

`decision` is `APPROVED` or `REJECTED`. A decision is immutable and a repeated decision returns `409`. Approval adds the applicant to that committee with the least-privileged `Member` position; the requested role is retained only as application information. Other committee decisions are unchanged. The overall request stays `PENDING` while any committee is pending, becomes `APPROVED` when all are decided and at least one approved, or `REJECTED` when all rejected.

Unauthenticated requests return `401`; authenticated users without the committee permission return `403`.

The migration is authored but must be applied separately after approval. No database has been migrated by this feature work.
