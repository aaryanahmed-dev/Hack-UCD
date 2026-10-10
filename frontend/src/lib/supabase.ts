import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { authStorage } from './auth-storage';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

const isWeb = Platform.OS === 'web';

// Supabase is used for sign-in only; all app data goes through our API.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    flowType: 'pkce',
    // On web the OAuth / email-confirmation redirect lands back on our page with ?code=…
    detectSessionInUrl: isWeb,
  },
});

if (!isWeb) {
  // Only refresh tokens while the app is in the foreground.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
