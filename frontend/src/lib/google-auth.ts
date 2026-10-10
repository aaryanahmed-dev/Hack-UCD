import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

/** Where Supabase sends the user back after Google. Must be listed in Supabase → Authentication → URL Configuration. */
export function oauthRedirectUrl(): string {
  if (Platform.OS === 'web') return window.location.origin;
  return Linking.createURL('auth/callback');
}

/**
 * Sign in with Google via Supabase.
 * Web: full-page redirect; Supabase picks the session up from the URL when we come back.
 * Native: opens an in-app browser and exchanges the returned code for a session.
 * Resolves to false if the user closed the browser.
 */
export async function signInWithGoogle(): Promise<boolean> {
  const redirectTo = oauthRedirectUrl();

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw error;
    return true;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;

  const { queryParams } = Linking.parse(result.url);
  if (queryParams?.error_description) throw new Error(String(queryParams.error_description));
  const code = queryParams?.code;
  if (typeof code !== 'string') throw new Error('Google sign-in did not return a code.');

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  return true;
}
