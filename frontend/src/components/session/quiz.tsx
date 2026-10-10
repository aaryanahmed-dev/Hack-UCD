import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SectionTitle } from '@/components/controls';
import { AppText, Banner, Button, Card } from '@/components/ui';
import { useCountdown } from '@/hooks/use-countdown';
import { api, toApiError } from '@/lib/api';
import type { CurrentQuestion, StudySession } from '@/lib/types';
import { colors, fonts, radius, shadow } from '@/theme';
import { FOCUS_COLOR, FOCUS_LABEL, ParticipantRow, ProgressBar } from './parts';

const GRACE_MS = 1500; // server accepts answers ~2 s past the deadline

/** One timed question at a time (API_SPEC §7.6). The server starts each question's 20 s timer when it's served. */
export function QuizView({ session }: { session: StudySession }) {
  if (!session.me.isParticipant) return <QuizProgressList session={session} />;
  return <QuizRunner session={session} />;
}

function QuizRunner({ session }: { session: StudySession }) {
  const [current, setCurrent] = useState<CurrentQuestion | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const fetching = useRef(false);

  const accept = useCallback((c: CurrentQuestion) => {
    setCurrent(c);
    setOffset(new Date(c.serverTime).getTime() - Date.now());
    setSelected(null);
    setText('');
    setTimeUp(false);
  }, []);

  const loadCurrent = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      accept(await api.currentQuestion(session.id));
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      fetching.current = false;
    }
  }, [accept, session.id]);

  useEffect(() => {
    let active = true;
    api.currentQuestion(session.id).then(
      (c) => active && accept(c),
      (e) => active && setError(toApiError(e).message),
    );
    return () => {
      active = false;
    };
  }, [accept, session.id]);

  const limit = (current?.question?.timeLimitSeconds ?? 20) * 1000;
  // Capped: right after a new question arrives the ticking clock can be one tick stale.
  const ms = Math.min(limit, useCountdown(current?.deadline ?? null, offset, 100));

  // When time runs out, ask the server for the next question (it expires the old one).
  useEffect(() => {
    if (!current?.question || ms > 0) return;
    const t1 = setTimeout(() => setTimeUp(true), 0);
    const t2 = setTimeout(loadCurrent, GRACE_MS + 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [current?.question, ms, loadCurrent]);

  async function submit(optionId: string | null, answerText: string | null) {
    if (!current?.question || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      accept(await api.answerQuestion(session.id, { questionId: current.question.id, optionId, text: answerText }));
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'question_expired') await loadCurrent();
      else setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!current) {
    return error ? <Banner message={error} action={{ label: 'Retry', onPress: loadCurrent }} /> : <ActivityIndicator color={colors.primary} style={styles.loader} />;
  }

  if (!current.question) {
    return (
      <>
        <Card style={styles.done}>
          <Ionicons name="checkmark-done-circle" size={44} color={colors.primary} />
          <AppText variant="title">You’re done!</AppText>
          <AppText style={styles.center}>Waiting for everyone else to finish. Results appear as soon as the quiz is graded.</AppText>
        </Card>
        <QuizProgressList session={session} />
      </>
    );
  }

  const q = current.question;
  const urgent = ms <= 5000;

  return (
    <>
      <View style={styles.meta}>
        <AppText variant="label">
          Question {current.number} of {current.total}
        </AppText>
        <Text style={[styles.seconds, urgent && { color: colors.danger }]} accessibilityRole="timer">
          {Math.ceil(ms / 1000)}s
        </Text>
      </View>
      <ProgressBar value={(100 * ms) / limit} color={urgent ? colors.danger : colors.primary} />

      <View style={styles.questionCard}>
        <Text style={styles.prompt}>{q.prompt}</Text>
        {timeUp ? (
          <View style={styles.timeUp}>
            <ActivityIndicator color={colors.primary} />
            <AppText>Time’s up — next question…</AppText>
          </View>
        ) : q.type === 'multiple_choice' ? (
          <View style={styles.options}>
            {q.options?.map((o, i) => {
              const chosen = selected === o.id;
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="button"
                  accessibilityLabel={o.text}
                  disabled={submitting}
                  onPress={() => {
                    setSelected(o.id);
                    submit(o.id, null);
                  }}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.option,
                    (pressed || hovered) && !chosen && { backgroundColor: colors.surfaceAlt },
                    chosen && styles.optionChosen,
                  ]}
                >
                  <View style={[styles.letter, chosen && { backgroundColor: colors.onPrimary }]}>
                    <Text style={[styles.letterText, chosen && { color: colors.primary }]}>{String.fromCharCode(65 + i)}</Text>
                  </View>
                  <Text style={[styles.optionText, chosen && { color: colors.onPrimary }]}>{o.text}</Text>
                  {chosen && submitting ? <ActivityIndicator color={colors.onPrimary} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.short}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type your answer"
              placeholderTextColor={colors.muted}
              autoFocus
              maxLength={1000}
              returnKeyType="send"
              onSubmitEditing={() => submit(null, text)}
              style={[styles.shortInput, Platform.OS === 'web' && { outlineWidth: 0 }]}
              accessibilityLabel="Your answer"
            />
            <Button title="Submit answer" icon="send" loading={submitting} disabled={!text.trim()} onPress={() => submit(null, text)} />
          </View>
        )}
      </View>

      {error ? <Banner message={error} /> : null}
      <View style={styles.warning}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.accentInk} />
        <AppText variant="caption" style={styles.warningText}>
          Leaving this screen or switching tabs flags the open question and scores it 0. No going back.
        </AppText>
      </View>
    </>
  );
}

function QuizProgressList({ session }: { session: StudySession }) {
  return (
    <>
      <SectionTitle title="Progress" />
      <Card style={styles.list}>
        {session.participants.map((p, i) => (
          <ParticipantRow
            key={p.user.id}
            p={p}
            divider={i > 0}
            subtitle={
              p.quizProgress
                ? `${p.quizProgress.answered}/${p.quizProgress.total} answered${p.quizProgress.flagged ? ` · ${p.quizProgress.flagged} flagged` : ''}`
                : 'Not started'
            }
            right={
              p.quizProgress && p.quizProgress.answered >= p.quizProgress.total ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              ) : (
                <View style={[styles.state, { backgroundColor: FOCUS_COLOR[p.focus?.state ?? 'offline'] + '22' }]}>
                  <View style={[styles.stateDot, { backgroundColor: FOCUS_COLOR[p.focus?.state ?? 'offline'] }]} />
                  <Text style={styles.stateText}>{p.focus?.state === 'focused' ? 'On the quiz' : FOCUS_LABEL[p.focus?.state ?? 'offline']}</Text>
                </View>
              )
            }
          />
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  loader: { marginTop: 40 },
  list: { padding: 0, overflow: 'hidden' },
  done: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  seconds: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.primary, fontVariant: ['tabular-nums'] },
  questionCard: { marginTop: 16, backgroundColor: colors.surface, borderRadius: radius.xl, padding: 22, gap: 18, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  prompt: { fontFamily: fonts.display, fontSize: 22, lineHeight: 30, color: colors.ink },
  options: { gap: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.bg },
  optionChosen: { backgroundColor: colors.primary, borderColor: colors.primary },
  letter: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  letterText: { fontFamily: fonts.bold, fontSize: 14, color: colors.primary },
  optionText: { flex: 1, fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, color: colors.ink },
  short: { gap: 12 },
  shortInput: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.bg, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  timeUp: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  warning: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 16, backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 12 },
  warningText: { flex: 1, color: colors.accentInk },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.pill },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  stateText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
});
