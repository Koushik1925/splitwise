# Database Overview

Datastore: **MongoDB**, accessed via **Mongoose** from `apps/api`. The
identity and social collections (`users`, `friendships`, `groups`,
`group_members`) are implemented as of Phase 2 — see
[Implemented collections](#implemented-collections-phase-2). Everything
else in this document is the plan for later phases.

## Entities

| Entity         | Purpose                                                 | Status      |
| -------------- | ------------------------------------------------------- | ----------- |
| `User`         | Account identity, auth credentials, profile             | Implemented |
| `Friendship`   | A friend relationship between two users                 | Implemented |
| `Group`        | A named collection of users who share expenses          | Implemented |
| `GroupMember`  | Membership + role of a user within a group              | Implemented |
| `Expense`      | An original shared cost, with amount and description    | Planned     |
| `ExpenseSplit` | How one expense's amount is divided across participants | Planned     |
| `Balance`      | Derived, netted balance between two users               | Planned     |
| `Settlement`   | A trackable debt between two users                      | Planned     |
| `Payment`      | An immutable record of one payment attempt/confirmation | Planned     |
| `UPIAccount`   | A user's linked UPI handle/account metadata             | Planned     |
| `Transaction`  | Cross-cutting ledger entry for audit/reporting          | Planned     |
| `Notification` | A dispatched (or queued) notification to a user         | Planned     |
| `Reminder`     | Scheduled reminder state for an outstanding settlement  | Planned     |
| `DeviceToken`  | Push-notification device token for a user               | Planned     |
| `AuditLog`     | Immutable log entry for a financial state transition    | Planned     |

Sessions and rate-limit counters are not MongoDB entities: they live in
Redis with TTLs (see [`docs/architecture/auth.md`](../architecture/auth.md)).

## Relationships

```
User ─┬───< Friendship >───┬─ User
      │
      ├───< GroupMember >──── Group
      │
      ├───< Expense (paidBy) 1───< ExpenseSplit >───1 User (owedBy)
      │
      ├───< Balance (userA/userB, netted)
      │
      ├───< Settlement (fromUser/toUser) 1───< Payment
      │                                         │
      │                                         ├─ method = UPI  → UPIAccount (payer's linked account, optional)
      │                                         └─ providerTransactionId (external reference)
      │
      ├───< Reminder >──── Settlement (one active reminder cycle per open settlement)
      │
      ├───< Notification
      ├───< DeviceToken
      └───< AuditLog >──── (references any of the above entities by type + id)

Group 1───< Expense
Group 1───< GroupMember >───1 User
```

Notes:

- `ExpenseSplit` rows always sum back to their parent `Expense.amount` —
  this is enforced at write time, not derived after the fact.
- `Balance` is a materialized, netted view (per user pair) kept in sync as
  expenses/payments change; `Settlement` is the concrete, actionable debt
  derived from it that payments apply against.
- `Settlement.remainingAmount` is always `originalAmount - sum(Payment
where status = SUCCESS)`. It is a derived/cached field, recalculated by
  the backend on every relevant payment transition — never written by a
  client request.
- `Payment` is append-only. A correction (e.g. a refund) is a new `Payment`
  row referencing the same `settlementId`, not an edit to an existing row.
- `AuditLog` records every financial state transition (who/what/when/old →
  new) for `Settlement` and `Payment` changes, independent of the
  collections themselves, so history survives even if a document is later
  reshaped.
- `User` and `Group` carry **no financial fields** (no balances, no
  amount-owed totals). Financial state is always derived from expenses and
  settlements by the balance engine.

## Implemented collections (Phase 2)

Schemas live in `apps/api/src/*/schemas/`. All four collections use
Mongoose `timestamps` (`createdAt`, `updatedAt`). Ids are `ObjectId`s.

### `users`

| Field          | Type                  | Notes                                                     |
| -------------- | --------------------- | --------------------------------------------------------- |
| `name`         | string (1–100)        | Trimmed                                                   |
| `email`        | string (≤254)         | Trimmed, stored lowercased; unique                        |
| `passwordHash` | string                | scrypt hash; `select: false`, never included in responses |
| `status`       | `ACTIVE` / `DISABLED` | Only `ACTIVE` users can sign in or be found by others     |

There is no avatar/profile-image field yet: Phase 2 has no profile-editing
flow, so the field would always be empty.

### `friendships`

One document per **unordered pair** of users, whatever its state.

| Field         | Type                                | Notes                                         |
| ------------- | ----------------------------------- | --------------------------------------------- |
| `userA`       | ObjectId → users                    | Participant whose id sorts first (immutable)  |
| `userB`       | ObjectId → users                    | Participant whose id sorts second (immutable) |
| `requester`   | ObjectId → users                    | Who sent the current request                  |
| `addressee`   | ObjectId → users                    | Who may accept or reject it                   |
| `status`      | `PENDING` / `ACCEPTED` / `REJECTED` |                                               |
| `requestedAt` | Date                                | When the current request was sent             |
| `respondedAt` | Date or null                        | When it was accepted or rejected              |

Direction is stored twice on purpose. `userA`/`userB` are the canonical,
order-independent pair: A → B and B → A map to the same `(userA, userB)`,
and the unique index on that pair means two relationships between the same
users cannot exist — even under concurrent requests in opposite directions.
`requester`/`addressee` record who acted, which drives authorization. A
`pre('validate')` hook rejects documents whose pair is not canonically
ordered or whose requester/addressee are not the pair.

`BLOCKED` is not in the enum yet: blocking needs its own semantics (who
blocked whom, visibility, unblocking) and no block feature is in scope.
Adding a value later is backwards-compatible.

Accepted friendships are deleted on removal; pending requests are deleted
on cancellation. `REJECTED` documents are kept so the rejected requester
cannot immediately re-send.

### `groups`

| Field         | Type             | Notes                                          |
| ------------- | ---------------- | ---------------------------------------------- |
| `name`        | string (1–100)   | Trimmed                                        |
| `description` | string (0–500)   | Trimmed; empty string when unset               |
| `createdBy`   | ObjectId → users | Immutable provenance — **not** used for access |

Ownership is deliberately not stored on the group: it lives in
`group_members.role`, the single source of truth for access, so the two can
never disagree.

### `group_members`

| Field       | Type                          | Notes                                  |
| ----------- | ----------------------------- | -------------------------------------- |
| `group`     | ObjectId → groups             | Immutable                              |
| `user`      | ObjectId → users              | Immutable                              |
| `role`      | `OWNER` / `ADMIN` / `MEMBER`  |                                        |
| `status`    | `ACTIVE` / `LEFT` / `REMOVED` | Only `ACTIVE` rows grant access        |
| `joinedAt`  | Date                          | Start of the current membership period |
| `addedBy`   | ObjectId → users, or null     | null for the creator                   |
| `endedAt`   | Date or null                  | When the member left or was removed    |
| `removedBy` | ObjectId → users, or null     | Set only for `REMOVED`                 |

Rows are never deleted. Leaving or removal changes `status`, preserving the
fact that someone was a member (needed later for expense history and
balances). Re-adding a former member reactivates the same row.

### Implemented relationships

```
users 1───< friendships >───1 users     (userA / userB, one document per pair)
users 1───< group_members >───1 groups  (role + status per membership)
groups.createdBy ──► users               (provenance only)
```

### Indexes

| Collection      | Index                                        | Why                                                                              |
| --------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `users`         | `{ email: 1 }` unique                        | One account per (lowercased) email; login lookup                                 |
| `friendships`   | `{ userA: 1, userB: 1 }` unique              | One relationship per pair in either direction; serves lookups where user = userA |
| `friendships`   | `{ userB: 1, status: 1 }`                    | Lookups where user = userB (friend lists, incoming/outgoing requests)            |
| `group_members` | `{ group: 1, user: 1 }` unique               | Prevents duplicate membership; serves "members of a group" via its prefix        |
| `group_members` | `{ user: 1, status: 1 }`                     | "Groups this user belongs to"                                                    |
| `group_members` | `{ group: 1 }` unique, partial `role: OWNER` | At most one owner per group, enforced by the database                            |

There are no separate indexes on `requester`/`addressee`: "friendships
involving user X" queries are written as
`$or: [{ userA: X, … }, { userB: X, … }]`, with the remaining filters
pushed into both branches, so each branch uses one of the two indexes
above. `groups` needs only `_id`.

Indexes are declared on the schemas and built by Mongoose at startup
(`autoIndex`). Before production traffic, consider building them via a
migration step instead.

### Write consistency

The local MongoDB deployment are standalone (no replica set), so
multi-document transactions are not available. Phase 2 relies on:

- **unique indexes** for invariants that must hold under concurrency
  (duplicate emails, duplicate friendships, duplicate memberships, single
  owner), with duplicate-key errors translated to `409`;
- **conditional single-document updates** whose filter restates the
  authorization and state preconditions (e.g. accept only matches
  `{ addressee: caller, status: PENDING }`);
- a **compensating delete** when creating a group: if inserting the owner
  membership fails, the just-created group is removed.

## Settlement (planned shape)

```ts
{
  fromUser: ObjectId; // who owes
  toUser: ObjectId; // who is owed
  originalAmount: number; // smallest currency unit (paise)
  totalPaid: number; // derived: sum of SUCCESS payments
  remainingAmount: number; // derived: originalAmount - totalPaid
  status: SettlementStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

## Payment (planned shape)

```ts
{
  settlementId: ObjectId;
  payer: ObjectId;
  receiver: ObjectId;
  amount: number;
  method: PaymentMethod;              // UPI | CASH
  provider?: string;                  // e.g. "mock-upi"
  providerTransactionId?: string;
  status: PaymentStatus;              // see packages/shared/src/enums.ts
  createdAt: Date;
  completedAt?: Date;
}
```

## Indexing considerations (planned, later phases)

- `Settlement`: compound index on `(fromUser, toUser, status)` for balance
  lookups; index on `status` for reminder scheduling queries.
- `Payment`: index on `settlementId`; unique index on
  `(provider, providerTransactionId)` to make provider webhook processing
  idempotent.
- `AuditLog`: index on `(entityType, entityId, createdAt)`.
- `Reminder`: index on `(settlementId)` and `(nextRunAt, status)` for the
  BullMQ scheduler to pick up due reminders efficiently.

## Concurrency safety (planned, financial writes)

Financial updates (payment status transitions, settlement recalculation)
will use MongoDB transactions (multi-document, within a replica set) or
optimistic concurrency (a `version`/`updatedAt` guard on `Settlement`) so
two concurrent payment confirmations against the same settlement cannot
both apply against a stale `remainingAmount`.
