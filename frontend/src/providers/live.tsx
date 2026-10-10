import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useUserSocket } from '@/hooks/use-user-socket';
import { api } from '@/lib/api';
import type { AppNotification, UserStatus } from '@/lib/types';

type Listener = (n: AppNotification) => void;

interface LiveValue {
  /** /ws/me connected — you appear online to friends. */
  connected: boolean;
  unreadCount: number;
  refreshUnread: () => void;
  markAllRead: () => Promise<void>;
  /** Latest notification to flash as a toast (cleared by the toast). */
  toast: AppNotification | null;
  dismissToast: () => void;
  /** Live friend status pushed by the server (overrides what a list fetched earlier). */
  friendStatus: Record<string, UserStatus>;
  /** Screens that list notifications subscribe to new ones. */
  onNotification: (listener: Listener) => () => void;
}

const LiveContext = createContext<LiveValue | null>(null);

/** Holds the /ws/me connection for the signed-in part of the app. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [friendStatus, setFriendStatus] = useState<Record<string, UserStatus>>({});
  const listeners = useRef(new Set<Listener>());

  const refreshUnread = useCallback(() => {
    api.unreadCount().then((r) => setUnreadCount(r.count), () => {});
  }, []);

  const handleMessage = useCallback((type: string, data: any) => {
    if (type === 'notification.created') {
      const n = data as AppNotification;
      setUnreadCount((c) => c + 1);
      setToast(n);
      listeners.current.forEach((l) => l(n));
    } else if (type === 'friend.status') {
      setFriendStatus((s) => ({ ...s, [data.userId]: data.status }));
    }
  }, []);

  const connected = useUserSocket(true, handleMessage);

  // Fetch the badge count on start and whenever we (re)connect, to catch anything missed offline.
  useEffect(() => {
    if (connected) refreshUnread();
  }, [connected, refreshUnread]);

  const markAllRead = useCallback(async () => {
    setUnreadCount(0);
    await api.markRead({ all: true }).catch(() => {});
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const onNotification = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<LiveValue>(
    () => ({
      connected,
      unreadCount,
      refreshUnread,
      markAllRead,
      toast,
      dismissToast,
      friendStatus,
      onNotification,
    }),
    [connected, unreadCount, refreshUnread, markAllRead, toast, dismissToast, friendStatus, onNotification],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveState(): LiveValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLiveState must be used inside <LiveProvider>');
  return ctx;
}

/** True while /ws/me is connected (you appear online to others). */
export function useLive(): boolean {
  return useLiveState().connected;
}
