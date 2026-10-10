import { createContext, useContext, type ReactNode } from 'react';

import { useUserSocket } from '@/hooks/use-user-socket';

const LiveContext = createContext(false);

/** Holds the /ws/me connection for the signed-in part of the app. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const live = useUserSocket(true);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

/** True while /ws/me is connected (you appear online to others). */
export function useLive(): boolean {
  return useContext(LiveContext);
}
