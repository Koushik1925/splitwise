import type {
  BalanceSummary,
  CreateExpenseRequest,
  ExpenseDetail,
  ExpenseList,
  FriendSummary,
  GroupDetail,
  GroupSummary,
  PairBalanceDetail,
} from '@splitwise/shared';
import { API_V1, ApiError, apiClient } from './api-client';

/** The server derives the creator and every owed amount; the key makes retries safe. */
export function createExpense(
  body: CreateExpenseRequest,
  idempotencyKey: string,
): Promise<ExpenseDetail> {
  return apiClient.post<ExpenseDetail>(`${API_V1}/expenses`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function fetchExpenses(cursor?: string, groupId?: string): Promise<ExpenseList> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (groupId) params.set('groupId', groupId);
  const query = params.toString();
  return apiClient.get<ExpenseList>(`${API_V1}/expenses${query ? `?${query}` : ''}`);
}

export function fetchExpense(expenseId: string): Promise<ExpenseDetail> {
  return apiClient.get<ExpenseDetail>(`${API_V1}/expenses/${expenseId}`);
}

export function fetchBalances(): Promise<BalanceSummary> {
  return apiClient.get<BalanceSummary>(`${API_V1}/balances`);
}

export function fetchPairBalance(userId: string): Promise<PairBalanceDetail> {
  return apiClient.get<PairBalanceDetail>(`${API_V1}/balances/users/${userId}`);
}

/** Read-only clients used to populate participant pickers. */
export function fetchFriends(): Promise<FriendSummary[]> {
  return apiClient.get<FriendSummary[]>(`${API_V1}/friends`);
}

export function fetchGroups(): Promise<GroupSummary[]> {
  return apiClient.get<GroupSummary[]>(`${API_V1}/groups`);
}

export function fetchGroup(groupId: string): Promise<GroupDetail> {
  return apiClient.get<GroupDetail>(`${API_V1}/groups/${groupId}`);
}

/** User-facing message for a failed expense request. */
export function describeExpenseError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return 'Something went wrong on our side. Please try again.';
    }
    if (error.status === 409) {
      return 'This request conflicts with one already submitted. Reload and check your expenses.';
    }
    return error.message;
  }
  return 'Unable to reach the server. Check your connection and try again.';
}
