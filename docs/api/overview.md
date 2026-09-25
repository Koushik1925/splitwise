# API Overview

Backend: **NestJS**, TypeScript, currently exposing only a health endpoint.
This document defines the conventions and planned module surface for when
feature modules are implemented.

## Current surface (this phase)

| Method | Path      | Purpose                                                                 |
| ------ | --------- | ----------------------------------------------------------------------- |
| `GET`  | `/health` | Liveness/readiness check (MongoDB + Redis pings via `@nestjs/terminus`) |

## Conventions (planned, for when feature modules land)

- **Base path**: all feature routes will be versioned under `/api/v1`.
- **Auth**: JWT bearer tokens; `Auth` module issues/validates them. No
  endpoint trusts a client-supplied user id — the authenticated principal
  always comes from the verified token.
- **Validation**: every request body is validated with a DTO
  (`class-validator` or Zod, via a global `ValidationPipe`) — see
  `apps/api/src/main.ts`, which already enables
  `whitelist`/`forbidNonWhitelisted`/`transform`.
- **Idempotency**: mutating endpoints that trigger financial state changes
  (payment initiation, provider webhooks) will require/accept an
  idempotency key so retried requests can't double-apply a payment.
- **Webhook verification**: provider webhook endpoints (UPI provider
  callbacks) will verify a signature/secret before trusting any payload,
  and will re-fetch/re-verify status from the provider rather than trusting
  the webhook body alone for the final state transition.
- **Rate limiting**: sensitive endpoints (auth, payment initiation) will be
  rate-limited per user/IP.
- **Error shape**: standard Nest HTTP exception JSON body
  (`{ statusCode, message, error }`) — mirrored in
  `packages/shared/src/types.ts` as `ApiErrorBody`.
- **Audit logging**: every endpoint that mutates a `Settlement` or
  `Payment` writes an `AuditLog` entry as part of the same operation.

## Planned module → route surface

| Module        | Example routes (planned)                                              |
| ------------- | --------------------------------------------------------------------- |
| Auth          | `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`                |
| Users         | `GET /api/v1/users/me`                                                |
| Friends       | `GET/POST /api/v1/friends`                                            |
| Groups        | `GET/POST /api/v1/groups`, `POST /api/v1/groups/:id/members`          |
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

None of these routes exist yet — they are documented here so the module
boundaries are agreed before implementation, per
[`docs/architecture/overview.md`](../architecture/overview.md).

## Client access (frontend)

`apps/web/src/lib/api-client.ts` provides a small `fetch` wrapper
(`apiClient.get/post/patch/delete`) used together with TanStack Query. It
never assumes success from a redirect/return — see
[`docs/architecture/payment-flow.md`](../architecture/payment-flow.md).
