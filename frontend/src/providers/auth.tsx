import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, api, toApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { Me } from '@/lib/types';

type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'missing' }
  | { status: 'error'; error: ApiError };

/** Which part of the app the user should see. Drives the route guards in the root layout. */
export type AuthStage = 'starting' | 'signed_out' | 'onboarding' | 'ready' | 'error';

interface AuthContextValue {
  stage: AuthStage;
  session: Session | null;
  me: Me | null;
  profileError: ApiError | null;
  /** Re-fetch GET /api/me (e.g. after a network error). */
  reloadProfile: () => void;
  /** Store the profile returned by onboarding without another round-trip. */
  setMe: (me: Me) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LOADING: ProfileState = { status: 'loading' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // Tagged with the user id it was loaded for; a different id means it is still loading.
  const [loaded, setLoaded] = useState<{ userId: string; state: ProfileState } | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const userId = session?.user.id ?? null;
  const profile: ProfileState = userId && loaded?.userId === userId ? loaded.state : LOADING;

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoaded(true);
    });
    // Only set state here: Supabase warns against awaiting its own calls inside this callback.
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoaded(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    api.getMe().then(
      (me) => active && setLoaded({ userId, state: { status: 'ready', me } }),
      (e) => {
        if (!active) return;
        const error = toApiError(e);
        // unauthenticated: the api client already signed us out, which clears the session
        if (error.code === 'unauthenticated') return;
        setLoaded({
          userId,
          state: error.code === 'profile_not_found' ? { status: 'missing' } : { status: 'error', error },
        });
      },
    );
    return () => {
      active = false;
    };
  }, [userId, reloadCount]);

  const reloadProfile = useCallback(() => {
    setLoaded(null);
    setReloadCount((n) => n + 1);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const setMe = useCallback((me: Me) => setLoaded({ userId: me.id, state: { status: 'ready', me } }), []);

  const stage: AuthStage = !sessionLoaded
    ? 'starting'
    : !session
      ? 'signed_out'
      : profile.status === 'ready'
        ? 'ready'
        : profile.status === 'missing'
          ? 'onboarding'
          : profile.status === 'error'
            ? 'error'
            : 'starting';

  const value = useMemo<AuthContextValue>(
    () => ({
      stage,
      session,
      me: profile.status === 'ready' ? profile.me : null,
      profileError: profile.status === 'error' ? profile.error : null,
      reloadProfile,
      setMe,
      signOut,
    }),
    [stage, session, profile, reloadProfile, setMe, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For screens that only render once the profile is loaded. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('useMe used before the profile loaded');
  return me;
}
