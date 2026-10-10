import Ionicons from '@expo/vector-icons/Ionicons';
import type { AuthError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText, Banner, BrandMark, Button, Card, TextField } from '@/components/ui';
import { signInWithGoogle } from '@/lib/google-auth';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/theme';

type Mode = 'sign_in' | 'sign_up';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function describeAuthError(error: AuthError | Error): string {
  const code = 'code' in error ? (error as AuthError).code : undefined;
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'email_not_confirmed':
      return 'Confirm your email first — check your inbox for the link.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Sign in instead.';
    case 'weak_password':
      return error.message || 'Choose a stronger password.';
    case 'over_email_send_rate_limit':
      // Supabase's built-in mailer allows only a few emails per hour for the whole project.
      return 'We can’t send more confirmation emails right now. Please try again a bit later.';
    case 'over_request_rate_limit':
      // Per-IP limit — everyone on the same Wi-Fi shares one IP.
      return 'Too many sign-in attempts from this network. Wait a few minutes and try again.';
    case 'signup_disabled':
      return 'New sign-ups are turned off right now.';
    case 'validation_failed':
      return error.message;
  }
  if ('status' in error && (error as AuthError).status === 429) {
    return 'Too many attempts right now. Wait a few minutes and try again.';
  }
  if (/provider is not enabled/i.test(error.message)) return 'Google sign-in isn’t set up yet. Use email for now.';
  if (/fetch|network/i.test(error.message)) return "Can't reach the sign-in service. Check your connection.";
  return error.message || 'Something went wrong. Please try again.';
}

function emailRedirectUrl(): string {
  return Platform.OS === 'web' ? window.location.origin : Linking.createURL('/');
}

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const isSignUp = mode === 'sign_up';

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setFieldErrors({});
    setNeedsConfirmation(false);
  }

  function validate(): boolean {
    const next: typeof fieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    else if (isSignUp && password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`;
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    setError(null);
    setNeedsConfirmation(false);
    if (!validate()) return;
    setSubmitting(true);
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: emailRedirectUrl() },
        });
        if (signUpError) throw signUpError;
        // With email confirmation on there's no session yet. An empty identities list means the
        // email is already registered (Supabase hides this to prevent account enumeration).
        if (!data.session) {
          if (data.user && data.user.identities?.length === 0) {
            setError('An account with this email already exists. Sign in instead.');
          } else {
            setSentTo(cleanEmail);
          }
        }
        // With a session, the auth provider takes over and routes to onboarding.
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (signInError) {
          if (signInError.code === 'email_not_confirmed') setNeedsConfirmation(true);
          throw signInError;
        }
      }
    } catch (e) {
      setError(describeAuthError(e as AuthError));
    } finally {
      setSubmitting(false);
    }
  }

  async function google() {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(describeAuthError(e as Error));
    } finally {
      setGoogleLoading(false);
    }
  }

  async function resend(target: string) {
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: target,
      options: { emailRedirectTo: emailRedirectUrl() },
    });
    if (resendError) setError(describeAuthError(resendError));
    else {
      setError(null);
      setSentTo(target);
    }
  }

  if (sentTo) {
    return (
      <Screen contentStyle={styles.centerContent}>
        <Card style={styles.card}>
          <View style={styles.mailIcon}>
            <Ionicons name="mail-open-outline" size={30} color={colors.primary} />
          </View>
          <AppText variant="title" style={styles.center}>
            Check your inbox
          </AppText>
          <AppText style={styles.center}>
            We sent a confirmation link to <Text style={styles.strong}>{sentTo}</Text>. Open it, then come back
            here and sign in.
          </AppText>
          {error ? <Banner message={error} /> : null}
          <Button
            title="Back to sign in"
            onPress={() => {
              setSentTo(null);
              switchMode('sign_in');
            }}
          />
          <Button title="Resend email" variant="ghost" onPress={() => resend(sentTo)} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.centerContent}>
      <View style={styles.brand}>
        <BrandMark size={60} />
        <AppText variant="display" style={styles.center}>
          Study Stakes
        </AppText>
        <AppText style={[styles.center, styles.tagline]}>
          Put something on the line. Study with friends, prove it with a quiz, keep your stake.
        </AppText>
      </View>

      <Card style={styles.card}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(['sign_in', 'sign_up'] as const).map((m) => {
            const active = mode === m;
            return (
              <Pressable
                key={m}
                accessibilityRole="tab"
                aria-selected={active}
                onPress={() => switchMode(m)}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {m === 'sign_in' ? 'Sign in' : 'Create account'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <Banner
            message={error}
            action={needsConfirmation ? { label: 'Resend', onPress: () => resend(email.trim().toLowerCase()) } : undefined}
          />
        ) : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
          }}
          error={fieldErrors.email}
          placeholder="you@university.ie"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          error={fieldErrors.password}
          hint={isSignUp ? `At least ${MIN_PASSWORD} characters.` : undefined}
          placeholder={isSignUp ? 'Create a password' : 'Your password'}
          secure
          autoCapitalize="none"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          textContentType={isSignUp ? 'newPassword' : 'password'}
          returnKeyType="go"
          onSubmitEditing={submit}
        />

        <Button title={isSignUp ? 'Create account' : 'Sign in'} onPress={submit} loading={submitting} />

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <AppText variant="caption">or</AppText>
          <View style={styles.dividerLine} />
        </View>

        <Button
          title="Continue with Google"
          icon="logo-google"
          variant="secondary"
          onPress={google}
          loading={googleLoading}
        />
      </Card>

      <AppText variant="caption" style={[styles.center, styles.footnote]}>
        {isSignUp
          ? 'Next you’ll pick a username and confirm your date of birth.'
          : 'New here? Choose “Create account” above.'}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerContent: { justifyContent: 'center', paddingVertical: 32 },
  brand: { alignItems: 'center', gap: 12, marginBottom: 28 },
  tagline: { maxWidth: 340 },
  center: { textAlign: 'center' },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  card: { gap: 16, padding: 22 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 4,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentItemActive: { backgroundColor: colors.surface, boxShadow: '0px 1px 3px rgba(23, 35, 28, 0.12)' },
  segmentText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.muted },
  segmentTextActive: { color: colors.ink },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  footnote: { marginTop: 18 },
  mailIcon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
