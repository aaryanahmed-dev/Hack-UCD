import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SectionTitle } from '@/components/controls';
import { AppText, Banner, Button, Card, Pill, TextField } from '@/components/ui';
import { useCountdown } from '@/hooks/use-countdown';
import { api, toApiError } from '@/lib/api';
import type { SessionTodo, StudySession } from '@/lib/types';
import { useMe } from '@/providers/auth';
import { colors, fonts, radius, shadow } from '@/theme';
import { formatMinutes } from './format';
import { BigCountdown, ParticipantRow, ProgressBar } from './parts';

type Props = {
  session: StudySession;
  todos: SessionTodo[];
  setTodos: (todos: SessionTodo[]) => void;
  clockOffset: number;
};

export function StudyingView({ session, setSession, todos, setTodos, clockOffset }: Props & { setSession: (s: StudySession) => void }) {
  const ms = useCountdown(session.studyEndsAt, clockOffset, 1000);
  const block = (session.extension.used > 0 ? session.config.extensionMinutes : session.config.studyMinutes) * 60_000;
  const elapsedPct = 100 - (100 * ms) / block;

  return (
    <>
      <View style={styles.timerCard}>
        <BigCountdown target={session.studyEndsAt} clockOffset={clockOffset} label={session.extension.used ? `Extension ${session.extension.used} · left` : 'left to study'} />
        <View style={styles.timerBar}>
          <ProgressBar value={elapsedPct} trackColor="rgba(246, 242, 233, 0.16)" />
        </View>
        {session.me.isParticipant ? (
          <View style={styles.focusNote}>
            <Ionicons name="book-outline" size={16} color={colors.onPrimaryMuted} />
            <Text style={styles.focusNoteText}>
              Study however works for you — notes, books, other tabs. Only the quiz at the end is tab-tracked.
            </Text>
          </View>
        ) : null}
      </View>

      <FinishEarly session={session} setSession={setSession} />

      <SectionTitle title="Who’s studying" />
      <Card style={styles.list}>
        {session.participants.map((p, i) => {
          return (
            <ParticipantRow
              key={p.user.id}
              p={p}
              divider={i > 0}
              subtitle={p.wantsToFinish ? 'Ready to finish' : `Studied ${formatMinutes(p.focus?.focusedSeconds ?? 0)}`}
              right={
                <View style={[styles.state, { backgroundColor: (p.presence === 'online' ? colors.live : colors.lineStrong) + '22' }]}>
                  <View style={[styles.stateDot, { backgroundColor: p.presence === 'online' ? colors.live : colors.lineStrong }]} />
                  <Text style={[styles.stateText, { color: p.presence === 'online' ? colors.ink : colors.muted }]}>{p.presence === 'online' ? 'Here' : 'Away'}</Text>
                </View>
              }
            />
          );
        })}
      </Card>

      <SharedTodos session={session} todos={todos} setTodos={setTodos} />
    </>
  );
}

/** Everyone opts in → the study block ends now and the quiz starts (no extension vote). */
function FinishEarly({ session, setSession }: { session: StudySession; setSession: (s: StudySession) => void }) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = session.participants.length;
  const ready = session.participants.filter((p) => p.wantsToFinish);
  const mine = session.me.wantsToFinish;
  const othersAllReady = !mine && ready.length === total - 1;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      setSession(await api.finishEarly(session.id, !mine));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={[styles.finishCard, othersAllReady && styles.finishCardHot]}>
      <View style={styles.finishTop}>
        <View style={styles.finishIcon}>
          <Ionicons name="flag-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading">Finished early?</AppText>
          <AppText variant="caption">
            {othersAllReady
              ? 'Everyone else is done — you’re the last one. Finish now or keep going.'
              : 'If everyone taps this, the study block ends now and the quiz starts.'}
          </AppText>
        </View>
      </View>
      <View style={styles.finishProgress}>
        <View style={styles.flex}>
          <ProgressBar value={(100 * ready.length) / total} color={colors.primary} />
        </View>
        <Text style={styles.finishCount}>
          {ready.length}/{total} ready
        </Text>
      </View>
      {ready.length > 0 ? (
        <AppText variant="caption">Ready to finish: {ready.map((p) => (p.user.id === me.id ? 'You' : p.user.displayName)).join(', ')}</AppText>
      ) : null}
      {error ? <Banner message={error} /> : null}
      {session.me.isParticipant ? (
        <Button
          title={mine ? 'Undo — keep studying' : othersAllReady ? 'Finish now and start the quiz' : 'I’m done — finish early'}
          icon={mine ? 'arrow-undo-outline' : 'checkmark-done-outline'}
          variant={mine ? 'secondary' : othersAllReady ? 'primary' : 'secondary'}
          size="sm"
          loading={busy}
          onPress={toggle}
        />
      ) : null}
    </Card>
  );
}

export function SharedTodos({ session, todos, setTodos }: Omit<Props, 'clockOffset'>) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = session.me.isParticipant;
  const done = todos.filter((t) => t.isDone).length;

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  const add = () =>
    title.trim() &&
    act('add', async () => {
      const todo = await api.addTodo(session.id, title.trim());
      setTitle('');
      setTodos([...todos.filter((t) => t.id !== todo.id), todo]);
    });

  return (
    <>
      <SectionTitle title="Group goals" right={todos.length ? <Pill tone="primary" label={`${done}/${todos.length} done`} /> : undefined} />
      <Card style={styles.todoCard}>
        {todos.length === 0 ? <AppText variant="caption">Add sub-goals for this session — everyone sees them tick off live.</AppText> : null}
        {todos.map((t) => (
          <View key={t.id} style={styles.todo}>
            <Pressable
              accessibilityRole="checkbox"
              aria-checked={t.isDone}
              aria-disabled={!canEdit}
              accessibilityLabel={t.title}
              disabled={!canEdit || busy === t.id}
              onPress={() =>
                act(t.id, async () => {
                  const updated = await api.updateTodo(session.id, t.id, { isDone: !t.isDone });
                  setTodos(todos.map((x) => (x.id === t.id ? updated : x)));
                })
              }
              style={[styles.check, t.isDone && styles.checkOn]}
            >
              {busy === t.id ? <ActivityIndicator size="small" color={colors.primary} /> : t.isDone ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
            </Pressable>
            <View style={styles.flex}>
              <Text style={[styles.todoTitle, t.isDone && styles.todoDone]}>{t.title}</Text>
              <AppText variant="caption">{t.isDone && t.completedBy ? `Done by ${t.completedBy.displayName}` : `Added by ${t.createdBy.displayName}`}</AppText>
            </View>
            {canEdit ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${t.title}`}
                hitSlop={8}
                onPress={() =>
                  act(`del-${t.id}`, async () => {
                    await api.deleteTodo(session.id, t.id);
                    setTodos(todos.filter((x) => x.id !== t.id));
                  })
                }
              >
                <Ionicons name="close" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        ))}
        {error ? <Banner message={error} /> : null}
        {canEdit ? (
          <View style={styles.addRow}>
            <View style={styles.flex}>
              <TextField label="New goal" value={title} onChangeText={setTitle} placeholder="Finish practice questions 1–10" maxLength={200} returnKeyType="done" onSubmitEditing={add} />
            </View>
            <Button title="Add" size="sm" icon="add" loading={busy === 'add'} onPress={add} style={styles.addButton} />
          </View>
        ) : null}
      </Card>
    </>
  );
}

export function ExtensionVoteView({ session, setSession, clockOffset }: { session: StudySession; setSession: (s: StudySession) => void; clockOffset: number }) {
  const [busy, setBusy] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vote = session.extension.vote;
  const n = session.participants.length;

  async function cast(extend: boolean) {
    setBusy(extend);
    setError(null);
    try {
      setSession(await api.voteExtension(session.id, extend));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.timerCard}>
      <Ionicons name="hourglass-outline" size={30} color={colors.accent} />
      <Text style={styles.voteTitle}>Time’s up! Keep going?</Text>
      <Text style={styles.voteBody}>
        Vote to study {session.config.extensionMinutes} more minutes.{' '}
        {n === 2 ? 'With two of you, both must say yes.' : 'Majority wins; a tie is a coin flip.'} No vote counts as no.
      </Text>
      <BigCountdown target={vote?.endsAt ?? null} clockOffset={clockOffset} label={`${vote?.voted ?? 0}/${n} voted`} />
      {error ? <Banner message={error} /> : null}
      {session.me.isParticipant ? (
        vote?.myVote == null ? (
          <View style={styles.voteButtons}>
            <Button title={`Yes, +${session.config.extensionMinutes} min`} variant="light" icon="add-circle-outline" loading={busy === true} onPress={() => cast(true)} style={styles.flex} />
            <Button title="No, quiz me" variant="light" icon="school-outline" loading={busy === false} onPress={() => cast(false)} style={styles.flex} />
          </View>
        ) : (
          <Pill tone="onDark" icon="checkmark" label={`You voted ${vote.myVote ? 'yes' : 'no'} — waiting for the others`} />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 0, overflow: 'hidden' },
  timerCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: 24, gap: 14, alignItems: 'center', ...shadow.raised },
  timerBar: { alignSelf: 'stretch' },
  focusNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  focusNoteText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.onPrimaryMuted },
  myFocus: { flexDirection: 'row', gap: 10, marginTop: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16 },
  finishCard: { gap: 12, marginTop: 14 },
  finishCardHot: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  finishTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  finishIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  finishProgress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  finishCount: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkSoft },
  myFocusValue: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.pill },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  stateText: { fontFamily: fonts.semibold, fontSize: 12 },
  todoCard: { gap: 12 },
  todo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary },
  todoTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  todoDone: { textDecorationLine: 'line-through', color: colors.muted },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  addButton: { minHeight: 52 },
  voteTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.onPrimary, textAlign: 'center' },
  voteBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onPrimaryMuted, textAlign: 'center' },
  voteButtons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
});
