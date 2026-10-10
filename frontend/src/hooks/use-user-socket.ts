import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { WS_URL } from '@/lib/config';
import { supabase } from '@/lib/supabase';

const PING_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000]; // then every 10 s (API_SPEC §8)

/**
 * Keeps /ws/me open while the app is in the foreground — this is what makes you "online" to others.
 * Returns whether the socket is currently connected.
 */
export function useUserSocket(enabled: boolean, onMessage?: (type: string, data: any) => void): boolean {
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled) return;

    let socket: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let paused = false; // app in background
    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed || paused) return;
      const delay = RETRY_DELAYS_MS[attempt] ?? 10_000;
      attempt += 1;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    async function connect() {
      if (disposed || paused || socket) return;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || disposed || paused || socket) return;

      const ws = new WebSocket(`${WS_URL}/ws/me?token=${encodeURIComponent(token)}`);
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        const ping = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' }));
        ping();
        pingTimer = setInterval(ping, PING_MS);
      };
      ws.onclose = (event) => {
        clearInterval(pingTimer);
        if (socket === ws) socket = null;
        setConnected(false);
        if (disposed || paused) return;
        if (event.code === 4404) return; // no profile — nothing to reconnect to
        if (event.code === 4401) {
          supabase.auth.refreshSession().finally(scheduleReconnect);
          return;
        }
        scheduleReconnect();
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type && message.type !== 'pong') onMessageRef.current?.(message.type, message.data);
        } catch {
          // ignore malformed messages
        }
      };
    }

    const close = () => {
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      const ws = socket;
      socket = null;
      ws?.close();
      setConnected(false);
    };

    connect();

    const appState =
      Platform.OS === 'web'
        ? null
        : AppState.addEventListener('change', (state) => {
            if (state === 'active') {
              paused = false;
              attempt = 0;
              connect();
            } else {
              paused = true;
              close();
            }
          });

    return () => {
      disposed = true;
      appState?.remove();
      close();
    };
  }, [enabled]);

  return connected;
}
