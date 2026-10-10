import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { PageHeader } from '@/components/controls';
import { Screen } from '@/components/screen';
import { AppText, Banner, Button, Card } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import { timeAgo } from '@/lib/dates';
import { NOTIFICATION_ICON, notificationHref } from '@/lib/notification-route';
import type { AppNotification } from '@/lib/types';
import { useLiveState } from '@/providers/live';
import { colors, fonts, radius } from '@/theme';

type ActionState = { busy?: boolean; done?: string; error?: string };

export default function NotificationsScreen() {
  const live = useLiveState();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actions, setActions] = useState<Record<string, ActionState>>({});

  const load = useCallback(async () => {
    try {
      setItems((await api.notifications()).items);
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Opening the list marks everything as read (unread dots stay visible until you leave).
  const { markAllRead, onNotification } = live;
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        markAllRead();
      };
    }, [load, markAllRead]),
  );
  useEffect(() => onNotification((n) => setItems((list) => (list ? [n, ...list] : [n]))), [onNotification]);

  async function act(n: AppNotification, fn: () => Promise<string | void>) {
    setActions((a) => ({ ...a, [n.id]: { busy: true } }));
    try {
      const done = (await fn()) ?? undefined;
      setActions((a) => ({ ...a, [n.id]: { done } }));
    } catch (e) {
      setActions((a) => ({ ...a, [n.id]: { error: toApiError(e).message } }));
    }
  }

  function renderActions(n: AppNotification) {
    const state = actions[n.id] ?? {};
    if (state.done) {
      return (
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
          <AppText variant="caption" style={{ color: colors.primary }}>
            {state.done}
          </AppText>
        </View>
      );
    }
    let buttons = null;
    if (n.type === 'friend_request' && n.data.requestId) {
      buttons = (
        <>
          <Button
            title="Accept"
            size="sm"
            loading={state.busy}
            onPress={() => act(n, async () => {
              await api.acceptFriendRequest(n.data.requestId);
              return 'You’re now friends';
            })}
            style={styles.flex}
          />
          <Button
            title="Decline"
            size="sm"
            variant="secondary"
            onPress={() => act(n, async () => {
              await api.deleteFriendRequest(n.data.requestId);
              return 'Declined';
            })}
            style={styles.flex}
          />
        </>
      );
    } else if (n.type === 'group_invite' && n.data.inviteCode) {
      buttons = (
        <Button
          title={`Join ${n.data.groupName ?? 'group'}`}
          size="sm"
          icon="enter-outline"
          loading={state.busy}
          onPress={() => act(n, async () => {
            try {
              const g = await api.joinGroup(n.data.inviteCode);
              router.push(`/groups/${g.id}`);
            } catch (e) {
              if (toApiError(e).code === 'already_member') {
                router.push(`/groups/${n.data.groupId}`);
                return 'Already a member';
              }
              throw e;
            }
          })}
          style={styles.flex}
        />
      );
    }
    return (
      <>
        {buttons ? <View style={styles.actions}>{buttons}</View> : null}
        {state.error ? <Banner message={state.error} /> : null}
      </>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <PageHeader title="Notifications" />
      {error ? <Banner message={error} action={{ label: 'Retry', onPress: load }} /> : null}
      {!items ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : items.length === 0 ? (
        <Card style={styles.empty}>
          <Ionicons name="notifications-off-outline" size={30} color={colors.muted} />
          <AppText variant="heading">You’re all caught up</AppText>
          <AppText style={styles.center}>Friend requests, study invites and session results show up here.</AppText>
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((n) => (
            // The tappable row and the action buttons are siblings (no buttons inside buttons on the web).
            <View key={n.id} style={[styles.item, !n.readAt && styles.unread]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const href = notificationHref(n);
                  if (href !== '/notifications') router.push(href);
                }}
                style={({ pressed }) => [styles.itemMain, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.icon}>
                  <Ionicons name={NOTIFICATION_ICON[n.type] ?? 'notifications'} size={18} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title} numberOfLines={2}>
                      {n.title}
                    </Text>
                    {!n.readAt ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
                  </View>
                  <AppText variant="caption">{n.body}</AppText>
                  <AppText variant="caption" style={styles.time}>
                    {timeAgo(n.createdAt)}
                  </AppText>
                </View>
              </Pressable>
              <View style={styles.itemActions}>{renderActions(n)}</View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  loader: { marginTop: 40 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  list: { gap: 10 },
  item: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  unread: { borderColor: colors.primary, backgroundColor: '#F7FBF7' },
  itemMain: { flexDirection: 'row', gap: 12 },
  itemActions: { marginLeft: 50 },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, lineHeight: 21 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent, marginTop: 6 },
  time: { marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
});
