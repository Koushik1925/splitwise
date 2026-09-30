'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Currency,
  EXPENSE_LIMITS,
  SplitMethod,
  type CreateExpenseParticipant,
  type CreateExpenseRequest,
  type PublicUser,
} from '@splitwise/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@splitwise/ui';
import { FormAlert, TextField } from '@/components/forms/text-field';
import { AppShell } from '@/components/layout/app-shell';
import { useCurrentUser } from '@/hooks/use-auth';
import { useCreateExpense, useFriends, useGroupDetail, useGroups } from '@/hooks/use-expenses';
import { describeExpenseError } from '@/lib/expenses-api';
import { formatMinor, parseAmountToMinor, parsePercentToBps } from '@/lib/money';
import { previewSplit, type PreviewRow } from '@/lib/split-preview';

const METHOD_OPTIONS: Array<{ value: SplitMethod; label: string; unit: string }> = [
  { value: SplitMethod.EQUAL, label: 'Equally', unit: '' },
  { value: SplitMethod.EXACT, label: 'Exact amounts', unit: '₹' },
  { value: SplitMethod.PERCENTAGE, label: 'Percentages', unit: '%' },
  { value: SplitMethod.SHARES, label: 'Shares', unit: 'shares' },
];

const selectClass =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900';

/**
 * Expense entry. Everything shown as a computed share is a PREVIEW: the
 * request carries only the inputs (amount, method, per-person input) and the
 * server recomputes every owed amount. The Idempotency-Key stays the same for
 * an identical retry and rotates as soon as the request changes.
 */
export function ExpenseForm() {
  const router = useRouter();
  const { data: me } = useCurrentUser();
  const friendsQuery = useFriends();
  const groupsQuery = useGroups();
  const createMutation = useCreateExpense();
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [groupId, setGroupId] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [method, setMethod] = useState<SplitMethod>(SplitMethod.EQUAL);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const groupQuery = useGroupDetail(groupId || null);

  const people: PublicUser[] = useMemo(() => {
    if (!me) return [];
    if (groupId) {
      return (groupQuery.data?.members ?? []).map((member) => member.user);
    }
    const self: PublicUser = { id: me.id, name: me.name, email: me.email };
    return [self, ...(friendsQuery.data ?? []).map((friend) => friend.user)];
  }, [me, groupId, groupQuery.data, friendsQuery.data]);

  const payerId = paidBy || me?.id || '';
  const totalMinor = parseAmountToMinor(amountText);
  const chosen = people.filter((person) => selected[person.id]);

  const preview = useMemo(() => {
    if (totalMinor === null) return null;
    const rows: PreviewRow[] = chosen.map((person) => {
      const text = values[person.id] ?? '';
      let value: number | null = null;
      if (method === SplitMethod.EXACT) value = parseAmountToMinor(text);
      if (method === SplitMethod.PERCENTAGE) value = parsePercentToBps(text);
      if (method === SplitMethod.SHARES) {
        const shares = Number(text);
        value = Number.isInteger(shares) && shares >= 1 ? shares : null;
      }
      return { userId: person.id, value };
    });
    return previewSplit(method, totalMinor, rows);
    // `chosen` is derived from people + selected, listed via those inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, totalMinor, people, selected, values]);

  const changeGroup = (next: string) => {
    setGroupId(next);
    setPaidBy('');
    setSelected({});
    setValues({});
  };

  const buildRequest = (): CreateExpenseRequest | string => {
    if (!description.trim()) return 'Enter a description.';
    if (totalMinor === null) {
      return 'Enter a valid amount with at most two decimals (for example 900 or 249.50).';
    }
    if (chosen.length === 0) return 'Choose who is sharing this expense.';
    if (!chosen.some((person) => person.id !== payerId)) {
      return 'At least one person other than the payer must share the expense.';
    }

    const participants: CreateExpenseParticipant[] = [];
    for (const person of chosen) {
      const text = values[person.id] ?? '';
      if (method === SplitMethod.EQUAL) {
        participants.push({ userId: person.id });
      } else if (method === SplitMethod.EXACT) {
        const amountMinor = parseAmountToMinor(text);
        if (amountMinor === null) return `Enter a valid amount for ${person.name}.`;
        participants.push({ userId: person.id, amountMinor });
      } else if (method === SplitMethod.PERCENTAGE) {
        const percentageBps = parsePercentToBps(text);
        if (percentageBps === null) return `Enter a valid percentage for ${person.name}.`;
        participants.push({ userId: person.id, percentageBps });
      } else {
        const shares = Number(text);
        if (
          !Number.isInteger(shares) ||
          shares < 1 ||
          shares > EXPENSE_LIMITS.maxSharesPerParticipant
        ) {
          return `Enter a whole number of shares for ${person.name}.`;
        }
        participants.push({ userId: person.id, shares });
      }
    }
    if (method === SplitMethod.EXACT) {
      const sum = participants.reduce((acc, p) => acc + (p.amountMinor ?? 0), 0);
      if (sum !== totalMinor) {
        return `Exact amounts add up to ${formatMinor(sum)}, but the total is ${formatMinor(totalMinor)}.`;
      }
    }
    if (method === SplitMethod.PERCENTAGE) {
      const sum = participants.reduce((acc, p) => acc + (p.percentageBps ?? 0), 0);
      if (sum !== EXPENSE_LIMITS.percentageTotalBps) {
        return `Percentages add up to ${(sum / 100).toFixed(2)}%; they must total 100%.`;
      }
    }

    return {
      ...(groupId ? { groupId } : {}),
      description: description.trim(),
      amountMinor: totalMinor,
      currency: Currency.INR,
      ...(payerId !== me?.id ? { paidBy: payerId } : {}),
      splitMethod: method,
      participants,
    };
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const request = buildRequest();
    if (typeof request === 'string') {
      setFormError(request);
      return;
    }
    // Same body as the last attempt -> same key (a safe retry); otherwise a new one.
    const serialized = JSON.stringify(request);
    if (attempt.current?.body !== serialized) {
      attempt.current = { body: serialized, key: crypto.randomUUID() };
    }
    createMutation.mutate(
      { body: request, key: attempt.current.key },
      { onSuccess: (expense) => router.push(`/expenses/${expense.id}`) },
    );
  };

  const unit = METHOD_OPTIONS.find((option) => option.value === method)?.unit ?? '';
  const isSubmitting = createMutation.isPending || createMutation.isSuccess;

  return (
    <AppShell>
      <Card>
        <CardHeader>
          <CardTitle>Add expense</CardTitle>
          <CardDescription>
            Amounts are calculated and verified by the server. Recorded expenses can&apos;t be
            edited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            {formError ? <FormAlert>{formError}</FormAlert> : null}
            {createMutation.isError ? (
              <FormAlert>{describeExpenseError(createMutation.error)}</FormAlert>
            ) : null}

            <TextField
              id="description"
              label="Description"
              maxLength={EXPENSE_LIMITS.descriptionMaxLength}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <TextField
              id="amount"
              label="Total amount (₹)"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="group" className="text-sm font-medium text-slate-900">
                  Shared with
                </label>
                <select
                  id="group"
                  className={selectClass}
                  value={groupId}
                  onChange={(event) => changeGroup(event.target.value)}
                >
                  <option value="">Friends (no group)</option>
                  {(groupsQuery.data ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="payer" className="text-sm font-medium text-slate-900">
                  Paid by
                </label>
                <select
                  id="payer"
                  className={selectClass}
                  value={payerId}
                  onChange={(event) => setPaidBy(event.target.value)}
                >
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.id === me?.id ? 'You' : person.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="method" className="text-sm font-medium text-slate-900">
                Split
              </label>
              <select
                id="method"
                className={selectClass}
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value as SplitMethod);
                  setValues({});
                }}
              >
                {METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-slate-900">Who is sharing?</legend>
              {people.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {groupId
                    ? 'Loading group members…'
                    : 'Add friends (through the API for now) to share expenses with them.'}
                </p>
              ) : null}
              {people.map((person) => {
                const isSelected = Boolean(selected[person.id]);
                const share = preview?.get(person.id);
                return (
                  <div key={person.id} className="flex items-center gap-3 text-sm">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) =>
                          setSelected((current) => ({
                            ...current,
                            [person.id]: event.target.checked,
                          }))
                        }
                      />
                      <span className="truncate text-slate-900">
                        {person.id === me?.id ? 'You' : person.name}
                      </span>
                    </label>
                    {isSelected && method !== SplitMethod.EQUAL ? (
                      <input
                        aria-label={`${person.name} ${unit}`}
                        className="h-9 w-28 rounded-md border border-slate-200 px-2 text-right text-sm"
                        inputMode="decimal"
                        placeholder={unit}
                        value={values[person.id] ?? ''}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [person.id]: event.target.value }))
                        }
                      />
                    ) : null}
                    {isSelected && share !== undefined ? (
                      <span className="w-24 text-right text-slate-500" title="Preview only">
                        ≈ {formatMinor(share)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              <p className="text-xs text-slate-500">
                Shares shown with ≈ are a preview. The server calculates the final amounts.
              </p>
            </fieldset>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save expense'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
