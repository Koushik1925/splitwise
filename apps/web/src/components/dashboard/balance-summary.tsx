'use client';

import Link from 'next/link';
import { BalanceDirection } from '@splitwise/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@splitwise/ui';
import { useBalances } from '@/hooks/use-expenses';
import { formatMinor } from '@/lib/money';

/** Read-only view of the balances the server derived from expenses. */
export function BalanceSummaryCard() {
  const { data, isPending, isError, refetch } = useBalances();

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Balances</CardTitle>
          <CardDescription>What you are owed and what you owe, netted per person.</CardDescription>
        </div>
        <Link
          href="/expenses/new"
          className="inline-flex h-9 items-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          Add expense
        </Link>
      </CardHeader>
      <CardContent className="text-sm">
        {isPending ? <p className="text-slate-500">Loading balances…</p> : null}
        {isError ? (
          <p className="text-slate-600">
            Couldn&apos;t load balances.{' '}
            <button className="underline" onClick={() => refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        {data && data.balances.length === 0 ? (
          <p className="text-slate-500">You&apos;re all settled up — no outstanding balances.</p>
        ) : null}
        {data && data.balances.length > 0 ? (
          <div className="flex flex-col gap-4">
            {data.totals.map((total) => (
              <dl key={total.currency} className="grid grid-cols-3 gap-3">
                <Stat label="You are owed" value={formatMinor(total.owedToYouMinor)} />
                <Stat label="You owe" value={formatMinor(total.youOweMinor)} />
                <Stat label="Net" value={formatMinor(total.netMinor)} />
              </dl>
            ))}
            <ul className="divide-y divide-slate-100">
              {data.balances.map((balance) => (
                <li
                  key={`${balance.counterparty.id}-${balance.currency}`}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-slate-900">{balance.counterparty.name}</span>
                  <span
                    className={
                      balance.direction === BalanceDirection.THEY_OWE_YOU
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }
                  >
                    {balance.direction === BalanceDirection.THEY_OWE_YOU
                      ? `owes you ${formatMinor(balance.amountMinor)}`
                      : `you owe ${formatMinor(balance.amountMinor)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-base font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
