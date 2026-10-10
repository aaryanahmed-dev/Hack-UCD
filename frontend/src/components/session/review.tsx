import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { SectionTitle } from '@/components/controls';
import { Sheet } from '@/components/sheet';
import { AppText, Avatar, Banner, Button, Card, Pill, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { Participant, QuestionReview, Review, StudySession } from '@/lib/types';
import { useMe } from '@/providers/auth';
import { colors, fonts, radius, shadow } from '@/theme';
import { describeRule, formatAmount, formatSigned } from './format';
import { InlineCountdown } from './parts';

type Props = { session: StudySession; clockOffset: number };

function useReview(session: StudySession) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // Re-fetch on every new snapshot (each one is a new object) — disputes and scores change live.
  useEffect(() => {
    let active = true;
    api.getReview(session.id).then(
      (r) => active && setReview(r),
      (e) => active && setError(toApiError(e).message),
    );
    return () => {
      active = false;
    };
  }, [session, nonce]);
  return { review, error, reload: () => setNonce((n) => n + 1) };
}

export function ReviewView({ session, clockOffset }: Props) {
  const { review, error, reload } = useReview(session);
  const [busy, setBusy] = useState(false);
  const [doneError, setDoneError] = useState<string | null>(null);
  const isFinal = session.status === 'settled';

  return (
    <>
      {isFinal ? <MyOutcome session={session} /> : (
        <Card style={styles.reviewIntro}>
          <View style={styles.introTop}>
            <AppText variant="heading">Review the quiz</AppText>
            <InlineCountdown target={session.reviewEndsAt} clockOffset={clockOffset} />
          </View>
          <AppText>
            Results below are provisional. If a question was ambiguous or wrong, dispute it — it’s dropped for everyone if 2/3 of
            the group agree.
          </AppText>
          {session.me.isParticipant ? (
            session.me.reviewDone ? (
              <Pill tone="primary" icon="checkmark" label="You’re done — waiting for the others" />
            ) : (
              <>
                {doneError ? <Banner message={doneError} /> : null}
                <Button
                  title="I’m done reviewing"
                  icon="checkmark-done"
                  loading={busy}
                  onPress={async () => {
                    setBusy(true);
                    setDoneError(null);
                    try {
                      await api.reviewDone(session.id);
                    } catch (e) {
                      setDoneError(toApiError(e).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </>
            )
          ) : null}
        </Card>
      )}

      <SectionTitle
        title={isFinal ? 'Final standings' : 'Provisional standings'}
        right={session.assessment.decided ? <Pill tone="neutral" label={describeRule(session.assessment.decided)} /> : undefined}
      />
      <Standings session={session} />
      {session.assessment.decidedBy === 'coin_flip' ? (
        <AppText variant="caption" style={styles.note}>
          The pass rule was tied in the vote and decided by a coin flip.
        </AppText>
      ) : null}

      <SectionTitle title="Questions" />
      {error ? <Banner message={error} /> : null}
      {!review ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <View style={styles.questions}>
          {review.questions.map((q, i) => (
            <QuestionCard key={q.question.id} q={q} number={i + 1} session={session} onChanged={reload} />
          ))}
        </View>
      )}
    </>
  );
}

function MyOutcome({ session }: { session: StudySession }) {
  const me = useMe();
  const mine = session.participants.find((p) => p.user.id === me.id)?.result;
  if (!mine) return null;
  const mode = session.config.mode;
  return (
    <View style={[styles.outcome, { backgroundColor: mine.passed ? colors.primary : colors.ink }]}>
      <Ionicons name={mine.passed ? 'trophy' : 'leaf-outline'} size={34} color={colors.accent} />
      <Text style={styles.outcomeTitle}>{mine.passed ? 'You passed!' : 'Not this time'}</Text>
      <Text style={styles.outcomeScore}>{mine.quizScore}%</Text>
      <Text style={styles.outcomeSub}>
        Rank #{mine.rank}{mine.flaggedQuestions ? ` · ${mine.flaggedQuestions} flagged` : ''}
      </Text>
      <View style={styles.outcomeRow}>
        <View style={styles.outcomeStat}>
          <Text style={styles.outcomeLabel}>Stake result</Text>
          <Text style={styles.outcomeValue}>{formatSigned(mine.netAmount, mode)}</Text>
        </View>
        {mine.bonusTokens > 0 ? (
          <View style={styles.outcomeStat}>
            <Text style={styles.outcomeLabel}>Winner’s bonus</Text>
            <Text style={styles.outcomeValue}>+{mine.bonusTokens} tokens</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Standings({ session }: { session: StudySession }) {
  const ranked = [...session.participants].sort((a, b) => (a.result?.rank ?? 99) - (b.result?.rank ?? 99));
  return (
    <Card style={styles.list}>
      {ranked.map((p, i) => (
        <StandingRow key={p.user.id} p={p} mode={session.config.mode} divider={i > 0} />
      ))}
    </Card>
  );
}

function StandingRow({ p, mode, divider }: { p: Participant; mode: StudySession['config']['mode']; divider: boolean }) {
  const r = p.result;
  return (
    <View style={[styles.standing, divider && styles.divider]}>
      <Text style={styles.rank}>{r ? `#${r.rank}` : '–'}</Text>
      <Avatar name={p.user.displayName} seed={p.user.id} equipped={p.user.equipped} size={36} />
      <View style={styles.flex}>
        <AppText variant="label">{p.user.displayName}</AppText>
        <AppText variant="caption">
          {r ? `${r.quizScore}%${r.flaggedQuestions ? ` · ${r.flaggedQuestions} flagged` : ' · no flags'}` : 'No result'}
        </AppText>
      </View>
      {r ? (
        <View style={styles.standingRight}>
          <Pill tone={r.passed ? 'primary' : 'accent'} label={r.passed ? 'Pass' : 'Fail'} />
          <Text style={[styles.net, { color: r.netAmount >= 0 ? colors.primary : colors.danger }]}>{formatSigned(r.netAmount, mode)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function QuestionCard({ q, number, session, onChanged }: { q: QuestionReview; number: number; session: StudySession; onChanged: () => void }) {
  const [disputing, setDisputing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAct = session.status === 'review' && session.me.isParticipant;
  const d = q.dispute;
  const scoreLabel = q.myScore === 1 ? 'Correct' : q.myScore === 0.5 ? 'Half marks' : 'Wrong';

  async function vote(v: 'drop' | 'keep') {
    if (!d) return;
    setBusy(v);
    setError(null);
    try {
      await api.voteDispute(session.id, d.id, v);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card style={[styles.qCard, q.nullified && styles.nullified]}>
      <View style={styles.qTop}>
        <AppText variant="caption">Q{number}</AppText>
        {q.nullified ? (
          <Pill tone="neutral" icon="remove-circle-outline" label="Dropped" />
        ) : (
          <Pill tone={q.myScore === 1 ? 'primary' : 'accent'} label={q.flagged ? 'Flagged · 0' : q.expired ? 'Timed out' : scoreLabel} />
        )}
      </View>
      <Text style={styles.qPrompt}>{q.question.prompt}</Text>

      {q.question.type === 'multiple_choice' ? (
        <View style={styles.qOptions}>
          {q.question.options?.map((o) => {
            const correct = o.id === q.correctOptionId;
            const mine = o.id === q.myAnswer?.optionId;
            return (
              <View key={o.id} style={[styles.qOption, correct && styles.qCorrect, mine && !correct && styles.qWrong]}>
                <Ionicons
                  name={correct ? 'checkmark-circle' : mine ? 'close-circle' : 'ellipse-outline'}
                  size={18}
                  color={correct ? colors.primary : mine ? colors.danger : colors.lineStrong}
                />
                <Text style={styles.qOptionText}>{o.text}</Text>
                {mine ? <AppText variant="caption">your answer</AppText> : null}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.qShort}>
          <AppText variant="caption">Reference answer</AppText>
          <Text style={styles.qAnswer}>{q.modelAnswer}</Text>
          <AppText variant="caption">Your answer</AppText>
          <Text style={styles.qAnswer}>{q.myAnswer?.text || '—'}</Text>
          {q.feedback ? <AppText variant="caption">{q.feedback}</AppText> : null}
        </View>
      )}

      {d ? (
        <View style={styles.dispute}>
          <AppText variant="label">
            Disputed by {d.openedBy.displayName}: “{d.reason}”
          </AppText>
          <AppText variant="caption">
            {d.outcome === 'nullified'
              ? 'Dropped by group vote.'
              : d.outcome === 'kept'
                ? 'Not enough votes — kept.'
                : `${d.dropVotes}/${d.votesNeeded} votes to drop · ${d.keepVotes} to keep`}
          </AppText>
          {canAct && d.outcome === 'open' ? (
            d.myVote ? (
              <Pill tone="primary" icon="checkmark" label={`You voted to ${d.myVote}`} />
            ) : (
              <View style={styles.row}>
                <Button title="Drop it" size="sm" icon="remove-circle-outline" loading={busy === 'drop'} onPress={() => vote('drop')} style={styles.flex} />
                <Button title="Keep it" size="sm" variant="secondary" loading={busy === 'keep'} onPress={() => vote('keep')} style={styles.flex} />
              </View>
            )
          ) : null}
        </View>
      ) : canAct ? (
        <Button title="Dispute this question" variant="ghost" size="sm" icon="flag-outline" onPress={() => setDisputing(true)} />
      ) : null}
      {error ? <Banner message={error} /> : null}

      {disputing ? (
        <DisputeSheet
          sessionId={session.id}
          questionId={q.question.id}
          onClose={() => {
            setDisputing(false);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

function DisputeSheet({ sessionId, questionId, onClose }: { sessionId: string; questionId: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet visible onClose={onClose} title="Dispute question">
      <AppText>Explain what’s wrong. Your vote counts as “drop”; the question is removed if 2/3 of the group agree.</AppText>
      {error ? <Banner message={error} /> : null}
      <TextField label="Reason" value={reason} onChangeText={setReason} placeholder="Two of the options are both correct" maxLength={300} autoFocus />
      <Button
        title="Open dispute"
        icon="flag"
        loading={saving}
        onPress={async () => {
          if (!reason.trim()) {
            setError('Give a short reason.');
            return;
          }
          setSaving(true);
          try {
            await api.openDispute(sessionId, questionId, reason.trim());
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

export function CancelledView({ session }: { session: StudySession }) {
  return (
    <Card style={styles.cancelled}>
      <Ionicons name="close-circle-outline" size={40} color={colors.muted} />
      <AppText variant="title">Session cancelled</AppText>
      <AppText style={styles.center}>{session.cancelReason ?? 'This session was cancelled.'}</AppText>
      {session.startedAt && session.config.stakeAmount > 0 ? (
        <Pill tone="primary" icon="refresh" label={`${formatAmount(session.config.stakeAmount, session.config.mode)} stake refunded`} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  loader: { marginVertical: 24 },
  note: { marginTop: 8, textAlign: 'center' },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  reviewIntro: { gap: 12 },
  introTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  outcome: { borderRadius: radius.xl, padding: 24, alignItems: 'center', gap: 6, ...shadow.raised },
  outcomeTitle: { fontFamily: fonts.display, fontSize: 28, color: colors.onPrimary },
  outcomeScore: { fontFamily: fonts.displayBold, fontSize: 56, lineHeight: 64, color: colors.onPrimary },
  outcomeSub: { fontFamily: fonts.medium, fontSize: 14, color: colors.onPrimaryMuted },
  outcomeRow: { flexDirection: 'row', gap: 12, marginTop: 10, alignSelf: 'stretch' },
  outcomeStat: { flex: 1, backgroundColor: 'rgba(246, 242, 233, 0.1)', borderRadius: radius.md, padding: 12, alignItems: 'center' },
  outcomeLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.onPrimaryMuted },
  outcomeValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.accent, marginTop: 2 },

  standing: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  rank: { width: 28, fontFamily: fonts.bold, fontSize: 15, color: colors.muted },
  standingRight: { alignItems: 'flex-end', gap: 4 },
  net: { fontFamily: fonts.semibold, fontSize: 13 },

  questions: { gap: 12 },
  qCard: { gap: 12 },
  nullified: { opacity: 0.6 },
  qTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qPrompt: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23, color: colors.ink },
  qOptions: { gap: 6 },
  qOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.bg },
  qCorrect: { backgroundColor: colors.primarySoft },
  qWrong: { backgroundColor: colors.dangerSoft },
  qOptionText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  qShort: { gap: 4 },
  qAnswer: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink, marginBottom: 6 },
  dispute: { gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  cancelled: { alignItems: 'center', gap: 10, paddingVertical: 28 },
});
