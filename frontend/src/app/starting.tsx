import { Redirect, type Href } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, BrandMark, Button } from '@/components/ui';
import { clearReturnPath, getReturnPath } from '@/lib/return-path';
import { useAuth } from '@/providers/auth';
import { colors } from '@/theme';

/** Holding screen while we work out where the user belongs; also the "can't reach server" screen. */
export default function StartingScreen() {
  const { stage, profileError, reloadProfile, signOut } = useAuth();
  // Once we leave this screen the original deep link has been used (or is no longer relevant).
  useEffect(() => clearReturnPath, []);

  if (stage === 'ready') return <Redirect href={getReturnPath() as Href} />;
  if (stage === 'signed_out') return <Redirect href="/sign-in" />;
  if (stage === 'onboarding') return <Redirect href="/onboarding" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <BrandMark size={64} />
        {stage === 'error' && profileError ? (
          <View style={styles.errorBox}>
            <AppText variant="title" style={styles.centerText}>
              {profileError.code === 'network_error' ? "Can't reach Study Stakes" : 'Something went wrong'}
            </AppText>
            <AppText style={styles.centerText}>{profileError.message}</AppText>
            <Button title="Try again" icon="refresh" onPress={reloadProfile} style={styles.button} />
            <Button title="Sign out" variant="ghost" onPress={signOut} style={styles.button} />
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
  spinner: { marginTop: 8 },
  errorBox: { alignItems: 'center', gap: 10, maxWidth: 360, width: '100%' },
  centerText: { textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: 4 },
});
