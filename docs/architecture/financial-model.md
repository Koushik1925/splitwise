# Financial Model (Phase 3)

How expenses become splits and balances, and how that leaves room for
settlements and payments. Rules that govern all financial state are in
[`docs/product/core-rules.md`](../product/core-rules.md); collections are in
[`docs/database/overview.md`](../database/overview.md).

## Three distinct layers

```
Expense (immutable)  →  raw obligations (derived)  →  netted balances (derived)
```

1. **Expense** — the original financial event, stored once and never
   modified. It embeds its splits: who paid, the total, and how much each
   participant owes.
2. **Raw obligations** — directed `debtor → payer` amounts summed per
   `(debtor, creditor, currency, group)`. Read straight off the expenses;
   nothing is netted or simplified.
3. **Netted balances** — for one viewer and one counterparty, what they owe
   minus what the viewer owes them, per currency.

Only layer 1 is stored. Layers 2 and 3 are computed on every read, so they
can never disagree with the expenses.

## Money

- All money is an **integer number of minor units** (paise for INR). No
  floating-point value is ever used for money, in the API or the web app.
- One expense is capped at 10,000,000,000 paise (₹10 crore), so every sum and
  product stays far inside the safe-integer range. Proportional allocation
  additionally uses `BigInt` for its intermediate products.
- Every expense stores its `currency`. Only `INR` is enabled; balances are
  grouped by currency and never summed across currencies.
- Percentages are integer **basis points** (10000 = 100%).

## Split methods

The client sends inputs only; the server computes every `owedMinor`.

| Method       | Client input per participant | Server invariant                           |
| ------------ | ---------------------------- | ------------------------------------------ |
| `EQUAL`      | none                         | proportional allocation with weight 1 each |
| `EXACT`      | `amountMinor` (≥ 1)          | amounts sum to the total exactly           |
| `PERCENTAGE` | `percentageBps` (1–10000)    | basis points sum to exactly 10000          |
| `SHARES`     | `shares` (1–1000)            | proportional allocation by share count     |

Each participant supplies exactly the field for the chosen method; any other
field is rejected. Participants are unique (ids are normalized before the
check). After allocation the server asserts `Σ owedMinor = amountMinor`.

### Rounding: largest remainder

`EQUAL`, `PERCENTAGE` and `SHARES` share one allocator:

1. Each participant's exact share is `total × weight / Σweights`, computed as
   a BigInt quotient and remainder.
2. Everyone gets the floor of their exact share.
3. The leftover paise (always fewer than the participant count) go one each
   to the participants with the largest remainders.
4. Remainder ties break by **ascending user id**, so the result is
   deterministic and independent of the order participants were listed in.

Examples: ₹100.00 among three is 3334 / 3333 / 3333 (the extra paisa goes to
the lowest user id); ₹1.00 split 1:2 is 33 / 67 paise.

## Who pays, who owes

- There is a **single payer** per expense. The payer may or may not be a
  participant: a payer who is listed has their own share stored (their
  consumption), but it creates no obligation.
- A **debtor** is a participant other than the payer with `owedMinor > 0`.
  An expense needs at least one debtor, so a self-only expense is rejected.
- The creator (always the authenticated caller) must be the payer or a
  debtor. Debtor consent is not required in Phase 3.

## Authorization at creation

- **Friend expense** (no `groupId`): the payer and every participant must be
  active users, and every participant must be an accepted friend of the payer.
- **Group expense**: the caller must be an active group member (otherwise
  `404`), and the payer and every participant must be active members (`403`).
  Any role may create.
- Unusable ids (unknown, disabled, not a friend or member) all produce the
  same `403` message so ids cannot be probed.
- Membership and friendship are checked **only at creation**. Later leaving,
  removal or unfriending never invalidates history, and balances stay.

## Idempotency

`POST /expenses` requires an `Idempotency-Key` header (8–128 characters).

- Same creator, same key, same canonical body → the original expense is
  returned (`200`) and nothing new is created.
- Same creator, same key, different body → `409`.
- The unique index on `(createdBy, idempotencyKey)` is the final arbiter.
  Concurrent identical requests all attempt the insert; exactly one wins and
  the rest are served the winner's expense. The canonical body hash ignores
  participant order and id casing.

## Netting

For one viewer and each counterparty, per currency:

```
net = (sum they owe the viewer) − (sum the viewer owes them)
```

Gross amounts are always reported alongside the net, and a per-context
breakdown (friend expenses, each group) is available on the pair detail
endpoint. Only pairs the viewer is a party to are ever loaded.

**No debt simplification.** Netting happens only between the same two users.
A owes B ₹500 and B owes C ₹500 stay two separate debts; they never become
"A owes C". Group-wide pairwise views are out of scope for Phase 3.

## Hand-off to settlements and payments

The Phase 3 schema is not expected to change when settlements arrive:

- Expenses stay immutable; payments and settlements will be separate,
  append-only collections that reference a user pair and currency.
- The balance service will subtract verified payments per pair:
  `remaining = obligations from expenses − verified payments`. A partial
  payment is just another ledger row, so partial settlement needs no change
  to expenses.
- Whether a settlement targets the pair's overall balance or one group's
  balance is a Phase 4 decision; the per-context breakdown supports both.
- If aggregation cost ever becomes a problem, a rebuildable cache can be
  added on top. The expenses remain the source of truth.

## Not in Phase 3

Expense editing or deletion, multiple payers, multi-currency conversion,
debt simplification, disputes, and everything payment-related (settlements,
UPI, cash claims, reminders).
