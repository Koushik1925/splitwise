'use client';

import Link from 'next/link';
import type { ExpenseSummary } from '@splitwise/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@splitwise/ui';
import { AppShell } from '@/components/layout/app-shell';
import { useExpenseList } from '@/hooks/use-expenses';
import { formatMinor } from '@/lib/money';

/** Human wording for the caller's position in one expense. */
export function describeYourPosition(expense: ExpenseSummary): { text: string; tone: string } {
  if (expense.yourNetMinor > 0) {
    return { text: `you lent ${formatMinor(expense.yourNetMinor)}`, tone: 'text-emerald-700' };
  }
  if (expense.yourNetMinor < 0) {
    return { text: `you owe ${formatMinor(-expense.yourNetMinor)}`, tone: 'text-red-700' };
  }
  return { text: 'not involved', tone: 'text-slate-500' };
}

export function ExpenseList() {
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useExpenseList();
  const expenses = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <AppShell>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Expenses</CardTitle>
            <CardDescription>Everything you paid for or owe a share of.</CardDescription>
          </div>
          <Link
            href="/expenses/new"
            className="inline-flex h-9 items-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            Add expense
          </Link>
        </CardHeader>
        <CardContent className="text-sm">
          {isPending ? <p className="text-slate-500">Loading expenses…</p> : null}
          {isError ? (
            <p className="text-slate-600">
              Couldn&apos;t load expenses.{' '}
              <button className="underline" onClick={() => refetch()}>
                Try again
              </button>
            </p>
          ) : null}
          {data && expenses.length === 0 ? (
            <p className="text-slate-500">No expenses yet.</p>
          ) : null}
          {expenses.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {expenses.map((expense) => {
                const position = describeYourPosition(expense);
                return (
                  <li key={expense.id}>
                    <Link
                      href={`/expenses/${expense.id}`}
                      className="flex items-center justify-between gap-4 py-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{expense.description}</p>
                        <p className="text-xs text-slate-500">
                          {expense.group ? expense.group.name : 'Friends'} · paid by{' '}
                          {expense.paidBy.name} ·{' '}
                          {new Date(expense.createdAt).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-medium text-slate-900">
                          {formatMinor(expense.amountMinor, expense.currency)}
                        </p>
                        <p className={`text-xs ${position.tone}`}>{position.text}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
