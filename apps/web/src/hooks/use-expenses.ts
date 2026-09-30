'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateExpenseRequest } from '@splitwise/shared';
import {
  createExpense,
  fetchBalances,
  fetchExpense,
  fetchExpenses,
  fetchFriends,
  fetchGroup,
  fetchGroups,
} from '@/lib/expenses-api';

export const balancesQueryKey = ['balances'] as const;
export const expensesQueryKey = ['expenses'] as const;

export function useBalances() {
  return useQuery({ queryKey: balancesQueryKey, queryFn: fetchBalances });
}

export function useExpenseList() {
  return useInfiniteQuery({
    queryKey: expensesQueryKey,
    queryFn: ({ pageParam }) => fetchExpenses(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useExpense(expenseId: string) {
  return useQuery({
    queryKey: [...expensesQueryKey, expenseId],
    queryFn: () => fetchExpense(expenseId),
  });
}

/** Balances are derived server-side, so a new expense just invalidates them. */
export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateExpenseRequest; key: string }) =>
      createExpense(body, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expensesQueryKey });
      void queryClient.invalidateQueries({ queryKey: balancesQueryKey });
    },
  });
}

export function useFriends() {
  return useQuery({ queryKey: ['friends'], queryFn: fetchFriends });
}

export function useGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
}

export function useGroupDetail(groupId: string | null) {
  return useQuery({
    queryKey: ['groups', groupId],
    queryFn: () => fetchGroup(groupId as string),
    enabled: groupId !== null,
  });
}
