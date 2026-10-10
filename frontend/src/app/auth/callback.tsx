import { Redirect } from 'expo-router';

/**
 * Native OAuth redirect target (studystakes://auth/callback). The in-app browser hands the URL to
 * signInWithGoogle(); if the OS opens this route instead, just continue to wherever the user belongs.
 */
export default function AuthCallback() {
  return <Redirect href="/starting" />;
}
