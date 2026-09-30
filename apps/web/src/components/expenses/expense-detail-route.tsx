'use client';

import { useParams } from 'next/navigation';
import { ExpenseDetailView } from '@/components/expenses/expense-detail';

/** Reads the dynamic segment on the client; the API authorizes the id itself. */
export function ExpenseDetailRoute() {
  const { expenseId } = useParams<{ expenseId: string }>();
  return <ExpenseDetailView expenseId={expenseId} />;
}
