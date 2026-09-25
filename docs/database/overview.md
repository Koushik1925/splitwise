# Database Overview

Datastore: **MongoDB**, accessed via **Mongoose** from `apps/api`. This
document plans entity shapes and relationships; only what's needed for the
health check (a live Mongo connection) is wired up in this phase — no
collections/schemas are implemented yet.

## Entities

| Entity         | Purpose                                                 |
| -------------- | ------------------------------------------------------- |
| `User`         | Account identity, auth credentials, profile             |
| `Friendship`   | A friend relationship between two users                 |
| `Group`        | A named collection of users who share expenses          |
| `GroupMember`  | Membership + role of a user within a group              |
| `Expense`      | An original shared cost, with amount and description    |
| `ExpenseSplit` | How one expense's amount is divided across participants |
| `Balance`      | Derived, netted balance between two users               |
| `Settlement`   | A trackable debt between two users                      |
| `Payment`      | An immutable record of one payment attempt/confirmation |
| `UPIAccount`   | A user's linked UPI handle/account metadata             |
| `Transaction`  | Cross-cutting ledger entry for audit/reporting          |
| `Notification` | A dispatched (or queued) notification to a user         |
| `Reminder`     | Scheduled reminder state for an outstanding settlement  |
| `DeviceToken`  | Push-notification device token for a user               |
| `AuditLog`     | Immutable log entry for a financial state transition    |

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

## Indexing considerations (planned)

- `Settlement`: compound index on `(fromUser, toUser, status)` for balance
  lookups; index on `status` for reminder scheduling queries.
- `Payment`: index on `settlementId`; unique index on
  `(provider, providerTransactionId)` to make provider webhook processing
  idempotent.
- `AuditLog`: index on `(entityType, entityId, createdAt)`.
- `Reminder`: index on `(settlementId)` and `(nextRunAt, status)` for the
  BullMQ scheduler to pick up due reminders efficiently.

## Concurrency safety (planned)

Financial updates (payment status transitions, settlement recalculation)
will use MongoDB transactions (multi-document, within a replica set) or
optimistic concurrency (a `version`/`updatedAt` guard on `Settlement`) so
two concurrent payment confirmations against the same settlement cannot
both apply against a stale `remainingAmount`.
