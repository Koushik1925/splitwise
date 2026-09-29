'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@splitwise/ui';
import { useCurrentUser } from '@/hooks/use-auth';

/**
 * Client-side gate for authenticated screens: renders children only once the
 * API confirms a session, and sends signed-out visitors to /login.
 *
 * This is navigation UX, not a security boundary — the API rejects every
 * unauthenticated or unauthorized request regardless of what the UI shows.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: user, isPending, isError, refetch, isFetching } = useCurrentUser();
  const isSignedOut = !isPending && !isError && user === null;

  useEffect(() => {
    if (isSignedOut) {
      router.replace('/login');
    }
  }, [isSignedOut, router]);

  if (isError) {
    return (
      <CenteredStatus>
        <p>We couldn&apos;t reach the server.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          Try again
        </Button>
      </CenteredStatus>
    );
  }

  if (isPending || isSignedOut) {
    return (
      <CenteredStatus>
        <p aria-live="polite">{isSignedOut ? 'Redirecting to sign in…' : 'Loading…'}</p>
      </CenteredStatus>
    );
  }

  return <>{children}</>;
}

function CenteredStatus({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-sm text-slate-500">
      {children}
    </main>
  );
}
