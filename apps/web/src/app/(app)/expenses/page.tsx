import type { Metadata } from 'next';
import { ExpenseList } from '@/components/expenses/expense-list';

export const metadata: Metadata = {
  title: 'Expenses · Splitwise',
};

export default function ExpensesPage() {
  return <ExpenseList />;
}
