# Authentication & Authorization

Implemented in Phase 2 (`apps/api/src/auth`, `users`, `friends`, `groups`).
The backend is the only authority: the frontend never supplies or asserts
an identity, a role, or a relationship state.

## Authentication flow

```
Register / Login ──► AuthService
                      ├─ verify or hash password (scrypt)
                      ├─ create session  auth:session:<jti> → userId  (Redis, TTL)
                      └─ sign JWT { sub: userId, jti, iss, aud, iat, exp }  (HS256)
                ◄── Set-Cookie: access_token=<jwt>; HttpOnly; SameSite=Lax; Path=/; [Secure]
                    body: { user: UserProfile }   ← token is never in the body

Any request ──► JwtAuthGuard (global)
                 ├─ @Public()? → allow
                 ├─ read access_token cookie            (missing → 401)
                 ├─ verify signature/alg/iss/aud/exp     (invalid → 401)
                 ├─ session <jti> live in Redis for sub? (revoked → 401)
                 └─ request.auth = { userId, sessionId }  → @CurrentUser()

Logout ──► revoke session <jti> in Redis, clear cookie → 204
```

### Why a JWT _and_ a server-side session

A JWT alone cannot be revoked before it expires. Each token's `jti` is a
session id that must also exist in a Redis allowlist, so logout takes effect
immediately and a replayed cookie is rejected. The allowlist fails closed: a
missing record means "not authenticated". It also gives future features
("sign out everywhere", account suspension) a single place to revoke
sessions.

Token and session share one lifetime: `AUTH_TOKEN_TTL_SECONDS` (default 7
days). There is no refresh-token rotation yet; because sessions are
revocable server-side, that can be added later without changing the
authorization model.

### Token transport and CSRF

- The JWT lives only in an **httpOnly** cookie, so page scripts (including
  injected ones) cannot read it. `Secure` is set when `NODE_ENV=production`.
- `SameSite=Lax` keeps the cookie off cross-site subrequests (e.g. a form
  POST from another site).
- An **Origin check** middleware (`common/security/origin-check.middleware.ts`)
  rejects `POST/PUT/PATCH/DELETE` requests whose `Origin` header is present
  but differs from `CORS_ORIGIN`. This covers same-site-but-cross-origin
  attackers (sibling subdomains) that SameSite does not. Requests with no
  `Origin` (non-browser clients) cannot carry a victim's cookies and proceed
  to normal authentication.
- Deployment constraint: the web app and API must be **same-site** (e.g.
  `app.example.com` + `api.example.com`, or `localhost:3000` +
  `localhost:4000` in development) so the browser sends the cookie on API
  calls.

### Passwords

- Hashed with Node's built-in **scrypt** (`N=2^15, r=8, p=3`, 16-byte salt,
  64-byte key), one of OWASP's recommended scrypt configurations. Stored as
  `scrypt$15$8$3$<salt>$<key>` so parameters can be raised later without
  invalidating existing hashes. Passwords are NFKC-normalised before
  hashing and compared in constant time.
- `argon2` was evaluated first but requires a native build on machines
  without a prebuilt binary; scrypt needs no native addon.
- `passwordHash` is `select: false` on the schema and only loaded by the
  login lookup. Every response is built field by field by a presenter, never
  by serialising a document.
- Policy: 8–128 characters, no composition rules (per NIST SP 800-63B). The
  upper bound caps hashing work per request.

### Account enumeration

- **Login**: unknown email, wrong password, and inactive account all return
  the same `401 Invalid email or password`. An unknown email still runs a
  password verification against a dummy hash, so response time does not
  reveal whether the account exists.
- **Registration**: a duplicate email returns `409`. Hiding this requires
  an email-verification flow ("check your inbox" for every submission),
  which needs the email provider integration; until then, the register
  endpoint's rate limit bounds how fast addresses can be probed.
- **Friend requests by email** return `404` for unknown addresses. This is
  only reachable by authenticated users; per-user rate limiting of this
  endpoint is a follow-up hardening item.

### Rate limiting

`POST /auth/login` and `POST /auth/register` are limited to **10 requests
per 60 seconds per client IP, per route** (`@nestjs/throttler`). Excess
requests get `429` with `Retry-After`. Counters live in Redis
(`rate-limit/redis-throttler.storage.ts`, an atomic Lua script), so the
limit holds across multiple API instances. Behind a reverse proxy, Express
`trust proxy` must be configured so `req.ip` is the client, not the proxy.

## Authorization model

Every route requires authentication unless marked `@Public()` (only
`/health`, `/auth/register`, `/auth/login`, `/auth/logout`). Services
receive the caller's id from `@CurrentUser()` — never from a body, query,
or path parameter — and `forbidNonWhitelisted` validation rejects any
request that tries to supply fields such as `requester`, `ownerId`, `role`
(outside the role endpoint), or `status`.

Resources the caller has no relationship with are reported as **404**, not
403, so their existence is not revealed. **403** is used when the caller can
see the resource but lacks permission for the action.

### Users

- A user can read only their own account (`GET /users/me`). There is no
  endpoint that modifies another user, and no account-update endpoint yet.

### Friendships

| Action                        | Who                                         |
| ----------------------------- | ------------------------------------------- |
| Send request                  | Any user, to another active user (by email) |
| Accept / reject               | The request's addressee only                |
| Cancel a pending request      | The request's requester only                |
| Remove an accepted friendship | Either friend                               |
| List friends / requests       | Only the caller's own                       |

State rules (enforced in `friends/friendship.rules.ts` and by conditional
writes in `FriendsService`):

- No self-requests (`400`).
- One relationship document per pair of users regardless of direction; a
  request while one is pending, or between friends, is `409`. A reverse
  request (B → A while A → B is pending) is `409` with a hint to accept
  instead — it never creates a second relationship.
- After a rejection, the original requester cannot re-send (`409`); the
  user who rejected may later send their own request, which reopens the
  same document.
- Accept/reject/cancel are single conditional updates (e.g. accept matches
  `{ _id, addressee: caller, status: PENDING }`), so authorization and state
  cannot be raced.

### Groups

| Action                            | OWNER | ADMIN        | MEMBER | Non-member |
| --------------------------------- | ----- | ------------ | ------ | ---------- |
| View group and members            | ✓     | ✓            | ✓      | 404        |
| Update name / description         | ✓     | ✓            | 403    | 404        |
| Add a member (must be own friend) | ✓     | ✓            | 403    | 404        |
| Change a role (ADMIN ↔ MEMBER)    | ✓     | 403          | 403    | 404        |
| Remove a member                   | ✓     | MEMBERs only | 403    | 404        |
| Leave                             | 409   | ✓            | ✓      | 404        |

- The matrix lives in `groups/group.permissions.ts` (pure functions, unit
  tested); `GroupsService` applies it after resolving the caller's _active_
  membership.
- **Adding members** requires an accepted friendship between the caller and
  the new member. The friendship check runs before any lookup of the target,
  so probing arbitrary ids reveals nothing about which accounts exist.
- **Owner protection**: nobody can remove the owner, the owner cannot leave,
  and `OWNER` cannot be assigned through the role endpoint. Ownership
  transfer is intentionally not implemented; it needs its own explicit
  design. A partial unique index also guarantees at most one owner per
  group at the database level.
- Leaving or removal sets the membership `status` (`LEFT` / `REMOVED`)
  rather than deleting the row, preserving membership history for future
  expense and balance calculations.

## Known follow-ups

- Email verification and password reset (needs the email provider).
- Refresh-token rotation and "sign out everywhere" (the session store is
  already the revocation point).
- Per-user rate limits on authenticated endpoints such as friend requests.
- Once balances exist: block removing a friend or group member while they
  have a non-zero balance.
