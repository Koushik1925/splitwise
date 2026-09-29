import type { Metadata } from 'next';
import { DashboardPlaceholder } from '@/components/dashboard/dashboard-placeholder';

export const metadata: Metadata = {
  title: 'Dashboard · Splitwise',
};

export default function DashboardPage() {
  return <DashboardPlaceholder />;
}
