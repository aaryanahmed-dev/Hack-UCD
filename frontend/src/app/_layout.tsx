import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/providers/auth';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Which screens exist depends on the auth stage. When a stage ends, its screens disappear and
 * Expo Router moves to the first screen that is still available (API_SPEC §4 onboarding flow).
 */
function RootNavigator() {
  const { stage } = useAuth();

  useEffect(() => {
    if (stage !== 'starting') SplashScreen.hideAsync();
  }, [stage]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={stage === 'ready'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={stage === 'signed_out'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={stage === 'onboarding'}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      {/* Always available: shown while loading or when the profile can't be fetched. */}
      <Stack.Screen name="starting" />
      <Stack.Screen name="auth/callback" />
    </Stack>
  );
}
