# API Overview

Backend: **NestJS**, TypeScript. Phase 2 implements authentication, users,
friends, and groups. Authentication and authorization rules are described
in detail in [`docs/architecture/auth.md`](../architecture/auth.md).

## Conventions

- **Base path**: feature routes are served under **`/api/v1`**
  (`app.setGlobalPrefix`, see `apps/api/src/app.setup.ts`). `/health` stays
  unprefixed for infrastructure probes.
- **Auth**: a JWT access token in an **httpOnly cookie** (`access_token`),
  backed by a revocable server-side session in Redis. Every route requires
  authentication unless marked `@Public()`. No endpoint accepts a user id
  for the caller — the authenticated principal always comes from the
  verified session.
- **Browser clients** must send requests with credentials
  (`fetch(..., { credentials: 'include' })`). State-changing requests from a
  browser must come from the configured `CORS_ORIGIN` (Origin check, `403`
  otherwise).
- **Validation**: every body is a DTO validated by the global
  `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`).
  Unknown fields are rejected with `400`, which is also how attempts to
  supply server-owned fields (`requester`, `ownerId`, `status`, …) fail.
  Path ids are validated as 24-hex ObjectIds (`400` otherwise).
- **Error shape**: standard Nest HTTP exception JSON
  (`{ statusCode, message, error }`), mirrored in
  `packages/shared/src/types.ts` as `ApiErrorBody`. Validation errors carry
  `message` as a string array.
- **Rate limiting**: `POST /auth/register` and `POST /auth/login` allow 10
  requests per minute per client IP (per route); excess requests get `429`
  with `Retry-After`.
- **Idempotency** (planned): mutating endpoints that trigger financial
  state changes (payment initiation, provider webhooks) will require/accept
  an idempotency key so retried requests can't double-apply a payment.
- **Webhook verification** (planned): provider webhook endpoints will verify
  a signature/secret before trusting any payload, and will re-verify status
  with the provider rather than trusting the webhook body alone.
- **Audit logging** (planned): every endpoint that mutates a `Settlement` or
  `Payment` writes an `AuditLog` entry as part of the same operation.

### Status codes

| Code  | Meaning in this API                                                           |
| ----- | ----------------------------------------------------------------------------- |
| `200` | Success with a body                                                           |
| `201` | Resource created (register, friend request, group, group member)              |
| `204` | Success without a body (logout, cancel, remove, leave)                        |
| `400` | Invalid input (validation, malformed id, self-request, empty update)          |
| `401` | Not authenticated, or invalid credentials                                     |
| `403` | Authenticated and can see the resource, but not allowed to perform the action |
| `404` | Not found — **or** not visible to the caller (e.g. a group they aren't in)    |
| `409` | Conflicts with current state (duplicate email/request/member, owner leaving)  |
| `429` | Rate limit exceeded                                                           |

## Endpoints

Response bodies use the contracts in
[`packages/shared/src/identity.ts`](../../packages/shared/src/identity.ts)
(`UserProfile`, `PublicUser`, `FriendRequestSummary`, `FriendSummary`,
`GroupSummary`, `GroupDetail`, `GroupMemberSummary`). Timestamps are ISO
8601 strings.

### Health

| Method | Path      | Auth   | Purpose                                                   |
| ------ | --------- | ------ | --------------------------------------------------------- |
| `GET`  | `/health` | Public | Liveness/readiness (MongoDB + Redis pings via `terminus`) |

### Auth — `/api/v1/auth`

| Method | Path        | Auth   | Body                        | Success                                            |
| ------ | ----------- | ------ | --------------------------- | -------------------------------------------------- |
| `POST` | `/register` | Public | `{ name, email, password }` | `201 { user: UserProfile }` + session cookie       |
| `POST` | `/login`    | Public | `{ email, password }`       | `200 { user: UserProfile }` + session cookie       |
| `POST` | `/logout`   | Public | —                           | `204`; revokes the session (if any), clears cookie |

- `register`: name 1–100 chars; valid email (stored lowercased); password
  8–128 chars. Duplicate email → `409`.
- `login`: any failure → `401 Invalid email or password` (no distinction
  between unknown email, wrong password, or inactive account).
- `logout` is public so a client with an expired token can still clear its
  cookie; it is idempotent.

### Users — `/api/v1/users`

| Method | Path  | Auth     | Success           |
| ------ | ----- | -------- | ----------------- |
| `GET`  | `/me` | Required | `200 UserProfile` |

This is the "current authenticated user" endpoint. There are no endpoints
that read or modify other users' accounts.

### Friends — `/api/v1/friends`

| Method   | Path                          | Who                     | Body        | Success                                |
| -------- | ----------------------------- | ----------------------- | ----------- | -------------------------------------- |
| `GET`    | `/`                           | Caller                  | —           | `200 FriendSummary[]` (sorted by name) |
| `DELETE` | `/:userId`                    | Either friend           | —           | `204`                                  |
| `POST`   | `/requests`                   | Caller (sender)         | `{ email }` | `201 FriendRequestSummary`             |
| `GET`    | `/requests/incoming`          | Caller (addressee)      | —           | `200 FriendRequestSummary[]`           |
| `GET`    | `/requests/outgoing`          | Caller (requester)      | —           | `200 FriendRequestSummary[]`           |
| `POST`   | `/requests/:requestId/accept` | Addressee only          | —           | `200 FriendRequestSummary`             |
| `POST`   | `/requests/:requestId/reject` | Addressee only          | —           | `200 FriendRequestSummary`             |
| `DELETE` | `/requests/:requestId`        | Requester only (cancel) | —           | `204`                                  |

Errors: self-request `400`; unknown email `404`; duplicate/reverse/already
friends/rejected-requester re-send `409`; accepting or rejecting your own
request, or cancelling someone else's, `403`; a request you are not part of
`404`; responding to a non-pending request `409`.

### Groups — `/api/v1/groups`

| Method   | Path                        | Who                         | Body                        | Success                  |
| -------- | --------------------------- | --------------------------- | --------------------------- | ------------------------ |
| `POST`   | `/`                         | Caller (becomes OWNER)      | `{ name, description? }`    | `201 GroupDetail`        |
| `GET`    | `/`                         | Caller                      | —                           | `200 GroupSummary[]`     |
| `GET`    | `/:groupId`                 | Any active member           | —                           | `200 GroupDetail`        |
| `PATCH`  | `/:groupId`                 | OWNER, ADMIN                | `{ name?, description? }`   | `200 GroupDetail`        |
| `POST`   | `/:groupId/members`         | OWNER, ADMIN                | `{ userId }`                | `201 GroupMemberSummary` |
| `PATCH`  | `/:groupId/members/:userId` | OWNER                       | `{ role: ADMIN \| MEMBER }` | `200 GroupMemberSummary` |
| `DELETE` | `/:groupId/members/:userId` | OWNER; ADMIN (MEMBERs only) | —                           | `204`                    |
| `POST`   | `/:groupId/leave`           | ADMIN, MEMBER               | —                           | `204`                    |

- Non-members get `404` for every group route (the group's existence is not
  revealed).
- Adding a member requires that the new member is an accepted **friend of
  the caller** (`403` otherwise); new members join as `MEMBER`; already
  active → `409`; a former member is reactivated.
- The owner cannot be removed (`403`), cannot leave (`409`), and `OWNER`
  cannot be assigned via the role endpoint (`400`). Removing yourself →
  `400` (use `/leave`).
- `PATCH /:groupId` with neither field → `400`.

## Planned module → route surface (later phases)

| Module        | Example routes (planned)                                              |
| ------------- | --------------------------------------------------------------------- |
| Auth          | `POST /api/v1/auth/refresh` (refresh rotation, not yet needed)        |
| Expenses      | `GET/POST /api/v1/expenses`                                           |
| Splits        | (nested under Expenses)                                               |
| Balances      | `GET /api/v1/balances`                                                |
| Settlements   | `GET /api/v1/settlements/:id`                                         |
| Payments      | `POST /api/v1/settlements/:id/payments`                               |
| UPI           | `POST /api/v1/payments/:id/upi/initiate`, `POST /api/v1/webhooks/upi` |
| Transactions  | `GET /api/v1/transactions`                                            |
| Notifications | (internal, dispatched by other modules)                               |
| Reminders     | (internal, BullMQ-scheduled)                                          |
| Preferences   | `GET/PATCH /api/v1/preferences`                                       |
| Audit Logs    | `GET /api/v1/audit-logs` (admin/debug only)                           |

These routes do not exist yet — they are documented so module boundaries
are agreed before implementation, per
[`docs/architecture/overview.md`](../architecture/overview.md).

## Client access (frontend)

`apps/web/src/lib/api-client.ts` provides a small `fetch` wrapper
(`apiClient.get/post/patch/delete`, `API_V1` prefix) that always sends
credentials and turns error bodies into an `ApiError(status, message)`.
Auth calls live in `apps/web/src/lib/auth-api.ts` and are used through the
TanStack Query hooks in `apps/web/src/hooks/use-auth.ts`. The frontend never
sees the access token. It never assumes success from a redirect/return —
see [`docs/architecture/payment-flow.md`](../architecture/payment-flow.md).
