import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PageHeader } from '@/components/controls';
import { Screen } from '@/components/screen';
import { STATUS_LABEL } from '@/components/session/format';
import { LobbyView } from '@/components/session/lobby';
import { WaitingCard } from '@/components/session/parts';
import { QuizView } from '@/components/session/quiz';
import { CancelledView, ReviewView } from '@/components/session/review';
import { ExtensionVoteView, SharedTodos, StudyingView } from '@/components/session/studying';
import { Banner, Button, Pill } from '@/components/ui';
import { useFocusReporter } from '@/hooks/use-focus-reporter';
import { useSessionLive } from '@/hooks/use-session-live';
import { colors } from '@/theme';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const live = useSessionLive(id);
  const { session, clockOffset } = live;

  // Focus is only tracked during the quiz (anti-cheat); study however you like.
  const tracking = !!session?.me.isParticipant && session.status === 'quiz';
  useFocusReporter(tracking, live.sendFocus, false);

  const goToGroup = () => (session ? router.replace(`/groups/${session.group.id}`) : router.back());

  if (!session) {
    return (
      <Screen>
        <PageHeader title="Study session" />
        {live.error ? (
          <Banner message={live.error.message} action={{ label: 'Retry', onPress: live.refresh }} />
        ) : (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader
        title={session.config.title}
        subtitle={session.group.name}
        onBack={goToGroup}
        right={<Pill tone={session.status === 'settled' ? 'primary' : 'accent'} label={STATUS_LABEL[session.status]} />}
      />
      {!live.connected ? (
        <View style={styles.banner}>
          <Banner tone="info" message="Reconnecting… updates may be a few seconds late." />
        </View>
      ) : null}

      {session.status === 'lobby' ? <LobbyView session={session} setSession={live.setSession} /> : null}

      {session.status === 'studying' ? (
        <StudyingView session={session} setSession={live.setSession} todos={live.todos} setTodos={live.setTodos} clockOffset={clockOffset} />
      ) : null}

      {session.status === 'extension_vote' ? (
        <>
          <ExtensionVoteView session={session} setSession={live.setSession} clockOffset={clockOffset} />
          <SharedTodos session={session} todos={live.todos} setTodos={live.setTodos} />
        </>
      ) : null}

      {session.status === 'generating_quiz' ? (
        <WaitingCard
          icon="sparkles-outline"
          title="Writing your quiz…"
          body={`Gemma is reading your study material and writing ${session.config.quizQuestionCount} questions. This usually takes under a minute.`}
        />
      ) : null}

      {session.status === 'quiz' ? <QuizView session={session} /> : null}

      {session.status === 'grading' ? (
        <WaitingCard icon="checkmark-done-outline" title="Grading answers…" body="Short answers are being checked against the reference answers." />
      ) : null}

      {session.status === 'review' || session.status === 'settled' ? <ReviewView session={session} clockOffset={clockOffset} /> : null}

      {session.status === 'cancelled' ? <CancelledView session={session} /> : null}

      {session.status === 'settled' || session.status === 'cancelled' ? (
        <Button title={`Back to ${session.group.name}`} variant="secondary" icon="arrow-back" onPress={goToGroup} style={styles.back} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 40 },
  banner: { marginBottom: 12 },
  back: { marginTop: 24 },
});
