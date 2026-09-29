'use client';

import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@splitwise/ui';
import { useCurrentUser, useLogout } from '@/hooks/use-auth';

/**
 * Placeholder authenticated screen: confirms the session end to end. The
 * real dashboard (groups, friends, balances) comes in later phases.
 */
export function DashboardPlaceholder() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const logoutMutation = useLogout();

  // RequireAuth only renders this once a user is loaded.
  if (!user) {
    return null;
  }

  const signOut = () => {
    logoutMutation.mutate(undefined, { onSettled: () => router.replace('/login') });
  };

  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4">
          <span className="text-sm font-semibold text-slate-900">Splitwise</span>
          <Button variant="outline" size="sm" onClick={signOut} disabled={logoutMutation.isPending}>
            {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Welcome, {user.name}</CardTitle>
            <CardDescription>Signed in as {user.email}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            Your groups and friends will appear here.
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
