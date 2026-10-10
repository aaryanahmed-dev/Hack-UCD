import { Stack } from 'expo-router';

import { NotificationToast } from '@/components/notification-toast';
import { LiveProvider } from '@/providers/live';
import { colors } from '@/theme';

export default function AppLayout() {
  return (
    <LiveProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <NotificationToast />
    </LiveProvider>
  );
}
