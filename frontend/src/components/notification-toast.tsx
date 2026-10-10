import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NOTIFICATION_ICON, notificationHref } from '@/lib/notification-route';
import { useLiveState } from '@/providers/live';
import { MAX_CONTENT_WIDTH, colors, fonts, radius, shadow } from '@/theme';

const VISIBLE_MS = 5000;

/** Slides in from the top when a notification arrives over /ws/me. Tap to open it. */
export function NotificationToast() {
  const { toast, dismissToast } = useLiveState();
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!toast) return;
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => dismissToast());
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast, anim, dismissToast]);

  if (!toast) return null;
  const icon = NOTIFICATION_ICON[toast.type] ?? 'notifications';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Animated.View
        style={[
          styles.toast,
          { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] },
        ]}
      >
        {/* Open and dismiss are siblings: buttons can't be nested on the web. */}
        <View style={styles.inner}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${toast.title}. ${toast.body}`}
            onPress={() => {
              dismissToast();
              router.push(notificationHref(toast));
            }}
            style={styles.open}
          >
            <View style={styles.icon}>
              <Ionicons name={icon} size={18} color={colors.accent} />
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {toast.title}
              </Text>
              <Text style={styles.body} numberOfLines={2}>
                {toast.body}
              </Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={dismissToast} hitSlop={10}>
            <Ionicons name="close" size={18} color={colors.onPrimaryMuted} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 100 },
  toast: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, borderRadius: radius.lg, backgroundColor: colors.primary, ...shadow.raised },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(246, 242, 233, 0.12)', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onPrimary },
  body: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.onPrimaryMuted },
});
