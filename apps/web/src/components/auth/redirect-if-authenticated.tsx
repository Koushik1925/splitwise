'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/use-auth';

/** Sends visitors who already have a session from /login and /register to the dashboard. */
export function RedirectIfAuthenticated() {
  const router = useRouter();
  const { data: user } = useCurrentUser();

  useEffect(() => {
    if (user) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  return null;
}
