# Payment Flow

Both flows end the same way: a **Payment** record transitions to an
authoritative terminal state (verified `SUCCESS`, or a recipient
confirmation), which triggers **settlement recalculation**. Nothing before
that point changes a settlement's `remainingAmount`.

## UPI flow

```
Initiate
  → Redirect / deep link to UPI app
  → User returns to our application
  → PENDING (unverified)
  → Backend calls provider verification
  → Provider confirms SUCCESS
  → Payment record updated (status = SUCCESS)
  → Settlement recalculated (remainingAmount -= payment.amount)
  → UI updated (via refetch / event)
```

Step by step:

1. User taps **Pay** on an outstanding settlement.
2. Backend returns the current authoritative `remainingAmount`.
3. Frontend prefills the payment amount with that value, letting the user
   reduce it, but rejects (client-side, then re-validated server-side) any
   amount greater than `remainingAmount`.
4. User selects a UPI method and the backend asks the configured
   `PaymentProvider` to initiate a payment intent, creating a `Payment`
   record with `status = PENDING`.
5. The user is redirected/deep-linked to their UPI app to complete payment.
6. The user returns to our application. The frontend shows a **pending /
   verifying** state — it does not assume success.
7. The backend calls the provider's verification API (and/or waits for its
   webhook) to determine the real outcome.
8. Only a verified `SUCCESS` response updates the `Payment` to `SUCCESS`
   and triggers settlement recalculation. `FAILED`/`CANCELLED` responses
   update the `Payment` accordingly and leave the settlement unchanged.
9. The settlement's `totalPaid` and `remainingAmount` are recomputed from
   its full payment history, never decremented ad hoc.
10. The frontend re-fetches settlement/payment state to reflect the
    authoritative outcome.

**Returning from the UPI app is not proof of payment.** The app returning
control to our frontend only means the user finished (or abandoned) the
UPI app's own flow — it carries no information about whether money moved.
The backend/provider confirmation is the only source of truth, and the UI
must represent the in-between state honestly (pending/verifying) rather
than optimistically marking a payment successful.

## Cash flow

```
Claim
  → Recipient notified
  → Recipient confirms (or rejects)
  → Payment record updated
  → Settlement recalculated (only on confirmation)
```

Step by step:

1. Payer claims they paid an amount in cash, creating a `Payment` record
   with `method = CASH`, `status = PENDING`.
2. The settlement's `remainingAmount` is **not** reduced yet.
3. The recipient is notified (in-app / push, per their notification
   preferences) that a cash payment claim is awaiting confirmation.
4. The recipient reviews the claim and either confirms or rejects it.
5. On confirmation: the `Payment` transitions to `SUCCESS`, and the
   settlement is recalculated exactly as in the UPI flow.
6. On rejection: the `Payment` transitions to `FAILED`/`CANCELLED` and the
   settlement's `remainingAmount` is unchanged.

This is a controlled, two-party payment-confirmation workflow — not a
manual balance edit. Only the recipient's confirmation (a specific,
authorized action on a specific pending claim) can change the settlement,
and only in the direction the claim describes.

## Common invariants

- A settlement's `remainingAmount` is always derived from
  `originalAmount - sum(SUCCESS payments)`. It is never written directly.
- A `Payment` is immutable once it reaches a terminal state
  (`SUCCESS`/`FAILED`/`CANCELLED`/`REFUNDED`); corrections happen via new
  payment records (e.g. a `REFUNDED` payment), never by editing history.
- No frontend-computed amount, status, or ownership claim is trusted by the
  backend — every mutation is re-validated against the current persisted
  state.
