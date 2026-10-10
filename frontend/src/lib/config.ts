import { Platform } from 'react-native';

// EXPO_PUBLIC_* variables are inlined at build time, so they must be read with the full literal name.

function required(name: string, value: string | undefined): string {
  if (!value || value.includes('<')) {
    throw new Error(`Missing ${name}. Copy frontend/.env.example to frontend/.env, fill it in, and restart Expo.`);
  }
  return value.trim().replace(/\/+$/, '');
}

/**
 * "same-origin" (used by the web build the backend serves, see .env.production) means the API lives
 * on whatever domain the page was loaded from — localhost:8000 or the ngrok URL.
 */
function resolveApiUrl(): string {
  const value = required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL);
  if (value !== 'same-origin') return value;
  if (Platform.OS !== 'web') {
    throw new Error('EXPO_PUBLIC_API_URL=same-origin only works on the web. Use a full URL for the mobile app.');
  }
  return window.location.origin;
}

export const API_URL = resolveApiUrl();
export const WS_URL = API_URL.replace(/^http/, 'ws');
export const SUPABASE_URL = required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_PUBLISHABLE_KEY = required(
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export const APP_SCHEME = 'studystakes';
