import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MAX_CONTENT_WIDTH, colors } from '@/theme';

/** Page wrapper: safe areas, keyboard avoidance, scrolling, and a centred max-width column on wide screens. */
export function Screen({
  children,
  refreshControl,
  contentStyle,
}: {
  children: ReactNode;
  refreshControl?: ScrollViewProps['refreshControl'];
  contentStyle?: ScrollViewProps['contentContainerStyle'];
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  column: { flexGrow: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
});
