const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Versioned prefix for feature routes (`/health` is unversioned). */
export const API_V1 = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Minimal fetch wrapper. Never trust or echo financial fields (amounts,
 * settlement status, payment status) computed client-side — every mutation
 * still gets recomputed and verified by the backend.
 *
 * `credentials: 'include'` sends the httpOnly session cookie set by the API;
 * the frontend never sees or stores the token itself.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Nest error bodies carry `message` as a string, or a string[] for validation errors. */
async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join('. ') : body.message;
    if (message) {
      return message;
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return text || response.statusText;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
