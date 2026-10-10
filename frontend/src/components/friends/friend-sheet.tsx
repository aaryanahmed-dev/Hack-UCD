import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { AppText, Avatar, Banner, Button, Pill } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { Friend, GroupSummary, LeaderboardRow, UserStats, UserStatus } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

export const STATUS_COLOR: Record<UserStatus, string> = { studying: colors.accent, online: colors.live, offline: colors.lineStrong };
export const STATUS_TEXT: Record<UserStatus, string> = { studying: 'Studying now', online: 'Online', offline: 'Offline' };

function hours(minutes: number) {
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim();
}

export function FriendSheet({
  friend,
  status,
  record,
  onClose,
  onRemoved,
}: {
  friend: Friend | null;
  status: UserStatus;
  record: LeaderboardRow | null;
  onClose: () => void;
  onRemoved: (userId: string) => void;
}) {
  return friend ? <FriendDetail friend={friend} status={status} record={record} onClose={onClose} onRemoved={onRemoved} /> : null;
}

function FriendDetail({
  friend,
  status,
  record,
  onClose,
  onRemoved,
}: {
  friend: Friend;
  status: UserStatus;
  record: LeaderboardRow | null;
  onClose: () => void;
  onRemoved: (userId: string) => void;
}) {
  const u = friend.user;
  const [stats, setStats] = useState<UserStats | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let active = true;
    api.userStats(u.id).then((s) => active && setStats(s), () => {});
    return () => {
      active = false;
    };
  }, [u.id]);

  async function openInvite() {
    setInviting(true);
    if (!groups) setGroups((await api.listGroups().catch(() => ({ items: [] }))).items);
  }

  async function invite(g: GroupSummary) {
    setBusy(g.id);
    setMessage(null);
    try {
      await api.inviteToGroup(g.id, u.id);
      setMessage({ tone: 'info', text: `Invited ${u.displayName} to ${g.name}.` });
      setInviting(false);
    } catch (e) {
      setMessage({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  }

  const won = record?.wonFromMe;
  const lost = record?.lostToMe;

  return (
    <Sheet visible onClose={onClose} title={u.displayName}>
      <View style={styles.top}>
        <View>
          <Avatar name={u.displayName} seed={u.id} equipped={u.equipped} size={64} />
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
        </View>
        <View style={styles.flex}>
          <AppText variant="caption">@{u.username}</AppText>
          <Text style={[styles.status, { color: status === 'offline' ? colors.muted : colors.ink }]}>{STATUS_TEXT[status]}</Text>
          {status === 'studying' && friend.currentSessionId ? (
            <Button
              title="Watch session"
              size="sm"
              variant="secondary"
              icon="eye-outline"
              onPress={() => {
                onClose();
                router.push(`/sessions/${friend.currentSessionId}`);
              }}
              style={styles.watch}
            />
          ) : null}
        </View>
      </View>

      {!stats ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.grid}>
          <Stat label="Studied" value={hours(stats.totalStudyMinutes)} />
          <Stat label="This week" value={hours(stats.weeklyStudyMinutes)} />
          <Stat label="Streak" value={`${stats.currentStreakDays}d`} />
          <Stat label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : '—'} />
          <Stat label="Avg score" value={stats.averageQuizScore != null ? `${stats.averageQuizScore}%` : '—'} />
          <Stat label="Tokens" value={stats.tokens.toLocaleString()} />
        </View>
      )}

      {won && lost ? (
        <View style={styles.rivalry}>
          <AppText variant="label">Head to head</AppText>
          <View style={styles.rivalryRow}>
            <View style={styles.flex}>
              <Text style={[styles.rivalryValue, { color: colors.danger }]}>{won.tokens}</Text>
              <AppText variant="caption">tokens {u.displayName} won from you{won.coins ? ` · €${(won.coins / 100).toFixed(2)}` : ''}</AppText>
            </View>
            <View style={styles.flex}>
              <Text style={[styles.rivalryValue, { color: colors.primary }]}>{lost.tokens}</Text>
              <AppText variant="caption">tokens you won from {u.displayName}{lost.coins ? ` · €${(lost.coins / 100).toFixed(2)}` : ''}</AppText>
            </View>
          </View>
        </View>
      ) : null}

      {message ? <Banner tone={message.tone} message={message.text} /> : null}

      {inviting ? (
        <View style={styles.groupList}>
          <AppText variant="label">Invite to which group?</AppText>
          {!groups ? (
            <ActivityIndicator color={colors.primary} />
          ) : groups.length === 0 ? (
            <AppText variant="caption">You’re not in any groups yet — create one on the Home tab.</AppText>
          ) : (
            groups.map((g) => (
              <Pressable key={g.id} accessibilityRole="button" onPress={() => invite(g)} style={styles.groupRow} disabled={busy !== null}>
                <Ionicons name="people-outline" size={18} color={colors.primary} />
                <Text style={styles.groupName}>{g.name}</Text>
                {busy === g.id ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="paper-plane-outline" size={16} color={colors.muted} />}
              </Pressable>
            ))
          )}
        </View>
      ) : (
        <Button title="Invite to study" icon="paper-plane-outline" onPress={openInvite} />
      )}

      {confirmRemove ? (
        <View style={styles.confirm}>
          <AppText style={styles.flex}>Remove {u.displayName} as a friend?</AppText>
          <Button
            title="Remove"
            size="sm"
            variant="secondary"
            loading={busy === 'remove'}
            onPress={async () => {
              setBusy('remove');
              try {
                await api.unfriend(u.id);
                onRemoved(u.id);
              } catch (e) {
                setMessage({ tone: 'error', text: toApiError(e).message });
                setBusy(null);
              }
            }}
          />
          <Button title="Cancel" size="sm" variant="ghost" onPress={() => setConfirmRemove(false)} />
        </View>
      ) : (
        <Button title="Remove friend" variant="ghost" size="sm" onPress={() => setConfirmRemove(true)} />
      )}
      <Pill tone="neutral" icon="people-outline" label={`Friends since ${new Date(friend.since).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`} />
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dot: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.bg },
  status: { fontFamily: fonts.semibold, fontSize: 15, marginTop: 2 },
  watch: { alignSelf: 'flex-start', marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '31%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12 },
  statValue: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  rivalry: { gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  rivalryRow: { flexDirection: 'row', gap: 12 },
  rivalryValue: { fontFamily: fonts.display, fontSize: 26 },
  groupList: { gap: 8 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  groupName: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
