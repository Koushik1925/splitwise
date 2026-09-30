# Architecture Overview

## Monorepo layout

```
apps/
  web/        Next.js frontend (App Router, TypeScript, Tailwind, shadcn/ui)
  api/        NestJS backend (TypeScript, MongoDB/Mongoose, Redis/BullMQ)

packages/
  shared/     Framework-agnostic types, enums, and constants used by both apps
  ui/         Shared shadcn/ui-based component library
  config/     Shared TypeScript and ESLint base configuration

docs/
  architecture/  System-level design docs (this folder)
  database/      Entity/schema design docs
  api/           API module and convention docs
  product/       Product/business rules docs
```

Package management uses native **npm workspaces** (no additional monorepo
tool such as Turborepo/Nx was introduced — the workspace graph is small
enough that plain `npm run <script> --workspaces` scripts, wired at the
root `package.json`, are sufficient and keep the dependency list minimal).

## Core principle: the backend is the source of truth

No client is ever trusted to report or mutate financial state. The frontend
may only **initiate** actions (create an expense, start a UPI payment, claim
a cash payment). Every field that represents money — balances, settlement
status, payment status, remaining amount — is computed and persisted only by
the backend, and only in response to a verified event (a provider webhook /
verification call, or an explicit confirmation action by the correct
counterparty). See [`docs/product/core-rules.md`](../product/core-rules.md)
for the full rule set and [`payment-flow.md`](./payment-flow.md) for the
verification sequence.

## Domain model chain

```
Expense → ExpenseSplit → Balance → Settlement → Payment → Remaining Balance
```

Each stage is a distinct, separately persisted concept:

- **Expense** — the original amount and description. Immutable once
  payments start applying against the settlements it produced.
- **ExpenseSplit** — how an expense's amount is divided across its
  participants. Embedded in the expense document (Phase 3).
- **Balance** — a derived, netted view of what one user owes another,
  aggregated across expenses. Computed on read; not stored (Phase 3). See
  [`financial-model.md`](./financial-model.md).
- **Settlement** — a concrete, trackable debt between two specific users
  (`fromUser` owes `toUser`) with `originalAmount`, `totalPaid`, and a
  derived `remainingAmount`.
- **Payment** — an immutable, append-only financial record of a single
  payment attempt/confirmation against a settlement. Settlements are never
  edited directly; their `remainingAmount` is recalculated from their
  associated payments.

## Backend module map

The NestJS backend is organized around these module boundaries. The
foundation phase implemented `Config`, `Health`, and the `Redis`/`Queue`
connection wiring; Phase 2 implemented the identity and social modules
(Auth, Users, Friends, Groups) plus rate limiting. The rest are documented
here so the module boundaries are agreed before implementation begins:

| Module        | Responsibility                                              | Status      |
| ------------- | ----------------------------------------------------------- | ----------- |
| Auth          | Authentication, session/JWT issuance, authorization guards  | Implemented |
| Users         | User profiles and account management                        | Implemented |
| Friends       | Friend relationships between users                          | Implemented |
| Groups        | Group creation and membership                               | Implemented |
| Expenses      | Immutable expense records, with embedded splits             | Implemented |
| Splits        | Part of Expenses: splits are embedded, not a module         | Implemented |
| Balances      | Net balances derived on read from expenses                  | Implemented |
| Settlements   | Debt tracking between two users                             | Planned     |
| Payments      | Immutable payment records and status transitions            | Planned     |
| UPI           | UPI-specific payment initiation and provider callbacks      | Planned     |
| Transactions  | Cross-cutting ledger/audit view of money movement           | Planned     |
| Notifications | Email/SMS/push/in-app notification dispatch                 | Planned     |
| Reminders     | Scheduled overdue-settlement reminders (Redis/BullMQ)       | Planned     |
| Preferences   | User-level preferences (notification channels, sound, etc.) | Planned     |
| Audit Logs    | Immutable log of financial state transitions                | Planned     |

Within a module, controllers only translate HTTP to service calls; business
rules live in services and in small pure rule modules
(`friends/friendship.rules.ts`, `groups/group.permissions.ts`) that are
unit-tested on their own. Responses are built by presenter functions, never
by serialising database documents.

See [`docs/architecture/auth.md`](./auth.md) for the authentication flow
and authorization rules, [`docs/database/overview.md`](../database/overview.md)
for the entities these modules own, and
[`docs/api/overview.md`](../api/overview.md) for API conventions and routes.

## Payment provider abstraction

The settlement/payment engine never depends directly on a specific UPI
provider (Google Pay, PhonePe, Paytm, etc.). All provider interaction goes
through a `PaymentProvider` interface (initiate, verify, handle webhook).
This phase only documents the abstraction; the concrete `MockUPIProvider`
implementation is planned for the next phase, once the Payments/UPI modules
are built.

## Sound feedback abstraction

The product will eventually give subtle, optional audio feedback for key
events (`expense-added`, `payment-started`, `payment-success`,
`partial-payment`, `settlement-complete`, `payment-failed`). Only the
interface exists so far — see
[`packages/shared/src/sound.ts`](../../packages/shared/src/sound.ts). No
audio assets or playback implementation have been added yet.

## Infrastructure

- **MongoDB** — primary datastore, accessed via Mongoose from `apps/api`.
- **Redis** — health checks, the auth session allowlist
  (`auth:session:<id>`), and rate-limit counters (`throttle:*`); it will
  also back BullMQ scheduled/background jobs (e.g. reminders) in a later
  phase.
- **BullMQ** — registered at the connection level only; no queues or
  processors exist yet.
- **Docker Compose** — spins up local MongoDB and Redis for development
  (`docker-compose.yml` at the repo root).
- **Testing & deployment** — manual. There is no CI/CD pipeline; checks
  are run locally and deployment is done by hand.
