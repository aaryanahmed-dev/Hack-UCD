import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { EventSheet } from '@/components/calendar/event-sheet';
import { Screen } from '@/components/screen';
import { AppText, Banner, Button, Card } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import { WEEKDAY_INITIALS, addDays, addMonths, formatDayLabel, formatTime, monthGrid, sameDay, startOfDay } from '@/lib/dates';
import type { CalendarEvent, EventKind, GoogleStatus, Todo } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

type Kind = EventKind | 'task';

const KIND: Record<Kind, { color: string; label: string; icon: 'school' | 'document-text' | 'people' | 'ellipse' | 'checkbox' }> = {
  exam: { color: colors.danger, label: 'Exam', icon: 'school' },
  assignment: { color: colors.accent, label: 'Assignment', icon: 'document-text' },
  study_session: { color: colors.primary, label: 'Study session', icon: 'people' },
  other: { color: '#3B5B8C', label: 'Event', icon: 'ellipse' },
  task: { color: '#7A3B5C', label: 'Task due', icon: 'checkbox' },
};

type Item = {
  key: string;
  kind: Kind;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  subtitle: string | null;
  source: 'manual' | 'google' | 'session' | 'task';
  event?: CalendarEvent;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function CalendarScreen() {
  const params = useLocalSearchParams<{ google?: string }>();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ event?: CalendarEvent } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(params.google === 'connected' ? 'Google Calendar connected.' : null);

  const grid = useMemo(() => monthGrid(month), [month]);

  const load = useCallback(async () => {
    try {
      const [r, t, g] = await Promise.all([
        api.calendarEvents(grid[0].toISOString(), addDays(grid[41], 1).toISOString()),
        api.listTodos(),
        api.googleStatus(),
      ]);
      setEvents(r.items);
      setGoogleError(r.googleError);
      setTodos(t.items.filter((x) => x.dueAt && !x.isDone));
      setGoogle(g);
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    }
  }, [grid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );


  const items: Item[] = useMemo(() => {
    const out: Item[] = (events ?? []).map((e) => ({
      key: `${e.source}-${e.id}`,
      kind: e.kind,
      title: e.title,
      start: new Date(e.startsAt),
      end: e.endsAt ? new Date(e.endsAt) : null,
      allDay: e.allDay,
      subtitle: e.source === 'session' ? e.groupName : e.source === 'google' ? 'Google Calendar' : null,
      source: e.source,
      event: e,
    }));
    for (const t of todos) {
      out.push({ key: `task-${t.id}`, kind: 'task', title: t.title, start: new Date(t.dueAt!), end: null, allDay: false, subtitle: 'Task', source: 'task' });
    }
    return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
  }, [events, todos]);

  const byDay = useMemo(() => {
    const map: Record<string, Item[]> = {};
    for (const it of items) (map[dayKey(it.start)] ??= []).push(it);
    return map;
  }, [items]);

  const dayItems = byDay[dayKey(selected)] ?? [];
  const upcoming = items.filter((it) => it.start >= startOfDay(new Date()) && (it.kind === 'exam' || it.kind === 'assignment')).slice(0, 3);
  const today = new Date();

  async function connectGoogle() {
    setConnecting(true);
    setError(null);
    try {
      const returnTo = Platform.OS === 'web' ? `${window.location.origin}/calendar` : Linking.createURL('calendar');
      const { authUrl } = await api.googleConnect(returnTo);
      if (Platform.OS === 'web') {
        window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnTo);
      if (result.type === 'success' && result.url.includes('google=connected')) setNotice('Google Calendar connected.');
      else if (result.type === 'success') setError('Couldn’t connect Google Calendar. Try again.');
      load();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setConnecting(false);
    }
  }

  function openItem(it: Item) {
    if (it.source === 'session' && it.event?.sessionId) router.push(`/sessions/${it.event.sessionId}`);
    else if (it.source === 'manual') setSheet({ event: it.event });
    else if (it.source === 'google' && it.event?.htmlLink) Linking.openURL(it.event.htmlLink);
    else if (it.source === 'task') router.push('/tasks');
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="display">Calendar</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="New event" onPress={() => setSheet({})} style={styles.newBtn}>
          <Ionicons name="add" size={24} color={colors.onPrimary} />
        </Pressable>
      </View>

      {notice ? <Banner tone="info" message={notice} action={{ label: 'OK', onPress: () => setNotice(null) }} /> : null}
      {error ? <Banner message={error} action={{ label: 'Retry', onPress: load }} /> : null}
      {params.google === 'error' && !google?.connected ? <Banner message="Couldn’t connect Google Calendar. Try again below." /> : null}

      {/* Month */}
      <Card style={styles.monthCard}>
        <View style={styles.monthHead}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(addMonths(month, -1))} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.ink} />
          </Pressable>
          <Text style={styles.monthTitle}>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonth(addMonths(month, 1))} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={18} color={colors.ink} />
          </Pressable>
        </View>
        <View style={styles.weekRow}>
          {WEEKDAY_INITIALS.map((d, i) => (
            <Text key={i} style={styles.weekday}>
              {d}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {grid.map((d) => {
            const inMonth = d.getMonth() === month.getMonth();
            const isSel = sameDay(d, selected);
            const isToday = sameDay(d, today);
            const dayList = byDay[dayKey(d)] ?? [];
            const kinds = [...new Set(dayList.map((x) => x.kind))].slice(0, 3);
            return (
              <Pressable
                key={dayKey(d)}
                accessibilityRole="button"
                accessibilityLabel={`${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}, ${dayList.length} items`}
                aria-selected={isSel}
                onPress={() => {
                  setSelected(startOfDay(d));
                  if (!inMonth) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                }}
                style={styles.cell}
              >
                <View style={[styles.day, isToday && styles.today, isSel && styles.sel]}>
                  <Text style={[styles.dayText, !inMonth && styles.outside, isSel && styles.selText]}>{d.getDate()}</Text>
                </View>
                <View style={styles.dots}>
                  {kinds.map((k) => (
                    <View key={k} style={[styles.dot, { backgroundColor: KIND[k].color }]} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.legend}>
          {(Object.keys(KIND) as Kind[]).map((k) => (
            <View key={k} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: KIND[k].color }]} />
              <Text style={styles.legendText}>{KIND[k].label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Selected day */}
      <View style={styles.dayHead}>
        <AppText variant="title">{formatDayLabel(selected)}</AppText>
        {!sameDay(selected, today) ? (
          <Button
            title="Today"
            variant="ghost"
            size="sm"
            onPress={() => {
              setSelected(startOfDay(today));
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            }}
          />
        ) : null}
      </View>
      {!events ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : dayItems.length === 0 ? (
        <Card style={styles.emptyDay}>
          <AppText>Nothing on this day.</AppText>
          <Button title="Add an event" size="sm" variant="secondary" icon="add" onPress={() => setSheet({})} />
        </Card>
      ) : (
        <View style={styles.agenda}>
          {dayItems.map((it) => (
            <Pressable key={it.key} accessibilityRole="button" onPress={() => openItem(it)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.8 }]}>
              <View style={[styles.itemBar, { backgroundColor: KIND[it.kind].color }]} />
              <View style={styles.itemTime}>
                <Text style={styles.itemTimeText}>{it.allDay ? 'All day' : formatTime(it.start)}</Text>
                {it.end && !it.allDay ? <Text style={styles.itemTimeEnd}>{formatTime(it.end)}</Text> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.itemTitle} numberOfLines={2}>
                  {it.title}
                </Text>
                <View style={styles.itemMeta}>
                  <Ionicons name={KIND[it.kind].icon} size={12} color={colors.muted} />
                  <Text style={styles.itemMetaText}>
                    {KIND[it.kind].label}
                    {it.subtitle && it.subtitle !== 'Task' ? ` · ${it.subtitle}` : ''}
                  </Text>
                  {it.source === 'google' ? <Ionicons name="logo-google" size={11} color={colors.muted} /> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.lineStrong} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Coming up */}
      {upcoming.length ? (
        <>
          <AppText variant="heading" style={styles.sectionTitle}>
            Coming up
          </AppText>
          <Card style={styles.list}>
            {upcoming.map((it, i) => (
              <Pressable
                key={it.key}
                onPress={() => {
                  setSelected(startOfDay(it.start));
                  setMonth(new Date(it.start.getFullYear(), it.start.getMonth(), 1));
                }}
                style={[styles.upRow, i > 0 && styles.divider]}
              >
                <View style={[styles.upIcon, { backgroundColor: KIND[it.kind].color + '22' }]}>
                  <Ionicons name={KIND[it.kind].icon} size={16} color={KIND[it.kind].color} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="label" numberOfLines={1}>
                    {it.title}
                  </AppText>
                  <AppText variant="caption">
                    {formatDayLabel(it.start)}
                    {it.allDay ? '' : ` · ${formatTime(it.start)}`}
                  </AppText>
                </View>
                <Text style={styles.countdown}>{Math.max(0, Math.ceil((startOfDay(it.start).getTime() - startOfDay(today).getTime()) / 86_400_000))}d</Text>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {/* Google */}
      <Card style={styles.google}>
        <View style={styles.googleTop}>
          <View style={styles.googleIcon}>
            <Ionicons name="logo-google" size={18} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">Google Calendar</AppText>
            <AppText variant="caption">
              {!google
                ? 'Checking…'
                : google.connected
                  ? `Synced with ${google.googleEmail ?? 'your Google account'} — your events show here, and scheduled study sessions are added with a 15-minute reminder.`
                  : google.configured
                    ? 'Show your lectures, deadlines and exams here, and get scheduled study sessions added to Google with a reminder.'
                    : 'Google sync isn’t set up on this server yet (it needs Google credentials in the backend’s .env).'}
            </AppText>
          </View>
        </View>
        {googleError ? <Banner message={googleError} /> : null}
        {google?.configured ? (
          google.connected ? (
            <Button
              title="Disconnect"
              variant="secondary"
              size="sm"
              onPress={async () => {
                await api.googleDisconnect().catch(() => {});
                load();
              }}
            />
          ) : (
            <Button title="Connect Google Calendar" icon="logo-google" loading={connecting} onPress={connectGoogle} />
          )
        ) : null}
      </Card>

      <EventSheet
        visible={sheet !== null}
        event={sheet?.event}
        day={selected}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null);
          load();
        }}
      />
    </Screen>
  );
}

const CELL = `${100 / 7}%` as const;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginVertical: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  newBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  monthCard: { padding: 14, gap: 6 },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  navBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  monthTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  weekRow: { flexDirection: 'row' },
  weekday: { width: CELL, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, alignItems: 'center', paddingVertical: 3 },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.accent },
  sel: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  outside: { color: colors.lineStrong },
  selText: { color: colors.onPrimary, fontFamily: fonts.bold },
  dots: { flexDirection: 'row', gap: 3, height: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontFamily: fonts.medium, fontSize: 11, color: colors.inkSoft },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  emptyDay: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  agenda: { gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 0, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  itemBar: { width: 4, alignSelf: 'stretch', borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  itemTime: { width: 64 },
  itemTimeText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  itemTimeEnd: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  itemTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  itemMetaText: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  sectionTitle: { marginTop: 24, marginBottom: 10 },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  upIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  countdown: { fontFamily: fonts.display, fontSize: 18, color: colors.inkSoft },
  google: { gap: 12, marginTop: 24 },
  googleTop: { flexDirection: 'row', gap: 12 },
  googleIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
