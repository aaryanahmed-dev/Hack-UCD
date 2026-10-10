import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { PageHeader, SectionTitle } from '@/components/controls';
import { EditGroupButton, EditGroupSheet, InviteFriendsSheet } from '@/components/group-manage';
import { InviteCode } from '@/components/group-sheets';
import { Screen } from '@/components/screen';
import { SessionConfigSheet } from '@/components/session/config-sheet';
import { STATUS_LABEL, formatSigned } from '@/components/session/format';
import { AppText, Avatar, Banner, Button, Card, Pill } from '@/components/ui';
import { ApiError, api, toApiError } from '@/lib/api';
import type { GroupDetail, SessionSummary, UserStatus } from '@/lib/types';
import { colors, fonts, radius, shadow } from '@/theme';

const STATUS_DOT: Record<UserStatus, string> = { online: colors.live, studying: colors.accent, offline: colors.lineStrong };
const STATUS_TEXT: Record<UserStatus, string> = { online: 'Online', studying: 'Studying', offline: 'Offline' };

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [past, setPast] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<'edit' | 'invite' | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, history] = await Promise.all([api.getGroup(id), api.groupSessions(id, 'past')]);
      setGroup(g);
      setPast(history.items);
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  // Reload whenever the screen comes back into view (e.g. after a session).
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, 10_000); // keep member status fresh
      return () => clearInterval(timer);
    }, [load]),
  );

  if (!group) {
    return (
      <Screen>
        <PageHeader title="Group" />
        {error ? <Banner message={error.message} action={{ label: 'Retry', onPress: load }} /> : <ActivityIndicator color={colors.primary} style={styles.loader} />}
      </Screen>
    );
  }

  const active = group.activeSession;

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
      <PageHeader
        title={group.name}
        subtitle={`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`}
        right={group.myRole !== 'member' ? <EditGroupButton onPress={() => setManaging('edit')} /> : undefined}
      />
      {group.description ? <AppText style={styles.description}>{group.description}</AppText> : null}

      {/* Live session / start */}
      {active ? (
        <View style={styles.liveCard}>
          <View style={styles.liveTop}>
            <Pill tone="onDark" icon="radio-button-on" label={STATUS_LABEL[active.status as keyof typeof STATUS_LABEL] ?? active.status} />
          </View>
          <Text style={styles.liveTitle}>A session is {active.status === 'lobby' ? 'getting ready' : 'in progress'}</Text>
          <Text style={styles.liveSub}>
            {active.status === 'lobby' ? 'Join the lobby to agree on the stakes and material.' : 'Open it to watch or rejoin.'}
          </Text>
          <Button title={active.status === 'lobby' ? 'Open lobby' : 'Open session'} variant="light" icon="arrow-forward" onPress={() => router.push(`/sessions/${active.id}`)} style={styles.liveButton} />
        </View>
      ) : (
        <View style={styles.liveCard}>
          <Ionicons name="timer-outline" size={28} color={colors.accent} />
          <Text style={styles.liveTitle}>Start a study session</Text>
          <Text style={styles.liveSub}>
            Pick a duration and a stake, agree on the material, then study. A quiz at the end decides who keeps their stake.
          </Text>
          <Button title="New session" variant="light" icon="add" onPress={() => setCreating(true)} style={styles.liveButton} />
        </View>
      )}

      {/* Stats */}
      <View style={styles.statRow}>
        <Stat label="Hours together" value={String(Math.floor(group.stats.totalFocusedMinutes / 60))} />
        <Stat label="Sessions" value={String(group.stats.sessionsCompleted)} />
        <Stat label="Avg score" value={group.stats.averageQuizScore != null ? `${group.stats.averageQuizScore}%` : '—'} />
      </View>

      {/* Members */}
      <SectionTitle title="Members" />
      <Card style={styles.list}>
        {group.members.map((m, i) => (
          <View key={m.user.id} style={[styles.memberRow, i > 0 && styles.divider]}>
            <View>
              <Avatar name={m.user.displayName} seed={m.user.id} equipped={m.user.equipped} size={40} />
              <View style={[styles.dot, { backgroundColor: STATUS_DOT[m.status] }]} />
            </View>
            <View style={styles.flex}>
              <AppText variant="label">{m.user.displayName}</AppText>
              <AppText variant="caption">
                @{m.user.username} · {STATUS_TEXT[m.status]}
              </AppText>
            </View>
            {m.role !== 'member' ? <Pill tone="primary" label={m.role === 'owner' ? 'Owner' : 'Admin'} /> : null}
          </View>
        ))}
      </Card>

      <SectionTitle title="Invite friends" right={<Button title="Invite a friend" size="sm" variant="secondary" icon="person-add-outline" onPress={() => setManaging('invite')} />} />
      <InviteCode group={group} />

      {/* Milestones */}
      <SectionTitle title="Milestones" />
      <Card style={styles.list}>
        {group.milestones.slice(0, 5).map((m, i) => (
          <View key={m.id} style={[styles.milestone, i > 0 && styles.divider]}>
            <View style={styles.milestoneTop}>
              <AppText variant="label">{m.title}</AppText>
              <AppText variant="caption">
                {Math.min(m.progress, m.target)}/{m.target}
              </AppText>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (100 * m.progress) / m.target)}%` }]} />
            </View>
          </View>
        ))}
      </Card>

      {/* History */}
      {past.length > 0 ? (
        <>
          <SectionTitle title="Past sessions" />
          <Card style={styles.list}>
            {past.map((s, i) => (
              <Pressable
                key={s.id}
                onPress={() => router.push(`/sessions/${s.id}`)}
                style={({ pressed }) => [styles.pastRow, i > 0 && styles.divider, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.flex}>
                  <AppText variant="label" numberOfLines={1}>
                    {s.title}
                  </AppText>
                  <AppText variant="caption">
                    {s.status === 'cancelled' ? 'Cancelled' : `${s.participantCount} people`} ·{' '}
                    {s.settledAt ?? s.startedAt ? new Date((s.settledAt ?? s.startedAt)!).toLocaleDateString() : 'not started'}
                  </AppText>
                </View>
                {s.myResult ? (
                  <Pill
                    tone={s.myResult.passed ? 'primary' : 'accent'}
                    label={`${s.myResult.passed ? 'Passed' : 'Failed'} ${formatSigned(s.myResult.netAmount, s.mode)}`}
                  />
                ) : null}
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {managing === 'edit' ? (
        <EditGroupSheet
          group={group}
          onClose={() => setManaging(null)}
          onSaved={(g) => {
            setManaging(null);
            setGroup(g);
          }}
        />
      ) : null}
      {managing === 'invite' ? <InviteFriendsSheet group={group} onClose={() => setManaging(null)} /> : null}

      <SessionConfigSheet
        visible={creating}
        groupId={group.id}
        onClose={() => setCreating(false)}
        onSaved={(s) => {
          setCreating(false);
          router.push(`/sessions/${s.id}`);
        }}
      />
    </Screen>
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
  loader: { marginTop: 40 },
  description: { marginTop: -8, marginBottom: 16 },
  liveCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: 22, gap: 8, ...shadow.raised },
  liveTop: { flexDirection: 'row' },
  liveTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.onPrimary, marginTop: 4 },
  liveSub: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onPrimaryMuted },
  liveButton: { marginTop: 8 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.surface },
  milestone: { padding: 14, gap: 8 },
  milestoneTop: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
});
