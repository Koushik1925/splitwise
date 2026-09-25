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
- **ExpenseSplit** — how an expense's amount is divided across group
  members.
- **Balance** — a derived, netted view of what one user owes another,
  aggregated across expenses.
- **Settlement** — a concrete, trackable debt between two specific users
  (`fromUser` owes `toUser`) with `originalAmount`, `totalPaid`, and a
  derived `remainingAmount`.
- **Payment** — an immutable, append-only financial record of a single
  payment attempt/confirmation against a settlement. Settlements are never
  edited directly; their `remainingAmount` is recalculated from their
  associated payments.

## Backend module map (planned)

The NestJS backend is organized around these module boundaries. Only a
minimal subset (`Config`, `Health`, `Redis`/`Queue` connection wiring) is
implemented in this foundation phase — the rest are documented here so the
module boundaries are agreed before implementation begins:

| Module        | Responsibility                                              |
| ------------- | ----------------------------------------------------------- |
| Auth          | Authentication, session/JWT issuance, authorization guards  |
| Users         | User profiles and account management                        |
| Friends       | Friend relationships between users                          |
| Groups        | Group creation and membership                               |
| Expenses      | Expense records                                             |
| Splits        | How an expense divides across participants                  |
| Balances      | Derived net-balance views                                   |
| Settlements   | Debt tracking between two users                             |
| Payments      | Immutable payment records and status transitions            |
| UPI           | UPI-specific payment initiation and provider callbacks      |
| Transactions  | Cross-cutting ledger/audit view of money movement           |
| Notifications | Email/SMS/push/in-app notification dispatch                 |
| Reminders     | Scheduled overdue-settlement reminders (Redis/BullMQ)       |
| Preferences   | User-level preferences (notification channels, sound, etc.) |
| Audit Logs    | Immutable log of financial state transitions                |

See [`docs/database/overview.md`](../database/overview.md) for the entities
these modules own and [`docs/api/overview.md`](../api/overview.md) for API
conventions.

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
- **Redis** — connection used for health checks now, and as the BullMQ
  backend for scheduled/background jobs (e.g. reminders) in a later phase.
- **BullMQ** — registered at the connection level only; no queues or
  processors exist yet.
- **Docker Compose** — spins up local MongoDB and Redis for development
  (`docker-compose.yml` at the repo root).
- **GitHub Actions** — CI runs lint, typecheck, test, and build across all
  workspaces on every push/PR to `main` (`.github/workflows/ci.yml`).
