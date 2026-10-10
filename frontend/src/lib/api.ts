import { API_URL } from './config';
import { supabase } from './supabase';
import type { GroupDetail, GroupSummary, ListResponse, Me, UserStats } from './types';

export interface FieldError {
  field: string;
  message: string;
}

/** Every API failure, shaped like the backend's {error: {code, message, details}} (API_SPEC §3.5). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: FieldError[] | null = null,
  ) {
    super(message);
  }

  fieldError(field: string): string | undefined {
    return this.details?.find((d) => d.field === field)?.message;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, 'internal_error', 'Something went wrong. Please try again.');
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, retryOn401 = true): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (__DEV__) console.warn(`[api] ${method} ${API_URL}${path} failed before getting a response:`, e);
    throw new ApiError(0, 'network_error', "Can't reach the server. Check your connection and try again.");
  }

  if (response.status === 401 && retryOn401 && token) {
    // Token may have just expired: refresh once and retry; if that fails the session is dead.
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (!error && refreshed.session) return request<T>(method, path, body, false);
    await supabase.auth.signOut();
  }

  if (response.status === 204) return undefined as T;

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // non-JSON body (e.g. a proxy error page)
  }

  if (!response.ok) {
    const err = payload?.error;
    throw new ApiError(
      response.status,
      err?.code ?? (response.status >= 500 ? 'internal_error' : 'bad_request'),
      err?.message ?? 'Something went wrong. Please try again.',
      Array.isArray(err?.details) ? err.details : null,
    );
  }
  return payload as T;
}

export const api = {
  getMe: () => request<Me>('GET', '/api/me'),
  createMe: (body: { username: string; displayName: string; dateOfBirth: string }) =>
    request<Me>('POST', '/api/me', body),
  getMyStats: () => request<UserStats>('GET', '/api/me/stats'),

  listGroups: () => request<ListResponse<GroupSummary>>('GET', '/api/groups'),
  getGroup: (groupId: string) => request<GroupDetail>('GET', `/api/groups/${groupId}`),
  createGroup: (body: { name: string; description?: string | null }) =>
    request<GroupDetail>('POST', '/api/groups', body),
  joinGroup: (inviteCode: string) => request<GroupDetail>('POST', '/api/groups/join', { inviteCode }),
};
