import type { Metadata } from 'next';
import { ExpenseDetailRoute } from '@/components/expenses/expense-detail-route';

export const metadata: Metadata = {
  title: 'Expense · Splitwise',
};

export default function ExpenseDetailPage() {
  return <ExpenseDetailRoute />;
}
