# Core Product Rules

## The core financial rule

Users must **never** be able to manually modify financial state. A user
cannot:

- manually mark a settlement as paid
- manually change a balance
- manually edit payment status
- manually increase/decrease amount owed
- manually mark a UPI payment successful
- manually delete a successful payment
- manually settle a debt

Users can only **initiate** valid actions (create an expense, start a
payment, claim a cash payment, confirm a cash payment they received). The
backend is the source of truth for every financial field, and recomputes
state from verified events, never from client-asserted values.

## Domain model chain

```
Expense → Expense Split → Balance → Settlement → Payment → Remaining Balance
```

Example:

```
Expense = ₹500
Rahul owes = ₹500

Payment 1 = ₹200 → Remaining = ₹300
Payment 2 = ₹100 → Remaining = ₹200
Payment 3 = ₹200 → Remaining = ₹0
```

The original expense (₹500) never changes — only the settlement's
`remainingAmount`, derived from its payment history, moves.

## UPI payment flow (business rules)

1. User owes ₹300 and clicks **Pay**.
2. The app fetches the current authoritative outstanding amount.
3. It prefills ₹300, but allows the user to enter a smaller amount.
4. It prevents entering an amount greater than the outstanding amount
   (validated both client- and server-side).
5. User selects a UPI/payment method and payment is initiated.
6. User is redirected/deep-linked to their UPI app.
7. User returns to our application.
8. The app shows a payment verification/pending state — **not** success.
9. The backend verifies the payment through the payment provider.
10. Only a verified `SUCCESS` result changes the settlement.
11. The settlement is recalculated from its payment history.

Example: Outstanding = ₹300, verified payment = ₹200 → remaining = ₹100.
The original expense remains unchanged throughout.

**Returning from a UPI app is not proof of payment success.** Only the
backend/provider confirmation is the source of truth. See
[`docs/architecture/payment-flow.md`](../architecture/payment-flow.md) for
the full sequence.

## Cash payment flow (business rules)

Cash has no automatic external verification. If a user claims they paid
₹200 in cash:

1. A cash payment claim is created.
2. The balance is **not** immediately reduced.
3. The recipient is notified.
4. The recipient can confirm they received the cash.
5. Only recipient confirmation changes the settlement.
6. If rejected, the outstanding amount remains unchanged.

This is a controlled payment-confirmation workflow, not a manual balance
edit — the only user-controllable input is the recipient's yes/no on a
specific pending claim.

## Reminders

If an outstanding settlement remains unpaid for 7 days, reminders start
(email, SMS, push/in-app), then repeat daily while the debt remains
outstanding. A partial payment updates the amount future reminders use:

```
₹300 outstanding
₹200 verified payment
₹100 remaining
→ future reminders reference ₹100
```

When remaining reaches ₹0: reminders stop, the settlement becomes
`COMPLETED`, and a settlement-completion event is emitted. Scheduling uses
Redis + BullMQ — never an in-process `setInterval`.

## UX principle

Keep the UI clean and professional. No jokes, quotes, motivational
messages, or unnecessary gamification. Sounds may provide subtle feedback
for important actions (see
[`packages/shared/src/sound.ts`](../../packages/shared/src/sound.ts) for
the event list) — nothing louder or more playful than that.
