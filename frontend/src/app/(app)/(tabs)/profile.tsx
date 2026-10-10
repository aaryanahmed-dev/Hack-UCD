import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ActivityChart } from '@/components/activity-chart';
import { formatSigned } from '@/components/session/format';
import { Screen } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { AppText, Avatar, Banner, Button, Card, Pill, TextField, type IconName } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { ActivityDay, SessionSummary, UserStats } from '@/lib/types';
import { useAuth, useMe } from '@/providers/auth';
import { useLive } from '@/providers/live';
import { colors, fonts, radius, shadow } from '@/theme';

function fmtMinutes(m: number) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

const euro = (coins: number) => `€${(coins / 100).toFixed(2)}`;

export default function ProfileScreen() {
  const me = useMe();
  const live = useLive();
  const { signOut } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [days, setDays] = useState<ActivityDay[] | null>(null);
  const [past, setPast] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a, p] = await Promise.all([api.getMyStats(), api.activity(14), api.mySessions('past')]);
      setStats(s);
      setDays(a.days);
      setPast(p.items.slice(0, 5));
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const fortnight = days?.reduce((s, d) => s + d.studyMinutes, 0) ?? 0;
  const activeDays = days?.filter((d) => d.studyMinutes > 0).length ?? 0;
  const decided = stats ? stats.wins + stats.losses : 0;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}>
      {/* Identity */}
      <View style={styles.identity}>
        <View>
          <Avatar name={me.displayName} seed={me.id} equipped={me.equipped} size={72} />
          <View style={[styles.liveDot, { backgroundColor: live ? colors.live : colors.lineStrong }]} />
        </View>
        <View style={styles.flex}>
          <AppText variant="title">{me.displayName}</AppText>
          <AppText variant="caption">
            @{me.username} · {me.email}
          </AppText>
          <View style={styles.pills}>
            <Pill tone={me.isAdult ? 'primary' : 'accent'} icon={me.isAdult ? 'shield-checkmark' : 'leaf'} label={me.isAdult ? 'Tokens & money' : 'Token mode'} />
            <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={styles.editBtn}>
              <Ionicons name="create-outline" size={14} color={colors.primary} />
              <Text style={styles.editText}>Edit name</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {error ? <Banner message={error} action={{ label: 'Retry', onPress: load }} /> : null}

      {!stats ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <>
          {/* Headline numbers */}
          <View style={styles.hero}>
            <View style={styles.heroMain}>
              <Text style={styles.heroLabel}>Total study time</Text>
              <Text style={styles.heroValue}>{fmtMinutes(stats.totalStudyMinutes)}</Text>
              <Text style={styles.heroSub}>
                {stats.sessionsCompleted} {stats.sessionsCompleted === 1 ? 'session' : 'sessions'} · {fmtMinutes(stats.weeklyStudyMinutes)} this week
              </Text>
            </View>
            <View style={styles.streak}>
              <Ionicons name="flame" size={26} color={stats.currentStreakDays ? colors.accent : colors.onPrimaryMuted} />
              <Text style={styles.streakValue}>{stats.currentStreakDays}</Text>
              <Text style={styles.streakLabel}>day streak</Text>
              <Text style={styles.streakBest}>best {stats.longestStreakDays}</Text>
            </View>
          </View>

          {/* Win / loss */}
          <Card style={styles.winCard}>
            <View style={styles.winTop}>
              <View>
                <AppText variant="caption">Win / loss</AppText>
                <Text style={styles.winValue}>
                  {stats.wins}
                  <Text style={styles.winSep}> – </Text>
                  {stats.losses}
                </Text>
              </View>
              <View style={styles.winRate}>
                <Text style={styles.winRateValue}>{stats.winRate != null ? `${stats.winRate}%` : '—'}</Text>
                <AppText variant="caption">win rate</AppText>
              </View>
            </View>
            <View style={styles.ratio} accessibilityLabel={`${stats.wins} wins, ${stats.losses} losses`}>
              {decided ? (
                <>
                  <View style={[styles.ratioWin, { flex: stats.wins || 0.0001 }]} />
                  <View style={[styles.ratioLoss, { flex: stats.losses || 0.0001 }]} />
                </>
              ) : (
                <View style={[styles.ratioEmpty, { flex: 1 }]} />
              )}
            </View>
            <View style={styles.ratioLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: colors.primary }]} />
                <AppText variant="caption">Passed</AppText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: colors.accent }]} />
                <AppText variant="caption">Didn’t pass</AppText>
              </View>
            </View>
          </Card>

          {/* Tiles */}
          <View style={styles.tiles}>
            <Tile icon="leaf-outline" label="Lifetime tokens earned" value={stats.lifetimeTokensEarned.toLocaleString()} sub={`${stats.tokens.toLocaleString()} in your balance`} />
            <Tile icon="school-outline" label="Average quiz score" value={stats.averageQuizScore != null ? `${stats.averageQuizScore}%` : '—'} sub="across all sessions" />
            {me.isAdult ? (
              <>
                <Tile icon="cash-outline" label="Cash won" value={euro(stats.coinsWon)} sub="from money sessions" />
                <Tile icon="heart-outline" label="Donated" value={euro(stats.coinsDonated)} sub="to charities" />
              </>
            ) : null}
          </View>

          {/* Activity */}
          <Card style={styles.chartCard}>
            <View style={styles.chartHead}>
              <View style={styles.flex}>
                <AppText variant="heading">Study time, last 14 days</AppText>
                <AppText variant="caption">
                  {fmtMinutes(fortnight)} total · studied on {activeDays} of 14 days
                </AppText>
              </View>
            </View>
            {days ? <ActivityChart days={days} /> : null}
          </Card>

          {/* Recent sessions */}
          {past.length ? (
            <>
              <AppText variant="heading" style={styles.sectionTitle}>
                Recent sessions
              </AppText>
              <Card style={styles.list}>
                {past.map((s, i) => (
                  <Pressable key={s.id} onPress={() => router.push(`/sessions/${s.id}`)} style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { opacity: 0.7 }]}>
                    <View style={[styles.resultIcon, { backgroundColor: s.myResult?.passed ? colors.primarySoft : s.status === 'cancelled' ? colors.surfaceAlt : colors.accentSoft }]}>
                      <Ionicons
                        name={s.status === 'cancelled' ? 'close' : s.myResult?.passed ? 'trophy' : 'leaf-outline'}
                        size={16}
                        color={s.status === 'cancelled' ? colors.muted : s.myResult?.passed ? colors.primary : colors.accentInk}
                      />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="label" numberOfLines={1}>
                        {s.title}
                      </AppText>
                      <AppText variant="caption">
                        {s.group.name}
                        {s.settledAt ?? s.startedAt ? ` · ${new Date((s.settledAt ?? s.startedAt)!).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}
                      </AppText>
                    </View>
                    {s.myResult ? (
                      <Text style={[styles.net, { color: s.myResult.netAmount >= 0 ? colors.primary : colors.danger }]}>{formatSigned(s.myResult.netAmount, s.mode)}</Text>
                    ) : (
                      <AppText variant="caption">{s.status === 'cancelled' ? 'Cancelled' : ''}</AppText>
                    )}
                  </Pressable>
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}

      <View style={styles.links}>
        <LinkRow icon="wallet-outline" title="Wallet" subtitle={me.isAdult ? (me.verificationRequired && !me.idVerified ? 'Verify your ID to use real money' : 'Buy coins, see your history') : 'Tokens and history'} onPress={() => router.push('/wallet')} />
        <LinkRow icon="storefront-outline" title="Token store" subtitle="Avatars, frames and streak freezes" onPress={() => router.push('/store')} />
      </View>

      <Button title="Sign out" variant="secondary" icon="log-out-outline" onPress={signOut} style={styles.signOut} />

      {editing ? <EditNameSheet onClose={() => setEditing(false)} /> : null}
    </Screen>
  );
}

function LinkRow({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.8 }]}>
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption">{subtitle}</AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.lineStrong} />
    </Pressable>
  );
}

function Tile({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub: string }) {
  return (
    <View style={styles.tile}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.tileValue}>{value}</Text>
      <AppText variant="label">{label}</AppText>
      <AppText variant="caption">{sub}</AppText>
    </View>
  );
}

function EditNameSheet({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { setMe } = useAuth();
  const [name, setName] = useState(me.displayName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet visible onClose={onClose} title="Edit profile">
      {error ? <Banner message={error} /> : null}
      <TextField label="Display name" value={name} onChangeText={setName} maxLength={40} autoFocus />
      <Button
        title="Save"
        icon="checkmark"
        loading={saving}
        onPress={async () => {
          setSaving(true);
          try {
            setMe(await api.updateMe({ displayName: name.trim() }));
            onClose();
          } catch (e) {
            setError(toApiError(e).message);
            setSaving(false);
          }
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginVertical: 30 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  liveDot: { position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.bg },
  pills: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  editText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.primary },
  hero: { flexDirection: 'row', backgroundColor: colors.primary, borderRadius: radius.xl, padding: 20, gap: 16, ...shadow.raised },
  heroMain: { flex: 1, gap: 2 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onPrimaryMuted },
  heroValue: { fontFamily: fonts.displayBold, fontSize: 40, lineHeight: 48, color: colors.onPrimary },
  heroSub: { fontFamily: fonts.body, fontSize: 13, color: colors.onPrimaryMuted },
  streak: { alignItems: 'center', justifyContent: 'center', paddingLeft: 16, borderLeftWidth: 1, borderLeftColor: 'rgba(246, 242, 233, 0.15)' },
  streakValue: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.onPrimary, lineHeight: 34 },
  streakLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.onPrimaryMuted },
  streakBest: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent, marginTop: 2 },
  winCard: { marginTop: 14, gap: 10 },
  winTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  winValue: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  winSep: { color: colors.lineStrong },
  winRate: { alignItems: 'flex-end' },
  winRateValue: { fontFamily: fonts.display, fontSize: 24, color: colors.primary },
  ratio: { flexDirection: 'row', height: 10, gap: 2, borderRadius: 5, overflow: 'hidden' },
  ratioWin: { backgroundColor: colors.primary, borderRadius: 5 },
  ratioLoss: { backgroundColor: colors.accent, borderRadius: 5 },
  ratioEmpty: { backgroundColor: colors.surfaceAlt },
  ratioLegend: { flexDirection: 'row', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  tile: { width: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 3 },
  tileValue: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, marginTop: 4 },
  chartCard: { marginTop: 14, gap: 4 },
  chartHead: { flexDirection: 'row' },
  sectionTitle: { marginTop: 24, marginBottom: 10 },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  resultIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  net: { fontFamily: fonts.semibold, fontSize: 14 },
  signOut: { marginTop: 20 },
  links: { gap: 10, marginTop: 24 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  linkIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
