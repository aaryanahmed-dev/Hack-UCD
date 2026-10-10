import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/controls';
import { FriendSheet, STATUS_COLOR, STATUS_TEXT } from '@/components/friends/friend-sheet';
import { Screen } from '@/components/screen';
import { AppText, Avatar, Banner, Button, Card } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type {
  Friend,
  FriendRequest,
  GroupSummary,
  LeaderboardMetric,
  LeaderboardRow,
  LeaderboardScope,
  UserSummary,
} from '@/lib/types';
import { useMe } from '@/providers/auth';
import { useLiveState } from '@/providers/live';
import { colors, fonts, radius, shadow } from '@/theme';

type Tab = 'friends' | 'leaderboard';

export default function FriendsScreen() {
  const [tab, setTab] = useState<Tab>('friends');
  return (
    <Screen>
      <AppText variant="display" style={styles.title}>
        Friends
      </AppText>
      <View style={styles.segment}>
        {(['friends', 'leaderboard'] as Tab[]).map((t) => (
          <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} style={[styles.segmentItem, tab === t && styles.segmentOn]}>
            <Ionicons name={t === 'friends' ? 'people' : 'podium'} size={16} color={tab === t ? colors.ink : colors.muted} />
            <Text style={[styles.segmentText, tab === t && styles.segmentTextOn]}>{t === 'friends' ? 'Friends' : 'Leaderboard'}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'friends' ? <FriendsView /> : <LeaderboardView />}
    </Screen>
  );
}

// ───────── Friends ─────────

function FriendsView() {
  const live = useLiveState();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [records, setRecords] = useState<Record<string, LeaderboardRow>>({});
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Friend | null>(null);
  const load = useCallback(async () => {
    try {
      const [f, r, lb] = await Promise.all([api.listFriends(), api.friendRequests(), api.leaderboard('friends', 'tokens')]);
      setFriends(f.items);
      setRequests(r.items);
      setRecords(Object.fromEntries(lb.items.map((row) => [row.user.id, row])));
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 20_000);
      return () => clearInterval(t);
    }, [load]),
  );
  // New friend requests arrive live
  const { onNotification } = live;
  useEffect(() => onNotification((n) => n.type.startsWith('friend_') && load()), [onNotification, load]);

  const statusOf = (f: Friend) => live.friendStatus[f.user.id] ?? f.status;
  const incoming = requests.filter((r) => r.direction === 'incoming');
  const outgoing = requests.filter((r) => r.direction === 'outgoing');
  const sorted = [...(friends ?? [])].sort((a, b) => {
    const order = { studying: 0, online: 1, offline: 2 } as const;
    return order[statusOf(a)] - order[statusOf(b)] || a.user.displayName.localeCompare(b.user.displayName);
  });
  const onlineCount = sorted.filter((f) => statusOf(f) !== 'offline').length;

  async function respond(r: FriendRequest, accept: boolean) {
    try {
      if (accept) await api.acceptFriendRequest(r.id);
      else await api.deleteFriendRequest(r.id);
      load();
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  return (
    <View>
      <AddFriend onAdded={load} />
      {error ? <Banner message={error} action={{ label: 'Retry', onPress: load }} /> : null}

      {incoming.length ? (
        <>
          <Text style={styles.section}>Requests</Text>
          <Card style={styles.list}>
            {incoming.map((r, i) => (
              <View key={r.id} style={[styles.row, i > 0 && styles.divider]}>
                <Avatar name={r.user.displayName} seed={r.user.id} equipped={r.user.equipped} size={40} />
                <View style={styles.flex}>
                  <AppText variant="label">{r.user.displayName}</AppText>
                  <AppText variant="caption">@{r.user.username} wants to be friends</AppText>
                </View>
                <Button title="Accept" size="sm" onPress={() => respond(r, true)} />
                <Pressable accessibilityRole="button" accessibilityLabel={`Decline ${r.user.displayName}`} onPress={() => respond(r, false)} hitSlop={8} style={styles.iconBtn}>
                  <Ionicons name="close" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Text style={styles.section}>
        {friends ? `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}${onlineCount ? ` · ${onlineCount} online` : ''}` : 'Friends'}
      </Text>
      {!friends ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : friends.length === 0 ? (
        <Card style={styles.empty}>
          <Ionicons name="people-outline" size={30} color={colors.primary} />
          <AppText variant="heading">Study with friends</AppText>
          <AppText style={styles.center}>Add friends by username to see when they’re studying, compare stats and invite them to sessions.</AppText>
        </Card>
      ) : (
        <Card style={styles.list}>
          {sorted.map((f, i) => {
            const st = statusOf(f);
            const rec = records[f.user.id];
            return (
              <Pressable key={f.user.id} accessibilityRole="button" onPress={() => setSelected(f)} style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { opacity: 0.8 }]}>
                <View>
                  <Avatar name={f.user.displayName} seed={f.user.id} equipped={f.user.equipped} size={44} />
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[st] }]} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="label">{f.user.displayName}</AppText>
                  <Text style={[styles.statusText, st === 'studying' && { color: colors.accentInk }]}>
                    {STATUS_TEXT[st]}
                    {rec ? ` · ${METRICS[0].unit(rec.weeklyStudyMinutes)} this week` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.lineStrong} />
              </Pressable>
            );
          })}
        </Card>
      )}

      {outgoing.length ? (
        <>
          <Text style={styles.section}>Sent</Text>
          <Card style={styles.list}>
            {outgoing.map((r, i) => (
              <View key={r.id} style={[styles.row, i > 0 && styles.divider]}>
                <Avatar name={r.user.displayName} seed={r.user.id} equipped={r.user.equipped} size={36} />
                <View style={styles.flex}>
                  <AppText variant="label">{r.user.displayName}</AppText>
                  <AppText variant="caption">Waiting for @{r.user.username}</AppText>
                </View>
                <Button title="Cancel" size="sm" variant="ghost" onPress={() => respond(r, false)} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <FriendSheet
        friend={selected}
        status={selected ? statusOf(selected) : 'offline'}
        record={selected ? records[selected.user.id] ?? null : null}
        onClose={() => setSelected(null)}
        onRemoved={(id) => {
          setSelected(null);
          setFriends((list) => list?.filter((f) => f.user.id !== id) ?? null);
        }}
      />
    </View>
  );
}

function AddFriend({ onAdded }: { onAdded: () => void }) {
  const me = useMe();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const q = query.trim().replace(/^@/, '');
    if (q.length < 2) return;
    let active = true;
    const t = setTimeout(() => {
      api.searchUsers(q).then((r) => active && setResults(r.items.filter((u) => u.id !== me.id)), () => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, me.id]);

  async function add(username: string) {
    setBusy(username);
    setMessage(null);
    try {
      const r = await api.sendFriendRequest(username);
      setMessage({ tone: 'info', text: r.friend ? `You and ${r.friend.user.displayName} are now friends!` : `Request sent to @${username}.` });
      setQuery('');
      setResults([]);
      onAdded();
    } catch (e) {
      setMessage({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  }

  const showResults = query.trim().replace(/^@/, '').length >= 2;

  return (
    <View style={styles.add}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Add friends by username"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search usernames"
          style={[styles.searchInput, Platform.OS === 'web' && { outlineWidth: 0 }]}
        />
      </View>
      {showResults && results.length ? (
        <Card style={styles.list}>
          {results.slice(0, 5).map((u, i) => (
            <View key={u.id} style={[styles.row, i > 0 && styles.divider]}>
              <Avatar name={u.displayName} seed={u.id} equipped={u.equipped} size={36} />
              <View style={styles.flex}>
                <AppText variant="label">{u.displayName}</AppText>
                <AppText variant="caption">@{u.username}</AppText>
              </View>
              <Button title="Add" size="sm" icon="person-add-outline" loading={busy === u.username} onPress={() => add(u.username)} />
            </View>
          ))}
        </Card>
      ) : showResults ? (
        <AppText variant="caption" style={styles.noResults}>
          No one with a username starting “{query.trim()}”.
        </AppText>
      ) : null}
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
    </View>
  );
}

// ───────── Leaderboard ─────────

const METRICS: { value: LeaderboardMetric; label: string; unit: (v: number) => string }[] = [
  { value: 'weekly_study', label: 'This week', unit: (v) => (v < 60 ? `${v}m` : `${Math.floor(v / 60)}h ${v % 60}m`) },
  { value: 'avg_score', label: 'Avg score', unit: (v) => `${v}%` },
  { value: 'tokens', label: 'Tokens', unit: (v) => v.toLocaleString() },
];

function LeaderboardView() {
  const me = useMe();
  const [scope, setScope] = useState<LeaderboardScope>('friends');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [metric, setMetric] = useState<LeaderboardMetric>('weekly_study');
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [data, setData] = useState<{ items: LeaderboardRow[]; me: LeaderboardRow } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listGroups().then((r) => setGroups(r.items), () => {});
  }, []);

  useEffect(() => {
    let active = true;
    api.leaderboard(scope, metric, scope === 'group' ? groupId ?? undefined : undefined).then(
      (d) => active && (setData(d), setError(null)),
      (e) => active && setError(toApiError(e).message),
    );
    return () => {
      active = false;
    };
  }, [scope, metric, groupId]);

  const unit = METRICS.find((m) => m.value === metric)!.unit;
  const ranked = (data?.items ?? []).filter((r) => r.value !== null);
  const podium = ranked.slice(0, 3);
  const rest = data?.items.filter((r) => !podium.includes(r)) ?? [];
  const meVisible = data?.items.some((r) => r.user.id === me.id);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scopeScroll} contentContainerStyle={styles.scopeRow}>
        <ScopeChip label="Friends" on={scope === 'friends'} onPress={() => setScope('friends')} />
        <ScopeChip label="Global" on={scope === 'global'} onPress={() => setScope('global')} />
        {groups.map((g) => (
          <ScopeChip key={g.id} label={g.name} on={scope === 'group' && groupId === g.id} onPress={() => { setScope('group'); setGroupId(g.id); }} />
        ))}
      </ScrollView>
      <Chips options={METRICS.map((m) => ({ value: m.value, label: m.label }))} value={metric} onChange={setMetric} />
      {metric === 'avg_score' ? <AppText variant="caption" style={styles.hint}>Ranked after 3 or more quizzes.</AppText> : null}
      {error ? <Banner message={error} /> : null}

      {!data ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <>
          {podium.length ? (
            <View style={styles.podium}>
              {[podium[1], podium[0], podium[2]].map((r, i) =>
                r ? (
                  <View key={r.user.id} style={[styles.podiumCol, i === 1 && styles.podiumFirst]}>
                    {i === 1 ? <Ionicons name="trophy" size={22} color={colors.accent} /> : null}
                    <Avatar name={r.user.displayName} seed={r.user.id} equipped={r.user.equipped} size={i === 1 ? 60 : 48} />
                    <Text style={styles.podiumName} numberOfLines={1}>
                      {r.user.id === me.id ? 'You' : r.user.displayName}
                    </Text>
                    <Text style={styles.podiumValue}>{unit(r.value!)}</Text>
                    <View style={[styles.podiumBlock, { height: i === 1 ? 64 : i === 0 ? 44 : 30 }]}>
                      <Text style={styles.podiumRank}>{r.rank}</Text>
                    </View>
                  </View>
                ) : (
                  <View key={i} style={styles.podiumCol} />
                ),
              )}
            </View>
          ) : (
            <Card style={styles.empty}>
              <Ionicons name="podium-outline" size={30} color={colors.primary} />
              <AppText style={styles.center}>No rankings yet — finish a study session to get on the board.</AppText>
            </Card>
          )}

          {rest.length ? (
            <Card style={styles.list}>
              {rest.map((r, i) => (
                <LeaderRow key={r.user.id} row={r} unit={unit} isMe={r.user.id === me.id} divider={i > 0} />
              ))}
            </Card>
          ) : null}
          {!meVisible ? (
            <View style={styles.meRow}>
              <LeaderRow row={data.me} unit={unit} isMe divider={false} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function LeaderRow({ row, unit, isMe, divider }: { row: LeaderboardRow; unit: (v: number) => string; isMe: boolean; divider: boolean }) {
  const rivalry = row.wonFromMe && (row.wonFromMe.tokens || row.lostToMe?.tokens)
    ? `Won ${row.wonFromMe.tokens} from you · lost ${row.lostToMe?.tokens ?? 0} to you`
    : null;
  return (
    <View style={[styles.row, divider && styles.divider, isMe && styles.meHighlight]}>
      <Text style={styles.rank}>{row.rank ?? '–'}</Text>
      <Avatar name={row.user.displayName} seed={row.user.id} equipped={row.user.equipped} size={38} />
      <View style={styles.flex}>
        <AppText variant="label">{isMe ? `${row.user.displayName} (you)` : row.user.displayName}</AppText>
        <AppText variant="caption">{rivalry ?? `${row.sessionsCompleted} sessions`}</AppText>
      </View>
      <Text style={styles.value}>{row.value !== null ? unit(row.value) : '—'}</Text>
    </View>
  );
}

function ScopeChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" aria-selected={on} onPress={onPress} style={[styles.scope, on && styles.scopeOn]}>
      <Text style={[styles.scopeText, on && styles.scopeTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  title: { marginBottom: 14 },
  loader: { marginVertical: 24 },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 4, marginBottom: 16 },
  segmentItem: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: radius.sm },
  segmentOn: { backgroundColor: colors.surface, ...shadow.card },
  segmentText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.muted },
  segmentTextOn: { color: colors.ink },
  section: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkSoft, marginTop: 20, marginBottom: 8 },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconBtn: { padding: 6 },
  statusDot: { position: 'absolute', right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: colors.surface },
  statusText: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 1 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  add: { gap: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 50, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  searchInput: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: colors.ink, paddingVertical: 12 },
  noResults: { paddingHorizontal: 4 },
  scopeScroll: { flexGrow: 0 },
  scopeRow: { gap: 6, paddingBottom: 10, alignItems: 'center' },
  scope: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, maxWidth: 180 },
  scopeOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  scopeText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkSoft },
  scopeTextOn: { color: colors.surface },
  hint: { marginTop: 6 },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 20, marginBottom: 14 },
  podiumCol: { flex: 1, alignItems: 'center', gap: 4 },
  podiumFirst: { marginBottom: 0 },
  podiumName: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, maxWidth: '100%' },
  podiumValue: { fontFamily: fonts.medium, fontSize: 12, color: colors.inkSoft },
  podiumBlock: { alignSelf: 'stretch', marginTop: 4, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', paddingTop: 6 },
  podiumRank: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onPrimary },
  rank: { width: 22, fontFamily: fonts.bold, fontSize: 15, color: colors.muted, textAlign: 'center' },
  value: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  meRow: { marginTop: 10, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface, overflow: 'hidden' },
  meHighlight: { backgroundColor: colors.primarySoft },
});
