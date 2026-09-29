'use client';

import Link from 'next/link';
import { Button, buttonVariants } from '@splitwise/ui';
import { useApiHealth } from '@/hooks/use-health';

export default function Home() {
  const { data, isLoading, isError, refetch, isFetching } = useApiHealth();

  const apiStatus = isLoading
    ? 'checking...'
    : isError
      ? 'unreachable'
      : (data?.status ?? 'unknown');

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Splitwise</h1>
      <p className="max-w-md text-sm text-slate-500">
        Shared expenses, accurate balances, and verified settlements.
      </p>
      <div className="flex items-center gap-3">
        <Link href="/login" className={buttonVariants()}>
          Sign in
        </Link>
        <Link href="/register" className={buttonVariants({ variant: 'outline' })}>
          Create account
        </Link>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600">
        <span
          className={`h-2 w-2 rounded-full ${
            apiStatus === 'ok'
              ? 'bg-emerald-500'
              : apiStatus === 'checking...'
                ? 'bg-amber-400'
                : 'bg-red-500'
          }`}
        />
        API status: {apiStatus}
      </div>
      <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? 'Checking...' : 'Recheck API'}
      </Button>
    </main>
  );
}
