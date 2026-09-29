'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, UserProfile } from '@splitwise/shared';
import { fetchCurrentUser, login, logout, register } from '@/lib/auth-api';

export const currentUserQueryKey = ['auth', 'current-user'] as const;

/**
 * Session state as reported by the API (`GET /users/me`). `data` is null
 * when signed out. This only drives UI routing — every API call is
 * independently authorized by the backend.
 */
export function useCurrentUser() {
  return useQuery<UserProfile | null>({
    queryKey: currentUserQueryKey,
    queryFn: fetchCurrentUser,
    retry: false,
  });
}

function useSessionMutation<TInput>(mutationFn: (input: TInput) => Promise<AuthResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: ({ user }) => {
      queryClient.setQueryData(currentUserQueryKey, user);
    },
  });
}

export function useLogin() {
  return useSessionMutation(login);
}

export function useRegister() {
  return useSessionMutation(register);
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    // Even if the request failed, treat the user as signed out locally and
    // drop every other cached query so no per-user data outlives the session.
    onSettled: () => {
      queryClient.setQueryData(currentUserQueryKey, null);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== currentUserQueryKey[0],
      });
    },
  });
}
