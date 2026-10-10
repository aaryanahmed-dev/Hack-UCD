import { Stack } from 'expo-router';

import { LiveProvider } from '@/providers/live';
import { colors } from '@/theme';

export default function AppLayout() {
  return (
    <LiveProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </LiveProvider>
  );
}
