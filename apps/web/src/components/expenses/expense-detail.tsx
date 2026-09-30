'use client';

import Link from 'next/link';
import { SplitMethod } from '@splitwise/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@splitwise/ui';
import { AppShell } from '@/components/layout/app-shell';
import { describeYourPosition } from '@/components/expenses/expense-list';
import { useExpense } from '@/hooks/use-expenses';
import { ApiError } from '@/lib/api-client';
import { formatMinor } from '@/lib/money';

const METHOD_LABEL: Record<SplitMethod, string> = {
  [SplitMethod.EQUAL]: 'Split equally',
  [SplitMethod.EXACT]: 'Exact amounts',
  [SplitMethod.PERCENTAGE]: 'By percentage',
  [SplitMethod.SHARES]: 'By shares',
};

/** Shows the input a person originally entered, in the unit of the split method. */
function describeInput(method: SplitMethod, input: number | null): string | null {
  if (input === null) return null;
  if (method === SplitMethod.PERCENTAGE) return `${(input / 100).toFixed(2)}%`;
  if (method === SplitMethod.SHARES) return `${input} ${input === 1 ? 'share' : 'shares'}`;
  return null;
}

export function ExpenseDetailView({ expenseId }: { expenseId: string }) {
  const { data: expense, isPending, error } = useExpense(expenseId);

  if (isPending) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading expense…</p>
      </AppShell>
    );
  }
  if (error || !expense) {
    return (
      <AppShell>
        <p className="text-sm text-slate-600">
          {error instanceof ApiError && error.status === 404
            ? 'This expense was not found.'
            : "Couldn't load this expense."}{' '}
          <Link href="/expenses" className="underline">
            Back to expenses
          </Link>
        </p>
      </AppShell>
    );
  }

  const position = describeYourPosition(expense);
  return (
    <AppShell>
      <Card>
        <CardHeader>
          <CardTitle>{expense.description}</CardTitle>
          <CardDescription>
            {expense.group ? expense.group.name : 'Friends'} · {METHOD_LABEL[expense.splitMethod]} ·{' '}
            {new Date(expense.createdAt).toLocaleString('en-IN')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 text-sm">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Total</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {formatMinor(expense.amountMinor, expense.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Paid by</dt>
              <dd className="text-slate-900">{expense.paidBy.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Recorded by</dt>
              <dd className="text-slate-900">{expense.createdBy.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Your position</dt>
              <dd className={position.tone}>{position.text}</dd>
            </div>
          </dl>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Who owes what</h2>
            <ul className="divide-y divide-slate-100">
              {expense.splits.map((split) => {
                const input = describeInput(expense.splitMethod, split.input);
                return (
                  <li key={split.user.id} className="flex items-center justify-between py-2">
                    <span className="text-slate-900">
                      {split.user.name}
                      {input ? <span className="ml-2 text-xs text-slate-500">{input}</span> : null}
                    </span>
                    <span className="text-slate-900">
                      {formatMinor(split.owedMinor, expense.currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Amounts are calculated by the server. Expenses cannot be edited once recorded.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
