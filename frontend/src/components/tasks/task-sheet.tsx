import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Chips, Field } from '@/components/controls';
import { DatePicker, TimePicker } from '@/components/date-time';
import { Sheet } from '@/components/sheet';
import { AppText, Banner, Button, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import { addDays, atMinutes, minutesOfDay, startOfDay } from '@/lib/dates';
import type { Priority, Todo } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

export const PRIORITY_COLOR: Record<Priority, string> = { high: colors.danger, medium: colors.accent, low: colors.lineStrong };
export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

const END_OF_DAY = 23 * 60 + 59; // a due date with no time is stored as 23:59 local

type DuePreset = 'none' | 'today' | 'tomorrow' | 'week' | 'custom';

type Props = {
  visible: boolean;
  todo?: Todo; // edit when set
  knownTags: string[];
  onClose: () => void;
  onSaved: (todo: Todo) => void;
  onDeleted?: (id: string) => void;
};

export function TaskSheet(props: Props) {
  return props.visible ? <TaskForm {...props} /> : null;
}

function initialDue(todo?: Todo): { day: Date | null; time: number | null } {
  if (!todo?.dueAt) return { day: null, time: null };
  const d = new Date(todo.dueAt);
  const m = minutesOfDay(d);
  return { day: startOfDay(d), time: m === END_OF_DAY ? null : m };
}

function TaskForm({ todo, knownTags, onClose, onSaved, onDeleted }: Props) {
  const due0 = initialDue(todo);
  const [title, setTitle] = useState(todo?.title ?? '');
  const [notes, setNotes] = useState(todo?.notes ?? '');
  const [priority, setPriority] = useState<Priority>(todo?.priority ?? 'medium');
  const [day, setDay] = useState<Date | null>(due0.day);
  const [time, setTime] = useState<number | null>(due0.time);
  const [showCalendar, setShowCalendar] = useState(false);
  const [tags, setTags] = useState<string[]>(todo?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [shared, setShared] = useState(todo?.visibility === 'friends');
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const today = startOfDay(new Date());
  const preset: DuePreset = !day
    ? 'none'
    : +day === +today
      ? 'today'
      : +day === +addDays(today, 1)
        ? 'tomorrow'
        : +day === +addDays(today, 7)
          ? 'week'
          : 'custom';

  function choosePreset(p: DuePreset) {
    if (p === 'none') {
      setDay(null);
      setTime(null);
      setShowCalendar(false);
    } else if (p === 'custom') {
      setShowCalendar(true);
      if (!day) setDay(addDays(today, 2));
    } else {
      setDay(p === 'today' ? today : p === 'tomorrow' ? addDays(today, 1) : addDays(today, 7));
      setShowCalendar(false);
    }
  }

  function addTag() {
    const t = tagDraft.trim().toLowerCase().replace(/^#/, '');
    if (t && !tags.includes(t) && tags.length < 5) setTags([...tags, t.slice(0, 20)]);
    setTagDraft('');
  }

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    setSaving(true);
    const body = {
      title: title.trim(),
      notes: notes.trim() || null,
      priority,
      tags,
      dueAt: day ? atMinutes(day, time ?? END_OF_DAY) : null,
      visibility: shared ? ('friends' as const) : ('private' as const),
    };
    try {
      const saved = todo
        ? await api.updatePersonalTodo(todo.id, body)
        : await api.createPersonalTodo({ ...body, subtasks: subtasks.map((s) => ({ title: s })) });
      onSaved(saved);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!todo) return;
    setSaving(true);
    try {
      await api.deletePersonalTodo(todo.id);
      onDeleted?.(todo.id);
    } catch (e) {
      setError(toApiError(e).message);
      setSaving(false);
    }
  }

  const suggestions = knownTags.filter((t) => !tags.includes(t)).slice(0, 6);

  return (
    <Sheet visible onClose={onClose} title={todo ? 'Edit task' : 'New task'}>
      {error ? <Banner message={error} /> : null}
      <TextField label="Task" value={title} onChangeText={setTitle} placeholder="Finish lab report" maxLength={200} autoFocus={!todo} />

      <Field label="Priority">
        <View style={styles.priorityRow}>
          {(['low', 'medium', 'high'] as Priority[]).map((p) => {
            const on = priority === p;
            return (
              <Pressable
                key={p}
                accessibilityRole="radio"
                aria-checked={on}
                onPress={() => setPriority(p)}
                style={[styles.priority, on && { borderColor: PRIORITY_COLOR[p], backgroundColor: PRIORITY_COLOR[p] + '1F' }]}
              >
                <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLOR[p] }]} />
                <Text style={[styles.priorityText, on && { color: colors.ink }]}>{PRIORITY_LABEL[p]}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label="Due">
        <Chips
          options={[
            { value: 'none', label: 'No date' },
            { value: 'today', label: 'Today' },
            { value: 'tomorrow', label: 'Tomorrow' },
            { value: 'week', label: 'In a week' },
            { value: 'custom', label: preset === 'custom' && day ? day.toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'Pick a date' },
          ]}
          value={preset}
          onChange={choosePreset}
        />
        {showCalendar || preset === 'custom' ? <DatePicker value={day} onChange={setDay} minDate={today} /> : null}
        {day ? (
          <>
            <View style={styles.switchRow}>
              <AppText style={styles.flex}>Add a time</AppText>
              <Switch
                value={time !== null}
                onValueChange={(on) => setTime(on ? 17 * 60 : null)}
                trackColor={{ true: colors.primary, false: colors.lineStrong }}
                thumbColor={colors.surface}
              />
            </View>
            {time !== null ? <TimePicker minutes={time} onChange={setTime} /> : null}
          </>
        ) : null}
      </Field>

      <Field label="Tags" hint="Group tasks by subject or type — up to 5.">
        <View style={styles.tags}>
          {tags.map((t) => (
            <Pressable key={t} accessibilityRole="button" accessibilityLabel={`Remove tag ${t}`} onPress={() => setTags(tags.filter((x) => x !== t))} style={styles.tag}>
              <Text style={styles.tagText}>#{t}</Text>
              <Ionicons name="close" size={14} color={colors.primary} />
            </Pressable>
          ))}
        </View>
        {tags.length < 5 ? (
          <View style={styles.inlineAdd}>
            <View style={styles.flex}>
              <TextField label="Add tag" value={tagDraft} onChangeText={setTagDraft} placeholder="biology" maxLength={20} autoCapitalize="none" returnKeyType="done" onSubmitEditing={addTag} />
            </View>
            <Button title="Add" size="sm" variant="secondary" onPress={addTag} style={styles.addBtn} />
          </View>
        ) : null}
        {suggestions.length ? (
          <View style={styles.tags}>
            {suggestions.map((t) => (
              <Pressable key={t} accessibilityRole="button" accessibilityLabel={`Add tag ${t}`} onPress={() => setTags([...tags, t])} style={styles.suggestion}>
                <Text style={styles.suggestionText}>+ #{t}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Field>

      {!todo ? (
        <Field label="Subtasks">
          {subtasks.map((s, i) => (
            <View key={`${s}-${i}`} style={styles.subtask}>
              <Ionicons name="ellipse-outline" size={16} color={colors.muted} />
              <AppText style={styles.flex}>{s}</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${s}`} onPress={() => setSubtasks(subtasks.filter((_, j) => j !== i))} hitSlop={8}>
                <Ionicons name="close" size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          <View style={styles.inlineAdd}>
            <View style={styles.flex}>
              <TextField
                label="Add subtask"
                value={subtaskDraft}
                onChangeText={setSubtaskDraft}
                placeholder="Write the introduction"
                maxLength={200}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (subtaskDraft.trim()) setSubtasks([...subtasks, subtaskDraft.trim()]);
                  setSubtaskDraft('');
                }}
              />
            </View>
            <Button
              title="Add"
              size="sm"
              variant="secondary"
              onPress={() => {
                if (subtaskDraft.trim()) setSubtasks([...subtasks, subtaskDraft.trim()]);
                setSubtaskDraft('');
              }}
              style={styles.addBtn}
            />
          </View>
        </Field>
      ) : null}

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Chapters 4–6, check rubric" multiline maxLength={5000} />

      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <AppText variant="label">Visible to friends</AppText>
          <AppText variant="caption">Friends can see this task on your profile.</AppText>
        </View>
        <Switch value={shared} onValueChange={setShared} trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor={colors.surface} />
      </View>

      <Button title={todo ? 'Save task' : 'Add task'} icon={todo ? 'checkmark' : 'add'} onPress={save} loading={saving} />
      {todo ? <Button title="Delete task" variant="ghost" icon="trash-outline" onPress={remove} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priority: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  priorityDot: { width: 9, height: 9, borderRadius: 5 },
  priorityText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkSoft },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  tagText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.primary },
  suggestion: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  suggestionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkSoft },
  inlineAdd: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  addBtn: { minHeight: 52 },
  subtask: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
});
