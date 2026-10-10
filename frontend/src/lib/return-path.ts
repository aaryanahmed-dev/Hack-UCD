import { Platform } from 'react-native';

/**
 * The page the app was opened on (e.g. a deep link or the Google Calendar callback). While auth is
 * loading the router shows /starting, so we remember the original path and go back to it afterwards.
 */
const AUTH_PATHS = ['/starting', '/sign-in', '/onboarding', '/auth/callback'];

let returnPath: string | null =
  Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname + window.location.search : null;

export function getReturnPath(): string {
  if (!returnPath || returnPath === '/' || AUTH_PATHS.some((p) => returnPath!.startsWith(p))) return '/';
  return returnPath;
}

export function clearReturnPath(): void {
  returnPath = null;
}
