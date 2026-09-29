import type { ReactNode } from 'react';
import { RedirectIfAuthenticated } from '@/components/auth/redirect-if-authenticated';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <RedirectIfAuthenticated />
        {children}
      </div>
    </main>
  );
}
