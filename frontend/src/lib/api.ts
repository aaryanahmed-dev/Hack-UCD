import { API_URL } from './config';
import { supabase } from './supabase';
import type {
  LedgerEntry,
  Payment,
  ShopItem,
  Verification,
  Wallet,
  ActivityDay,
  AppNotification,
  CalendarEvent,
  EventKind,
  Friend,
  FriendRequest,
  GoogleStatus,
  LeaderboardMetric,
  LeaderboardRow,
  LeaderboardScope,
  Priority,
  Todo,
  UserSummary,
  AssessmentRule,
  Charity,
  CurrentQuestion,
  Dispute,
  GroupDetail,
  GroupSummary,
  ListResponse,
  Material,
  Me,
  Page,
  Review,
  SessionConfig,
  SessionSummary,
  SessionTodo,
  StudySession,
  UserStats,
} from './types';

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

  // FormData (file uploads) sets its own multipart Content-Type with the boundary.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': '1',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
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
  updateMe: (changes: { displayName?: string; avatarUrl?: string | null }) => request<Me>('PATCH', '/api/me', changes),

  listGroups: () => request<ListResponse<GroupSummary>>('GET', '/api/groups'),
  getGroup: (groupId: string) => request<GroupDetail>('GET', `/api/groups/${groupId}`),
  createGroup: (body: { name: string; description?: string | null }) =>
    request<GroupDetail>('POST', '/api/groups', body),
  joinGroup: (inviteCode: string) => request<GroupDetail>('POST', '/api/groups/join', { inviteCode }),
  groupSessions: (groupId: string, scope: 'active' | 'scheduled' | 'past') =>
    request<Page<SessionSummary>>('GET', `/api/groups/${groupId}/sessions?scope=${scope}`),

  listCharities: () => request<ListResponse<Charity>>('GET', '/api/charities'),

  // Sessions
  createSession: (groupId: string, config: Partial<SessionConfig>) =>
    request<StudySession>('POST', `/api/groups/${groupId}/sessions`, config),
  getSession: (id: string) => request<StudySession>('GET', `/api/sessions/${id}`),
  updateSession: (id: string, changes: Partial<SessionConfig>) =>
    request<StudySession>('PATCH', `/api/sessions/${id}`, changes),
  cancelSession: (id: string) => request<void>('DELETE', `/api/sessions/${id}`),
  joinSession: (id: string) => request<StudySession>('POST', `/api/sessions/${id}/join`),
  leaveSession: (id: string) => request<void>('POST', `/api/sessions/${id}/leave`),
  voteAssessment: (id: string, rule: AssessmentRule) =>
    request<StudySession>('PUT', `/api/sessions/${id}/assessment-vote`, rule),
  setReady: (id: string, isReady: boolean) => request<StudySession>('POST', `/api/sessions/${id}/ready`, { isReady }),
  startSession: (id: string) => request<StudySession>('POST', `/api/sessions/${id}/start`),
  voteExtension: (id: string, extend: boolean) =>
    request<StudySession>('POST', `/api/sessions/${id}/extension-vote`, { extend }),
  finishEarly: (id: string, wantsToFinish: boolean) =>
    request<StudySession>('POST', `/api/sessions/${id}/finish-early`, { wantsToFinish }),
  focusEvent: (id: string, state: 'focused' | 'idle' | 'away') =>
    request<void>('POST', `/api/sessions/${id}/focus-events`, { state }),

  // Materials
  uploadMaterial: (id: string, form: FormData) => request<Material>('POST', `/api/sessions/${id}/materials`, form),
  pasteMaterial: (id: string, title: string, text: string) =>
    request<Material>('POST', `/api/sessions/${id}/materials/text`, { title, text }),
  approveMaterial: (id: string, materialId: string, approved: boolean) =>
    request<Material>('POST', `/api/sessions/${id}/materials/${materialId}/approve`, { approved }),
  deleteMaterial: (id: string, materialId: string) =>
    request<void>('DELETE', `/api/sessions/${id}/materials/${materialId}`),

  // Shared to-dos
  addTodo: (id: string, title: string) => request<SessionTodo>('POST', `/api/sessions/${id}/todos`, { title }),
  updateTodo: (id: string, todoId: string, changes: { title?: string; isDone?: boolean }) =>
    request<SessionTodo>('PATCH', `/api/sessions/${id}/todos/${todoId}`, changes),
  deleteTodo: (id: string, todoId: string) => request<void>('DELETE', `/api/sessions/${id}/todos/${todoId}`),

  // Quiz & review
  currentQuestion: (id: string) => request<CurrentQuestion>('GET', `/api/sessions/${id}/quiz/current`),
  answerQuestion: (id: string, body: { questionId: string; optionId?: string | null; text?: string | null }) =>
    request<CurrentQuestion>('POST', `/api/sessions/${id}/quiz/answers`, body),
  getReview: (id: string) => request<Review>('GET', `/api/sessions/${id}/review`),
  openDispute: (id: string, questionId: string, reason: string) =>
    request<Dispute>('POST', `/api/sessions/${id}/disputes`, { questionId, reason }),
  voteDispute: (id: string, disputeId: string, vote: 'drop' | 'keep') =>
    request<Dispute>('POST', `/api/sessions/${id}/disputes/${disputeId}/vote`, { vote }),
  reviewDone: (id: string) => request<void>('POST', `/api/sessions/${id}/review/done`),

  // Groups (more)
  updateGroup: (groupId: string, changes: { name?: string; description?: string | null }) =>
    request<GroupDetail>('PATCH', `/api/groups/${groupId}`, changes),
  inviteToGroup: (groupId: string, userId: string) => request<void>('POST', `/api/groups/${groupId}/invites`, { userId }),
  inviteToSession: (sessionId: string, userIds: string[]) =>
    request<{ invited: number }>('POST', `/api/sessions/${sessionId}/invites`, { userIds }),
  mySessions: (scope: 'active' | 'scheduled' | 'past') => request<Page<SessionSummary>>('GET', `/api/sessions?scope=${scope}`),

  // Users & friends
  searchUsers: (q: string) => request<ListResponse<UserSummary>>('GET', `/api/users?search=${encodeURIComponent(q)}`),
  userStats: (userId: string) => request<UserStats>('GET', `/api/users/${userId}/stats`),
  listFriends: () => request<ListResponse<Friend>>('GET', '/api/friends'),
  friendRequests: () => request<ListResponse<FriendRequest>>('GET', '/api/friends/requests'),
  sendFriendRequest: (username: string) =>
    request<{ request: FriendRequest | null; friend: Friend | null }>('POST', '/api/friends/requests', { username }),
  acceptFriendRequest: (id: string) => request<Friend>('POST', `/api/friends/requests/${id}/accept`),
  deleteFriendRequest: (id: string) => request<void>('DELETE', `/api/friends/requests/${id}`),
  unfriend: (userId: string) => request<void>('DELETE', `/api/friends/${userId}`),

  // Notifications
  notifications: () => request<Page<AppNotification>>('GET', '/api/notifications?limit=50'),
  unreadCount: () => request<{ count: number }>('GET', '/api/notifications/unread-count'),
  markRead: (body: { ids?: string[]; all?: boolean }) => request<void>('POST', '/api/notifications/read', body),

  // Leaderboard & activity
  leaderboard: (scope: LeaderboardScope, metric: LeaderboardMetric, groupId?: string) =>
    request<{ items: LeaderboardRow[]; me: LeaderboardRow }>(
      'GET',
      `/api/leaderboard?scope=${scope}&metric=${metric}${groupId ? `&groupId=${groupId}` : ''}`,
    ),
  activity: (days: number) => request<{ days: ActivityDay[] }>('GET', `/api/me/activity?days=${days}`),

  // Personal to-dos
  listTodos: () => request<ListResponse<Todo>>('GET', '/api/todos'),
  createPersonalTodo: (body: {
    title: string;
    notes?: string | null;
    priority?: Priority;
    tags?: string[];
    dueAt?: string | null;
    visibility?: 'private' | 'friends';
    subtasks?: { title: string }[];
  }) => request<Todo>('POST', '/api/todos', body),
  updatePersonalTodo: (
    id: string,
    changes: Partial<{ title: string; notes: string | null; priority: Priority; tags: string[]; dueAt: string | null; isDone: boolean; visibility: 'private' | 'friends' }>,
  ) => request<Todo>('PATCH', `/api/todos/${id}`, changes),
  deletePersonalTodo: (id: string) => request<void>('DELETE', `/api/todos/${id}`),
  addSubtask: (id: string, title: string) => request<Todo>('POST', `/api/todos/${id}/subtasks`, { title }),
  updateSubtask: (id: string, subtaskId: string, changes: { title?: string; isDone?: boolean }) =>
    request<Todo>('PATCH', `/api/todos/${id}/subtasks/${subtaskId}`, changes),
  deleteSubtask: (id: string, subtaskId: string) => request<Todo>('DELETE', `/api/todos/${id}/subtasks/${subtaskId}`),

  // Calendar
  calendarEvents: (from: string, to: string) =>
    request<{ items: CalendarEvent[]; googleError: string | null }>(
      'GET',
      `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  createEvent: (body: { title: string; kind: EventKind; startsAt: string; endsAt?: string | null; allDay?: boolean; notes?: string | null }) =>
    request<CalendarEvent>('POST', '/api/calendar/events', body),
  updateEvent: (
    id: string,
    changes: Partial<{ title: string; kind: EventKind; startsAt: string; endsAt: string | null; allDay: boolean; notes: string | null }>,
  ) => request<CalendarEvent>('PATCH', `/api/calendar/events/${id}`, changes),
  deleteEvent: (id: string) => request<void>('DELETE', `/api/calendar/events/${id}`),
  googleStatus: () => request<GoogleStatus>('GET', '/api/calendar/google'),
  googleConnect: (returnTo: string) => request<{ authUrl: string }>('POST', '/api/calendar/google/connect', { returnTo }),
  googleDisconnect: () => request<void>('DELETE', '/api/calendar/google'),

  // Wallet & Stripe
  wallet: () => request<Wallet>('GET', '/api/wallet'),
  transactions: () => request<Page<LedgerEntry>>('GET', '/api/wallet/transactions?limit=30'),
  checkout: (coins: number, returnTo: string) => request<{ checkoutUrl: string }>('POST', '/api/wallet/checkout', { coins, returnTo }),
  confirmCheckout: (sessionId: string) => request<Payment>('POST', '/api/wallet/checkout/confirm', { sessionId }),

  // ID verification (Persona)
  verification: () => request<Verification>('GET', '/api/me/verification'),
  startVerification: (redirectUri: string) => request<{ url: string }>('POST', '/api/me/verification/start', { redirectUri }),
  refreshVerification: () => request<Verification>('POST', '/api/me/verification/refresh'),

  // Token store
  shopItems: () => request<ListResponse<ShopItem>>('GET', '/api/shop/items'),
  buyItem: (id: string) => request<ShopItem>('POST', `/api/shop/items/${id}/purchase`),
  equip: (equipped: Partial<{ avatar: string | null; frame: string | null }>) => request<Me>('PATCH', '/api/me', { equipped }),
};
