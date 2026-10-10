import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CreateGroupSheet, InviteSheet, JoinGroupSheet } from '@/components/group-sheets';
import { Screen } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { AppText, Avatar, Banner, Button, Card, Pill, type IconName } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/lib/api';
import type { GroupSummary, UserStats } from '@/lib/types';
import { useAuth, useMe } from '@/providers/auth';
import { useLive } from '@/providers/live';
import { colorFor, colors, fonts, initials, radius, shadow } from '@/theme';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const roleLabel = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

const fetchGroups = async () => (await api.listGroups()).items;

export default function HomeScreen() {
  const me = useMe();
  const live = useLive();
  const stats = useResource(api.getMyStats);
  const groups = useResource(fetchGroups);

  const [sheet, setSheet] = useState<'create' | 'join' | 'account' | null>(null);
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);

  const refreshing = stats.refreshing || groups.refreshing;
  const onRefresh = useCallback(() => {
    stats.refresh();
    groups.refresh();
  }, [stats, groups]);

  const firstName = me.displayName.split(' ')[0];

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="caption">{greeting()}</AppText>
          <AppText variant="display" numberOfLines={1}>
            {firstName}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account"
          onPress={() => setSheet('account')}
          style={({ pressed }) => [styles.avatarButton, pressed && { opacity: 0.8 }]}
        >
          <Avatar name={me.displayName} seed={me.id} size={46} />
          <View
            style={[styles.liveDot, { backgroundColor: live ? colors.live : colors.lineStrong }]}
            accessibilityLabel={live ? 'Online' : 'Offline'}
          />
        </Pressable>
      </View>

      {/* Hero */}
      <HeroCard stats={stats.data} loading={stats.loading} isAdult={me.isAdult} />
      {stats.error && !stats.data ? (
        <View style={styles.gapTop}>
          <Banner message={stats.error.message} action={{ label: 'Retry', onPress: stats.refresh }} />
        </View>
      ) : null}

      {/* Stats */}
      <View style={styles.statRow}>
        <StatTile
          icon="time-outline"
          label="Focused this week"
          value={stats.data ? formatMinutes(stats.data.weeklyStudyMinutes) : '—'}
        />
        <StatTile
          icon="flame-outline"
          label="Day streak"
          value={stats.data ? String(stats.data.currentStreakDays) : '—'}
        />
        <StatTile
          icon="trophy-outline"
          label="Win rate"
          value={stats.data?.winRate != null ? `${stats.data.winRate}%` : '—'}
        />
      </View>

      {/* Groups */}
      <View style={styles.sectionHeader}>
        <AppText variant="title">Your groups</AppText>
        {groups.data && groups.data.length > 0 ? (
          <View style={styles.sectionActions}>
            <Button title="Join" variant="secondary" size="sm" icon="enter-outline" onPress={() => setSheet('join')} />
            <Button title="New" size="sm" icon="add" onPress={() => setSheet('create')} />
          </View>
        ) : null}
      </View>

      {groups.loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : groups.error && !groups.data ? (
        <Banner message={groups.error.message} action={{ label: 'Retry', onPress: groups.refresh }} />
      ) : groups.data && groups.data.length > 0 ? (
        <View style={styles.groupList}>
          {groups.data.map((g) => (
            <GroupCard key={g.id} group={g} onInvite={() => setInviteGroupId(g.id)} />
          ))}
        </View>
      ) : (
        <EmptyGroups onCreate={() => setSheet('create')} onJoin={() => setSheet('join')} />
      )}

      <CreateGroupSheet visible={sheet === 'create'} onClose={() => setSheet(null)} onCreated={groups.reload} />
      <JoinGroupSheet visible={sheet === 'join'} onClose={() => setSheet(null)} onJoined={groups.reload} />
      <InviteSheet groupId={inviteGroupId} onClose={() => setInviteGroupId(null)} />
      <AccountSheet visible={sheet === 'account'} onClose={() => setSheet(null)} />
    </Screen>
  );
}

function HeroCard({ stats, loading, isAdult }: { stats: UserStats | null; loading: boolean; isAdult: boolean }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroLeafWrap} pointerEvents="none">
        <Ionicons name="leaf" size={180} color="rgba(246, 242, 233, 0.06)" />
      </View>
      <View style={styles.heroTop}>
        <Pill
          tone="onDark"
          icon={isAdult ? 'shield-checkmark' : 'leaf'}
          label={isAdult ? 'Tokens & money unlocked' : 'Token mode'}
        />
      </View>
      <Text style={styles.heroLabel}>Token balance</Text>
      <View style={styles.heroBalanceRow}>
        {loading && !stats ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <>
            <Text style={styles.heroBalance}>{stats ? stats.tokens.toLocaleString() : '—'}</Text>
            <Text style={styles.heroUnit}>tokens</Text>
          </>
        )}
      </View>
      <Text style={styles.heroSub}>
        {stats
          ? `${formatMinutes(stats.totalStudyMinutes)} focused all-time · ${stats.sessionsCompleted} sessions`
          : 'Stake tokens in a study session and keep them by passing the quiz.'}
      </Text>
    </View>
  );
}

function StatTile({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <AppText variant="caption" numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

function GroupCard({ group, onInvite }: { group: GroupSummary; onInvite: () => void }) {
  const tint = colorFor(group.id);
  return (
    <Card style={styles.groupCard}>
      <View style={[styles.groupBadge, { backgroundColor: tint }]}>
        <Text style={styles.groupBadgeText}>{initials(group.name)}</Text>
      </View>
      <View style={styles.groupBody}>
        <AppText variant="heading" numberOfLines={1}>
          {group.name}
        </AppText>
        {group.description ? (
          <AppText variant="caption" numberOfLines={1}>
            {group.description}
          </AppText>
        ) : null}
        <View style={styles.groupMeta}>
          <Pill
            icon="people-outline"
            label={`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`}
          />
          <Pill tone={group.myRole === 'member' ? 'neutral' : 'primary'} label={roleLabel[group.myRole]} />
          {group.activeSession ? <Pill tone="accent" icon="radio-button-on" label="Live session" /> : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Invite friends to ${group.name}`}
        onPress={onInvite}
        hitSlop={8}
        style={({ pressed }) => [styles.inviteButton, pressed && { backgroundColor: colors.line }]}
      >
        <Ionicons name="person-add-outline" size={18} color={colors.primary} />
      </Pressable>
    </Card>
  );
}

function EmptyGroups({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <Card style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="people" size={28} color={colors.primary} />
      </View>
      <AppText variant="heading" style={styles.centerText}>
        Study is better with stakes
      </AppText>
      <AppText style={styles.centerText}>
        Create a group for your class or study crew, or join one with an invite code.
      </AppText>
      <View style={styles.emptyActions}>
        <Button title="Create a group" icon="add" onPress={onCreate} style={styles.flex} />
        <Button title="Join with code" variant="secondary" onPress={onJoin} style={styles.flex} />
      </View>
    </Card>
  );
}

function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signOut } = useAuth();
  const me = useMe();
  const live = useLive();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Sheet visible={visible} onClose={onClose} title="Account">
      <View style={styles.accountRow}>
        <Avatar name={me.displayName} seed={me.id} size={56} />
        <View style={styles.flex}>
          <AppText variant="heading">{me.displayName}</AppText>
          <AppText variant="caption">@{me.username}</AppText>
          <AppText variant="caption">{me.email}</AppText>
        </View>
      </View>
      <View style={styles.accountPills}>
        <Pill tone={live ? 'primary' : 'neutral'} icon="radio-button-on" label={live ? 'Online' : 'Offline'} />
        <Pill
          tone={me.isAdult ? 'primary' : 'accent'}
          icon={me.isAdult ? 'shield-checkmark' : 'leaf'}
          label={me.isAdult ? 'Tokens & money' : 'Token mode'}
        />
      </View>
      <Button
        title="Sign out"
        icon="log-out-outline"
        variant="secondary"
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          onClose();
          await signOut();
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centerText: { textAlign: 'center' },
  gapTop: { marginTop: 12 },
  loader: { marginVertical: 32 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerText: { flex: 1, marginRight: 12 },
  avatarButton: { borderRadius: 26 },
  liveDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.bg,
  },

  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: 22,
    overflow: 'hidden',
    ...shadow.raised,
  },
  heroLeafWrap: { position: 'absolute', right: -30, top: -20, transform: [{ rotate: '-20deg' }] },
  heroTop: { flexDirection: 'row', marginBottom: 18 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onPrimaryMuted },
  heroBalanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, minHeight: 56, marginTop: 2 },
  heroBalance: { fontFamily: fonts.displayBold, fontSize: 48, lineHeight: 56, color: colors.onPrimary, letterSpacing: -1 },
  heroUnit: { fontFamily: fonts.semibold, fontSize: 16, color: colors.accent },
  heroSub: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onPrimaryMuted, marginTop: 8 },

  statRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 4,
  },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: colors.ink, marginTop: 4 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 32,
    marginBottom: 14,
    gap: 12,
  },
  sectionActions: { flexDirection: 'row', gap: 8 },

  groupList: { gap: 12 },
  groupCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  groupBadge: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  groupBadgeText: { fontFamily: fonts.bold, fontSize: 17, color: colors.onPrimary },
  groupBody: { flex: 1, gap: 4 },
  groupMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  inviteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 8 },

  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  accountPills: { flexDirection: 'row', gap: 8 },
});
