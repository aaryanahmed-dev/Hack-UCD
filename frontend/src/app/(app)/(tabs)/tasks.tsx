import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/controls';
import { Screen } from '@/components/screen';
import { ProgressBar } from '@/components/session/parts';
import { PRIORITY_COLOR, PRIORITY_LABEL, TaskSheet } from '@/components/tasks/task-sheet';
import { AppText, Banner, Card } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import { DAY_MS, addDays, formatDue, startOfDay } from '@/lib/dates';
import type { Todo } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

type Filter = 'active' | 'done' | 'all';

function bucket(t: Todo, now: Date): string {
  if (!t.dueAt) return 'No date';
  const d = new Date(t.dueAt);
  const today = startOfDay(now);
  if (d < now) return 'Overdue';
  if (d < addDays(today, 1)) return 'Today';
  if (d < addDays(today, 2)) return 'Tomorrow';
  if (d < addDays(today, 7)) return 'This week';
  return 'Later';
}
const BUCKET_ORDER = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No date'];

export default function TasksScreen() {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('active');
  const [highOnly, setHighOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [quick, setQuick] = useState('');
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<{ todo?: Todo } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTodos((await api.listTodos()).items);
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

  const replace = (t: Todo) => setTodos((list) => (list ? list.map((x) => (x.id === t.id ? t : x)) : [t]));

  async function quickAdd() {
    const title = quick.trim();
    if (!title) return;
    setAdding(true);
    try {
      const t = await api.createPersonalTodo({ title, tags: tagFilter ? [tagFilter] : [] });
      setTodos((list) => [t, ...(list ?? [])]);
      setQuick('');
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setAdding(false);
    }
  }

  async function toggle(t: Todo) {
    replace({ ...t, isDone: !t.isDone, completedAt: t.isDone ? null : new Date().toISOString() }); // optimistic
    try {
      replace(await api.updatePersonalTodo(t.id, { isDone: !t.isDone }));
    } catch (e) {
      replace(t);
      setError(toApiError(e).message);
    }
  }

  const now = new Date();
  const all = useMemo(() => todos ?? [], [todos]);
  const knownTags = useMemo(() => [...new Set(all.flatMap((t) => t.tags))].sort(), [all]);
  const open = all.filter((t) => !t.isDone);
  const overdue = open.filter((t) => t.dueAt && new Date(t.dueAt) < now).length;
  const dueToday = open.filter((t) => t.dueAt && new Date(t.dueAt) >= now && new Date(t.dueAt) < addDays(startOfDay(now), 1)).length;
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const doneThisWeek = all.filter((t) => t.isDone && t.completedAt && new Date(t.completedAt).getTime() > weekAgo).length;
  const weekTotal = doneThisWeek + open.length;

  const visible = all.filter(
    (t) =>
      (filter === 'all' || (filter === 'done' ? t.isDone : !t.isDone)) &&
      (!highOnly || t.priority === 'high') &&
      (!tagFilter || t.tags.includes(tagFilter)),
  );
  const sections =
    filter === 'done'
      ? [{ title: 'Completed', items: [...visible].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')) }]
      : BUCKET_ORDER.map((title) => ({ title, items: visible.filter((t) => (t.isDone ? 'Done' : bucket(t, now)) === title) }))
          .concat(filter === 'all' ? [{ title: 'Done', items: visible.filter((t) => t.isDone) }] : [])
          .filter((s) => s.items.length);

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
      <View style={styles.header}>
        <AppText variant="display">Tasks</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="New task with details" onPress={() => setSheet({})} style={styles.newBtn}>
          <Ionicons name="add" size={24} color={colors.onPrimary} />
        </Pressable>
      </View>

      {/* Completion tracking */}
      <Card style={styles.summary}>
        <View style={styles.summaryRow}>
          <Summary label="Overdue" value={overdue} tone={overdue ? colors.danger : colors.ink} />
          <Summary label="Due today" value={dueToday} tone={colors.ink} />
          <Summary label="Done this week" value={doneThisWeek} tone={colors.primary} />
        </View>
        <ProgressBar value={weekTotal ? (100 * doneThisWeek) / weekTotal : 0} color={colors.primary} />
        <AppText variant="caption">
          {weekTotal ? `${doneThisWeek} of ${weekTotal} tasks done this week` : 'Add a task to start tracking your week.'}
        </AppText>
      </Card>

      {/* Quick add */}
      <View style={styles.quick}>
        <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
        <TextInput
          value={quick}
          onChangeText={setQuick}
          placeholder={tagFilter ? `Add a #${tagFilter} task…` : 'Add a task…'}
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          onSubmitEditing={quickAdd}
          accessibilityLabel="Quick add task"
          style={[styles.quickInput, Platform.OS === 'web' && { outlineWidth: 0 }]}
        />
        {adding ? <ActivityIndicator color={colors.primary} /> : quick.trim() ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Add task" onPress={quickAdd} style={styles.quickGo}>
            <Ionicons name="arrow-up" size={18} color={colors.onPrimary} />
          </Pressable>
        ) : null}
      </View>

      {/* Filters */}
      <View style={styles.filters}>
        <Chips
          options={[
            { value: 'active', label: `Active ${open.length}` },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagRow}>
        <FilterChip label="High priority" on={highOnly} color={colors.danger} onPress={() => setHighOnly(!highOnly)} />
        {knownTags.map((t) => (
          <FilterChip key={t} label={`#${t}`} on={tagFilter === t} onPress={() => setTagFilter(tagFilter === t ? null : t)} />
        ))}
      </ScrollView>

      {error ? <Banner message={error} action={{ label: 'Retry', onPress: load }} /> : null}

      {!todos ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : sections.length === 0 ? (
        <Card style={styles.empty}>
          <Ionicons name={filter === 'done' ? 'trophy-outline' : 'sparkles-outline'} size={30} color={colors.primary} />
          <AppText variant="heading">{filter === 'done' ? 'Nothing finished yet' : 'All clear'}</AppText>
          <AppText style={styles.center}>
            {filter === 'done' ? 'Tick off a task and it lands here.' : 'Add assignments, readings and revision goals above.'}
          </AppText>
        </Card>
      ) : (
        sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, section.title === 'Overdue' && { color: colors.danger }]}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.items.length}</Text>
            </View>
            <Card style={styles.list}>
              {section.items.map((t, i) => (
                <TaskRow
                  key={t.id}
                  todo={t}
                  divider={i > 0}
                  expanded={expanded === t.id}
                  onToggle={() => toggle(t)}
                  onExpand={() => setExpanded(expanded === t.id ? null : t.id)}
                  onEdit={() => setSheet({ todo: t })}
                  onChange={replace}
                  onError={setError}
                />
              ))}
            </Card>
          </View>
        ))
      )}

      <TaskSheet
        visible={sheet !== null}
        todo={sheet?.todo}
        knownTags={knownTags}
        onClose={() => setSheet(null)}
        onSaved={(t) => {
          setSheet(null);
          setTodos((list) => (list?.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...(list ?? [])]));
        }}
        onDeleted={(id) => {
          setSheet(null);
          setTodos((list) => list?.filter((x) => x.id !== id) ?? null);
        }}
      />
    </Screen>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, { color: tone }]}>{value}</Text>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

function FilterChip({ label, on, onPress, color = colors.primary }: { label: string; on: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={on}
      onPress={onPress}
      style={[styles.filterChip, on && { backgroundColor: color, borderColor: color }]}
    >
      <Text style={[styles.filterChipText, on && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function TaskRow({
  todo: t,
  divider,
  expanded,
  onToggle,
  onExpand,
  onEdit,
  onChange,
  onError,
}: {
  todo: Todo;
  divider: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onEdit: () => void;
  onChange: (t: Todo) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const done = t.subtasks.filter((s) => s.isDone).length;
  const due = t.dueAt && !t.isDone ? formatDue(t.dueAt) : null;

  async function run(fn: () => Promise<Todo>) {
    try {
      onChange(await fn());
    } catch (e) {
      onError(toApiError(e).message);
    }
  }

  return (
    <View style={[styles.row, divider && styles.divider]}>
      <View style={styles.rowMain}>
        <Pressable
          accessibilityRole="checkbox"
          aria-checked={t.isDone}
          accessibilityLabel={t.title}
          onPress={onToggle}
          hitSlop={6}
          style={[styles.check, { borderColor: PRIORITY_COLOR[t.priority] }, t.isDone && styles.checkOn]}
        >
          {t.isDone ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t.title}, show details`} onPress={onExpand} style={styles.rowBody}>
          <Text style={[styles.rowTitle, t.isDone && styles.rowTitleDone]}>{t.title}</Text>
          <View style={styles.meta}>
            {t.priority !== 'medium' && !t.isDone ? (
              <Text style={[styles.metaText, { color: t.priority === 'high' ? colors.danger : colors.muted }]}>{PRIORITY_LABEL[t.priority]}</Text>
            ) : null}
            {due ? (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={12} color={due.tone === 'overdue' ? colors.danger : due.tone === 'soon' ? colors.accentInk : colors.muted} />
                <Text style={[styles.metaText, due.tone === 'overdue' && { color: colors.danger }, due.tone === 'soon' && { color: colors.accentInk }]}>{due.label}</Text>
              </View>
            ) : null}
            {t.subtasks.length ? (
              <View style={styles.metaItem}>
                <Ionicons name="list-outline" size={12} color={colors.muted} />
                <Text style={styles.metaText}>
                  {done}/{t.subtasks.length}
                </Text>
              </View>
            ) : null}
            {t.visibility === 'friends' ? <Ionicons name="people-outline" size={12} color={colors.muted} accessibilityLabel="Shared with friends" /> : null}
            {t.tags.map((tag) => (
              <Text key={tag} style={styles.tagText}>
                #{tag}
              </Text>
            ))}
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${t.title}`} onPress={onEdit} hitSlop={8} style={styles.edit}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.details}>
          {t.notes ? <AppText variant="caption">{t.notes}</AppText> : null}
          {t.subtasks.map((s) => (
            <View key={s.id} style={styles.subtask}>
              <Pressable
                accessibilityRole="checkbox"
                aria-checked={s.isDone}
                accessibilityLabel={s.title}
                onPress={() => run(() => api.updateSubtask(t.id, s.id, { isDone: !s.isDone }))}
                style={[styles.subCheck, s.isDone && styles.checkOn]}
              >
                {s.isDone ? <Ionicons name="checkmark" size={12} color={colors.onPrimary} /> : null}
              </Pressable>
              <Text style={[styles.subTitle, s.isDone && styles.rowTitleDone]}>{s.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${s.title}`} onPress={() => run(() => api.deleteSubtask(t.id, s.id))} hitSlop={8}>
                <Ionicons name="close" size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          <View style={styles.subAdd}>
            <Ionicons name="add" size={16} color={colors.primary} />
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a subtask"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              accessibilityLabel={`Add a subtask to ${t.title}`}
              onSubmitEditing={() => {
                const title = draft.trim();
                if (!title) return;
                setDraft('');
                run(() => api.addSubtask(t.id, title));
              }}
              style={[styles.subInput, Platform.OS === 'web' && { outlineWidth: 0 }]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  loader: { marginTop: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  newBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  summary: { gap: 12 },
  summaryRow: { flexDirection: 'row' },
  summaryItem: { flex: 1, gap: 2 },
  summaryValue: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  quick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 14,
    minHeight: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  quickInput: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: colors.ink, paddingVertical: 14 },
  quickGo: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  filters: { marginTop: 14 },
  tagScroll: { flexGrow: 0 }, // don't stretch vertically inside the page
  tagRow: { gap: 6, paddingVertical: 10, alignItems: 'center' },
  filterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  filterChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkSoft },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28, marginTop: 6 },
  section: { marginTop: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionCount: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { paddingHorizontal: 14, paddingVertical: 12 },
  rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.ink },
  rowTitleDone: { textDecorationLine: 'line-through', color: colors.muted },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tagText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.primary },
  edit: { padding: 4 },
  details: { marginTop: 10, marginLeft: 36, gap: 8 },
  subtask: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subCheck: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  subTitle: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  subAdd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subInput: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink, paddingVertical: 6 },
});
