import type { AuthResponse, UserProfile } from '@splitwise/shared';
import { API_V1, ApiError, apiClient } from './api-client';

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  name: string;
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>(`${API_V1}/auth/login`, input);
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>(`${API_V1}/auth/register`, input);
}

export function logout(): Promise<void> {
  return apiClient.post<void>(`${API_V1}/auth/logout`);
}

/** The signed-in user, or null when there is no valid session (401). */
export async function fetchCurrentUser(): Promise<UserProfile | null> {
  try {
    return await apiClient.get<UserProfile>(`${API_V1}/users/me`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

/** User-facing message for a failed login/register request. */
export function describeAuthError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return 'Too many attempts. Please wait a minute and try again.';
    }
    if (error.status >= 500) {
      return 'Something went wrong on our side. Please try again.';
    }
    return error.message;
  }
  return 'Unable to reach the server. Check your connection and try again.';
}
