import type { Metadata } from 'next';
import { ExpenseForm } from '@/components/expenses/expense-form';

export const metadata: Metadata = {
  title: 'Add expense · Splitwise',
};

export default function NewExpensePage() {
  return <ExpenseForm />;
}
