import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { MAX_CONTENT_WIDTH, colors, radius, shadow } from '@/theme';

/** Bottom sheet on phones, centred dialog on the web. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  return (
    <Modal visible={visible} transparent animationType={isWeb ? 'fade' : 'slide'} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.backdropWrap, isWeb && styles.centered]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close">
          <View style={styles.backdrop} />
        </Pressable>
        <View
          style={[
            styles.sheet,
            isWeb ? styles.dialog : { paddingBottom: Math.max(insets.bottom, 20) },
          ]}
        >
          {!isWeb ? <View style={styles.grabber} /> : null}
          <View style={styles.header}>
            <AppText variant="title" style={styles.title}>
              {title}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.close, pressed && { backgroundColor: colors.line }]}
            >
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropWrap: { flex: 1, justifyContent: 'flex-end' },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 20 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 25, 19, 0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
    ...shadow.raised,
  },
  dialog: { width: '100%', maxWidth: MAX_CONTENT_WIDTH - 80, borderRadius: radius.xl, paddingBottom: 24 },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  title: { flex: 1 },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  body: { paddingHorizontal: 24, paddingTop: 8, gap: 16 },
});
