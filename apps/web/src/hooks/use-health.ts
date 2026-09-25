'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface HealthResponse {
  status: string;
  info?: Record<string, { status: string }>;
}

export function useApiHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get<HealthResponse>('/health'),
    retry: false,
  });
}
