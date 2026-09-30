'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@splitwise/ui';
import { BalanceSummaryCard } from '@/components/dashboard/balance-summary';
import { AppShell } from '@/components/layout/app-shell';
import { useCurrentUser } from '@/hooks/use-auth';

/** Authenticated home: who you are, and the balances derived from your expenses. */
export function DashboardPlaceholder() {
  const { data: user } = useCurrentUser();

  // RequireAuth only renders this once a user is loaded.
  if (!user) {
    return null;
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Welcome, {user.name}</CardTitle>
            <CardDescription>Signed in as {user.email}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            Balances below are calculated by the server from your recorded expenses.
          </CardContent>
        </Card>
        <BalanceSummaryCard />
      </div>
    </AppShell>
  );
}
