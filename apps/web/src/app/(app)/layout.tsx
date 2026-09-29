import type { ReactNode } from 'react';
import { RequireAuth } from '@/components/auth/require-auth';

/** Every route in the (app) group requires a signed-in user. */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
