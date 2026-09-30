'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@splitwise/ui';
import { useLogout } from '@/hooks/use-auth';

/** Header + content frame shared by every authenticated screen. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const logoutMutation = useLogout();

  const signOut = () => {
    logoutMutation.mutate(undefined, { onSettled: () => router.replace('/login') });
  };

  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4">
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/dashboard" className="font-semibold text-slate-900">
              Splitwise
            </Link>
            <Link href="/expenses" className="text-slate-600 hover:text-slate-900">
              Expenses
            </Link>
          </nav>
          <Button variant="outline" size="sm" onClick={signOut} disabled={logoutMutation.isPending}>
            {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">{children}</main>
    </div>
  );
}
