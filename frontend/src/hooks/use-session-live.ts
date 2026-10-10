import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api, toApiError } from '@/lib/api';
import { WS_URL } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import type { SessionTodo, StudySession } from '@/lib/types';

const PING_MS = 15_000;
const POLL_MS = 5_000; // REST fallback while the socket is down
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000];

type FocusState = 'focused' | 'idle' | 'away';

/**
 * Live view of one study session over /ws/sessions/{id} (API_SPEC §8.2).
 * Every `session.updated` message is a full snapshot that replaces local state.
 */
export function useSessionLive(sessionId: string) {
  const [session, setSessionState] = useState<StudySession | null>(null);
  const [todos, setTodos] = useState<SessionTodo[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // serverTime − local time, so countdowns follow the server's clock
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  const setSession = useCallback((s: StudySession) => {
    setSessionState(s);
    setClockOffset(new Date(s.serverTime).getTime() - Date.now());
    setError(null);
  }, []);

  const refresh = useCallback(() => {
    api.getSession(sessionId).then(setSession, (e) => setError(toApiError(e)));
  }, [sessionId, setSession]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, RETRY_DELAYS_MS[attempt] ?? 10_000);
      attempt += 1;
    };

    async function connect() {
      if (disposed || socket) return;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || disposed || socket) return;

      const ws = new WebSocket(`${WS_URL}/ws/sessions/${sessionId}?token=${encodeURIComponent(token)}`);
      socket = ws;
      socketRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, PING_MS);
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'session.updated') setSession(message.data);
          else if (message.type === 'session.todos') setTodos(message.data.items);
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = (event) => {
        clearInterval(pingTimer);
        if (socket === ws) socket = null;
        if (socketRef.current === ws) socketRef.current = null;
        setConnected(false);
        if (disposed) return;
        if (event.code === 4403 || event.code === 4404) {
          setError(new ApiError(404, 'not_found', 'This session doesn’t exist or isn’t in your groups.'));
          return;
        }
        if (event.code === 4401) {
          supabase.auth.refreshSession().finally(scheduleReconnect);
          return;
        }
        scheduleReconnect();
      };
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket?.close();
      socketRef.current = null;
    };
  }, [sessionId, setSession]);

  // Initial load + polling fallback while disconnected
  useEffect(() => {
    if (connected) return;
    let active = true;
    const load = () =>
      api.getSession(sessionId).then(
        (s) => active && setSession(s),
        (e) => active && setError(toApiError(e)),
      );
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connected, sessionId, setSession]);

  /** Report focus over the socket, or the REST fallback when it's down. */
  const sendFocus = useCallback(
    (state: FocusState) => {
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'focus.update', data: { state } }));
      } else {
        api.focusEvent(sessionId, state).catch(() => {});
      }
    },
    [sessionId],
  );

  return { session, todos, setTodos, connected, error, clockOffset, refresh, setSession, sendFocus };
}
