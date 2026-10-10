import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

type FocusState = 'focused' | 'idle' | 'away';

const IDLE_MS = 3 * 60_000; // web: no input for 3 minutes = idle (API_SPEC §7.4)

/**
 * While `active`, reports whether this screen has the user's attention:
 * native → AppState (active = focused, background = away);
 * web → tab visibility / window focus, plus idle detection when `detectIdle` is on.
 */
export function useFocusReporter(active: boolean, report: (state: FocusState) => void, detectIdle = true) {
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    if (!active) return;
    let last: FocusState | null = null;
    const send = (state: FocusState) => {
      if (state === last) return;
      last = state;
      reportRef.current(state);
    };

    if (Platform.OS !== 'web') {
      send(AppState.currentState === 'active' ? 'focused' : 'away');
      const sub = AppState.addEventListener('change', (s) => send(s === 'active' ? 'focused' : 'away'));
      return () => sub.remove();
    }

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const visibleAndFocused = () => document.visibilityState === 'visible' && document.hasFocus();
    const armIdle = () => {
      clearTimeout(idleTimer);
      if (detectIdle) idleTimer = setTimeout(() => visibleAndFocused() && send('idle'), IDLE_MS);
    };
    const onActivity = () => {
      if (!visibleAndFocused()) return;
      send('focused');
      armIdle();
    };
    const onAway = () => {
      clearTimeout(idleTimer);
      send('away');
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? onActivity() : onAway());

    if (visibleAndFocused()) onActivity();
    else onAway();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onAway);
    window.addEventListener('focus', onActivity);
    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    activityEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      clearTimeout(idleTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onAway);
      window.removeEventListener('focus', onActivity);
      activityEvents.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [active, detectIdle]);
}
