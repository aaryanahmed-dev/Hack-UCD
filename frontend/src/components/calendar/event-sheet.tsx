import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Chips, Field } from '@/components/controls';
import { DatePicker, TimePicker } from '@/components/date-time';
import { Sheet } from '@/components/sheet';
import { AppText, Banner, Button, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import { atMinutes, minutesOfDay, startOfDay } from '@/lib/dates';
import type { CalendarEvent, EventKind } from '@/lib/types';
import { colors } from '@/theme';

const DURATIONS = [30, 60, 90, 120, 180];

type Props = {
  visible: boolean;
  event?: CalendarEvent; // manual event to edit
  day: Date; // default day for a new event
  onClose: () => void;
  onSaved: () => void;
};

export function EventSheet(props: Props) {
  return props.visible ? <EventForm {...props} /> : null;
}

function EventForm({ event, day: defaultDay, onClose, onSaved }: Props) {
  const start0 = event ? new Date(event.startsAt) : null;
  const [title, setTitle] = useState(event?.title ?? '');
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'assignment');
  const [day, setDay] = useState<Date>(start0 ? startOfDay(start0) : defaultDay);
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [time, setTime] = useState(start0 && !event?.allDay ? minutesOfDay(start0) : 9 * 60);
  const [duration, setDuration] = useState(
    event?.endsAt && start0 ? Math.max(15, Math.round((new Date(event.endsAt).getTime() - start0.getTime()) / 60000)) : 60,
  );
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError('Give the event a title.');
      return;
    }
    setSaving(true);
    const startsAt = allDay ? atMinutes(day, 0) : atMinutes(day, time);
    const endsAt = allDay ? null : new Date(new Date(startsAt).getTime() + duration * 60000).toISOString();
    const body = { title: title.trim(), kind, startsAt, endsAt, allDay, notes: notes.trim() || null };
    try {
      if (event) await api.updateEvent(event.id, body);
      else await api.createEvent(body);
      onSaved();
    } catch (e) {
      setError(toApiError(e).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    setSaving(true);
    try {
      await api.deleteEvent(event.id);
      onSaved();
    } catch (e) {
      setError(toApiError(e).message);
      setSaving(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title={event ? 'Edit event' : 'New event'}>
      {error ? <Banner message={error} /> : null}
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="CHEM20040 lab report due" maxLength={200} autoFocus={!event} />
      <Field label="Type">
        <Chips
          options={[
            { value: 'assignment', label: 'Assignment' },
            { value: 'exam', label: 'Exam' },
            { value: 'study_session', label: 'Study' },
            { value: 'other', label: 'Other' },
          ]}
          value={kind}
          onChange={setKind}
        />
      </Field>
      <Field label="Date">
        <DatePicker value={day} onChange={setDay} />
      </Field>
      <View style={styles.switchRow}>
        <AppText style={styles.flex}>All day</AppText>
        <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor={colors.surface} />
      </View>
      {!allDay ? (
        <>
          <Field label="Starts at">
            <TimePicker minutes={time} onChange={setTime} />
          </Field>
          <Field label="Lasts">
            <Chips
              options={DURATIONS.map((m) => ({ value: m, label: m < 60 ? `${m} min` : `${m / 60} h` }))}
              value={DURATIONS.includes(duration) ? duration : 60}
              onChange={setDuration}
            />
          </Field>
        </>
      ) : null}
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Room, topics, rubric…" multiline maxLength={5000} />
      <Button title={event ? 'Save event' : 'Add to calendar'} icon={event ? 'checkmark' : 'add'} onPress={save} loading={saving} />
      {event ? <Button title="Delete event" variant="ghost" icon="trash-outline" onPress={remove} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
