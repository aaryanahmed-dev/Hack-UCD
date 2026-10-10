import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { SectionTitle, Stepper } from '@/components/controls';
import { formatDuration } from '@/components/duration-picker';
import { Sheet } from '@/components/sheet';
import { AppText, Banner, Button, Card, Pill, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { AssessmentRule, GroupMember, Material, StudySession, ThresholdType } from '@/lib/types';
import { useMe } from '@/providers/auth';
import { colors, fonts, radius } from '@/theme';
import { SessionConfigSheet } from './config-sheet';
import { describeRule, formatAmount } from './format';
import { Fact, ParticipantRow } from './parts';

type Props = { session: StudySession; setSession: (s: StudySession) => void };

/** Run an action, show its error, and keep the button spinning meanwhile. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, setError, run };
}

export function LobbyView({ session, setSession }: Props) {
  const me = useMe();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const cfg = session.config;
  const isParticipant = session.me.isParticipant;
  const everyoneReady = session.participants.length >= 2 && session.participants.every((p) => p.isReady);

  if (!isParticipant) {
    return (
      <>
        <StakesCard session={session} />
        <Card style={styles.joinCard}>
          <AppText variant="heading">Join this session?</AppText>
          <AppText>
            You’ll stake {formatAmount(cfg.stakeAmount, cfg.mode)} and study for {formatDuration(cfg.studyMinutes)} with{' '}
            {session.participants.length} {session.participants.length === 1 ? 'other' : 'others'}.
          </AppText>
          {error ? <Banner message={error} /> : null}
          <Button
            title="Join session"
            icon="enter-outline"
            loading={busy === 'join'}
            disabled={session.participants.length >= cfg.maxParticipants || (cfg.mode === 'money' && !me.isAdult)}
            onPress={() => run('join', async () => setSession(await api.joinSession(session.id)))}
          />
          {cfg.mode === 'money' && !me.isAdult ? <AppText variant="caption">Money sessions are for 18+ only.</AppText> : null}
        </Card>
        <SectionTitle title={`In the lobby (${session.participants.length}/${cfg.maxParticipants})`} />
        <ParticipantList session={session} />
      </>
    );
  }

  return (
    <>
      <StakesCard session={session} onEdit={session.me.isHost ? () => setEditing(true) : undefined} />

      {cfg.scheduledFor ? (
        <Card style={styles.scheduled}>
          <Ionicons name="calendar-outline" size={18} color={colors.primary} />
          <AppText style={styles.flex}>
            Scheduled for{' '}
            {new Date(cfg.scheduledFor).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          </AppText>
        </Card>
      ) : null}

      <SectionTitle
        title={`People (${session.participants.length}/${cfg.maxParticipants})`}
        right={<Button title="Invite" size="sm" variant="secondary" icon="paper-plane-outline" onPress={() => setInviting(true)} />}
      />
      <ParticipantList session={session} />

      <AssessmentVote session={session} setSession={setSession} />

      <Materials session={session} setSession={setSession} />

      {/* Ready / start */}
      <View style={styles.actions}>
        {error ? <Banner message={error} /> : null}
        <Button
          title={session.me.isReady ? 'Ready ✓ — tap to undo' : 'I’m ready'}
          variant={session.me.isReady ? 'secondary' : 'primary'}
          icon={session.me.isReady ? undefined : 'checkmark-circle-outline'}
          loading={busy === 'ready'}
          onPress={() => run('ready', async () => setSession(await api.setReady(session.id, !session.me.isReady)))}
        />
        {session.me.isHost ? (
          <Button
            title={everyoneReady ? 'Start session' : 'Waiting for everyone to be ready'}
            icon="play"
            disabled={!everyoneReady}
            loading={busy === 'start'}
            onPress={() => run('start', async () => setSession(await api.startSession(session.id)))}
          />
        ) : null}
        <AppText variant="caption" style={styles.center}>
          Ready means: you’ve voted, approved every material, and have {formatAmount(cfg.stakeAmount, cfg.mode)} to stake.
        </AppText>
        <View style={styles.secondaryActions}>
          <Button
            title="Leave lobby"
            variant="ghost"
            size="sm"
            loading={busy === 'leave'}
            onPress={() =>
              run('leave', async () => {
                await api.leaveSession(session.id);
                router.back();
              })
            }
          />
          {session.me.isHost ? (
            <Button
              title="Cancel session"
              variant="ghost"
              size="sm"
              loading={busy === 'cancel'}
              onPress={() => run('cancel', () => api.cancelSession(session.id))}
            />
          ) : null}
        </View>
      </View>

      {inviting ? <InviteMembersSheet session={session} onClose={() => setInviting(false)} /> : null}

      <SessionConfigSheet
        visible={editing}
        session={session}
        onClose={() => setEditing(false)}
        onSaved={(s) => {
          setEditing(false);
          setSession(s);
        }}
      />
    </>
  );
}

function InviteMembersSheet({ session, onClose }: { session: StudySession; onClose: () => void }) {
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const inSession = new Set(session.participants.map((p) => p.user.id));

  useEffect(() => {
    api.getGroup(session.group.id).then((g) => setMembers(g.members.filter((m) => !inSession.has(m.user.id))), () => setMembers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.group.id]);

  return (
    <Sheet visible onClose={onClose} title="Invite to this session">
      <AppText>Everyone you pick gets a notification with a link to the lobby.</AppText>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
      {!members ? (
        <ActivityIndicator color={colors.primary} />
      ) : members.length === 0 ? (
        <AppText variant="caption">Everyone in {session.group.name} is already here. Invite friends to the group from the group page.</AppText>
      ) : (
        <Card style={styles.list}>
          {members.map((m, i) => {
            const on = picked.includes(m.user.id);
            return (
              <Pressable
                key={m.user.id}
                accessibilityRole="checkbox"
                aria-checked={on}
                onPress={() => setPicked(on ? picked.filter((x) => x !== m.user.id) : [...picked, m.user.id])}
                style={[styles.memberRow, i > 0 && styles.divider]}
              >
                <View style={[styles.pick, on && styles.pickOn]}>{on ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}</View>
                <AppText variant="label" style={styles.flex}>
                  {m.user.displayName}
                </AppText>
                <AppText variant="caption">{m.status === 'offline' ? 'Offline' : m.status === 'studying' ? 'Studying' : 'Online'}</AppText>
              </Pressable>
            );
          })}
        </Card>
      )}
      <Button
        title={picked.length ? `Send ${picked.length} invite${picked.length === 1 ? '' : 's'}` : 'Pick people to invite'}
        icon="paper-plane"
        disabled={!picked.length}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const r = await api.inviteToSession(session.id, picked);
            setMessage({ tone: 'info', text: `Invited ${r.invited} ${r.invited === 1 ? 'person' : 'people'}.` });
            setPicked([]);
          } catch (e) {
            setMessage({ tone: 'error', text: toApiError(e).message });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

export function StakesCard({ session, onEdit }: { session: StudySession; onEdit?: () => void }) {
  const cfg = session.config;
  const destination =
    cfg.payoutTarget === 'winners' ? 'Split among winners' : session.charity ? session.charity.name : 'Charity';
  return (
    <Card style={styles.stakes}>
      <View style={styles.stakesTop}>
        <View style={styles.flex}>
          <AppText variant="caption">Stake per person</AppText>
          <Text style={styles.stakeValue}>{formatAmount(cfg.stakeAmount, cfg.mode)}</Text>
        </View>
        {onEdit ? <Button title="Edit" icon="create-outline" variant="secondary" size="sm" onPress={onEdit} /> : null}
      </View>
      <View style={styles.facts}>
        <Fact icon="time-outline" label="Study time" value={formatDuration(cfg.studyMinutes)} />
        <Fact icon="help-circle-outline" label="Quiz" value={`${cfg.quizQuestionCount} questions · 20 s each`} />
        <Fact icon="swap-horizontal-outline" label="Failed stakes go to" value={destination} />
        <Fact icon="shield-checkmark-outline" label="Anti-cheat" value="Quiz tab tracking" />
        <Fact
          icon="add-circle-outline"
          label="Extensions"
          value={cfg.maxExtensions ? `Up to ${cfg.maxExtensions} × ${cfg.extensionMinutes} min` : 'None'}
        />
        <Fact icon={cfg.mode === 'money' ? 'card-outline' : 'leaf-outline'} label="Mode" value={cfg.mode === 'money' ? 'Real money' : 'Tokens'} />
      </View>
    </Card>
  );
}

function ParticipantList({ session }: { session: StudySession }) {
  return (
    <Card style={styles.list}>
      {session.participants.map((p, i) => (
        <ParticipantRow
          key={p.user.id}
          p={p}
          divider={i > 0}
          right={
            <View style={styles.badges}>
              {session.status === 'lobby' ? (
                <>
                  <Pill tone={p.hasVoted ? 'primary' : 'neutral'} icon={p.hasVoted ? 'checkmark' : 'ellipsis-horizontal'} label="Vote" />
                  <Pill tone={p.isReady ? 'primary' : 'neutral'} icon={p.isReady ? 'checkmark' : 'ellipsis-horizontal'} label="Ready" />
                </>
              ) : null}
            </View>
          }
        />
      ))}
    </Card>
  );
}

// ───────── Assessment vote ─────────

const RULES: { type: ThresholdType; title: string; body: string; min: number; max: number; step: number; initial: number; unit: (v: number) => string }[] = [
  { type: 'fixed', title: 'Fixed pass mark', body: 'Everyone at or above the mark keeps their stake.', min: 10, max: 100, step: 5, initial: 70, unit: (v) => `${v}%` },
  { type: 'top_percent', title: 'Top performers pass', body: 'A share of the group passes, ranked by score.', min: 10, max: 90, step: 10, initial: 50, unit: (v) => `Top ${v}%` },
  { type: 'relative_to_best', title: 'Curved on the best score', body: 'Pass if you’re within this many points of the top scorer.', min: 5, max: 50, step: 5, initial: 15, unit: (v) => `${v} pts` },
];

function AssessmentVote({ session, setSession }: Props) {
  const mine = session.assessment.myVote;
  const [selected, setSelected] = useState<ThresholdType>(mine?.thresholdType ?? 'fixed');
  const [values, setValues] = useState<Record<ThresholdType, number>>({
    fixed: mine?.thresholdType === 'fixed' ? mine.thresholdValue : 70,
    top_percent: mine?.thresholdType === 'top_percent' ? mine.thresholdValue : 50,
    relative_to_best: mine?.thresholdType === 'relative_to_best' ? mine.thresholdValue : 15,
  });
  const { busy, error, run } = useAction();
  const draft: AssessmentRule = { thresholdType: selected, thresholdValue: values[selected] };
  const unchanged = mine && mine.thresholdType === draft.thresholdType && mine.thresholdValue === draft.thresholdValue;

  return (
    <>
      <SectionTitle title="Vote: how is the quiz passed?" />
      <Card style={styles.voteCard}>
        {RULES.map((r) => {
          const active = selected === r.type;
          return (
            <Pressable
              key={r.type}
              accessibilityRole="radio"
              aria-checked={active}
              onPress={() => setSelected(r.type)}
              style={[styles.rule, active && styles.ruleActive]}
            >
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? colors.primary : colors.muted} />
              <View style={styles.flex}>
                <Text style={styles.ruleTitle}>{r.title}</Text>
                <AppText variant="caption">{r.body}</AppText>
                {active ? (
                  <View style={styles.ruleStepper}>
                    <Stepper
                      label={r.title}
                      value={values[r.type]}
                      min={r.min}
                      max={r.max}
                      step={r.step}
                      format={r.unit}
                      onChange={(v) => setValues((vals) => ({ ...vals, [r.type]: v }))}
                    />
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
        {error ? <Banner message={error} /> : null}
        <Button
          title={unchanged ? 'Vote cast' : mine ? 'Change my vote' : 'Cast vote'}
          icon={unchanged ? 'checkmark' : 'hand-left-outline'}
          variant={unchanged ? 'secondary' : 'primary'}
          disabled={!!unchanged}
          loading={busy === 'vote'}
          onPress={() => run('vote', async () => setSession(await api.voteAssessment(session.id, draft)))}
        />
        {session.assessment.votes.length > 0 ? (
          <View style={styles.tally}>
            <AppText variant="label">Live tally</AppText>
            {session.assessment.votes.map((v) => (
              <View key={`${v.rule.thresholdType}-${v.rule.thresholdValue}`} style={styles.tallyRow}>
                <AppText style={styles.flex}>{describeRule(v.rule)}</AppText>
                <Pill tone="primary" label={`${v.count} ${v.count === 1 ? 'vote' : 'votes'}`} />
              </View>
            ))}
            <AppText variant="caption">
              The most-voted rule wins when the session starts (ties: coin flip). Its value is the median of those votes.
            </AppText>
          </View>
        ) : null}
      </Card>
    </>
  );
}

// ───────── Materials ─────────

function Materials({ session, setSession }: Props) {
  const me = useMe();
  const { busy, error, run, setError } = useAction();
  const [pasting, setPasting] = useState(false);
  const total = session.participants.length;

  async function upload() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ],
      copyToCacheDirectory: true,
      base64: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (asset.size && asset.size > 20 * 1024 * 1024) {
      setError('Files can be at most 20 MB.');
      return;
    }
    const form = new FormData();
    if (Platform.OS === 'web' && asset.file) form.append('file', asset.file, asset.name);
    // React Native's FormData accepts {uri, name, type} for files
    else form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' } as unknown as Blob);
    await run('upload', async () => {
      await api.uploadMaterial(session.id, form);
      setSession(await api.getSession(session.id));
    });
  }

  return (
    <>
      <SectionTitle title="Study material" />
      <Card style={styles.list}>
        {session.materials.length === 0 ? (
          <View style={styles.emptyMaterials}>
            <Ionicons name="document-text-outline" size={26} color={colors.muted} />
            <AppText style={styles.center}>
              Add the notes, slides or PDFs you’re studying. The quiz is written only from this material.
            </AppText>
          </View>
        ) : (
          session.materials.map((m, i) => (
            <MaterialRow
              key={m.id}
              m={m}
              total={total}
              divider={i > 0}
              approved={m.approvedBy.includes(me.id)}
              canDelete={m.uploadedBy.id === me.id || session.me.isHost}
              busy={busy}
              onApprove={(approved) => run(`approve-${m.id}`, async () => {
                await api.approveMaterial(session.id, m.id, approved);
                setSession(await api.getSession(session.id));
              })}
              onDelete={() => run(`delete-${m.id}`, async () => {
                await api.deleteMaterial(session.id, m.id);
                setSession(await api.getSession(session.id));
              })}
            />
          ))
        )}
        <View style={styles.materialActions}>
          {error ? <Banner message={error} /> : null}
          <View style={styles.row}>
            <Button title="Upload file" icon="cloud-upload-outline" variant="secondary" size="sm" loading={busy === 'upload'} onPress={upload} style={styles.flex} />
            <Button title="Paste notes" icon="clipboard-outline" variant="secondary" size="sm" onPress={() => setPasting(true)} style={styles.flex} />
          </View>
          <AppText variant="caption" style={styles.center}>
            PDF, Word, PowerPoint, .txt or .md · up to 20 MB · everyone must approve each item
          </AppText>
        </View>
      </Card>
      {pasting ? (
        <PasteSheet
          onClose={() => setPasting(false)}
          onSave={async (title, text) => {
            await api.pasteMaterial(session.id, title, text);
            setSession(await api.getSession(session.id));
            setPasting(false);
          }}
        />
      ) : null}
    </>
  );
}

function MaterialRow({
  m,
  total,
  divider,
  approved,
  canDelete,
  busy,
  onApprove,
  onDelete,
}: {
  m: Material;
  total: number;
  divider: boolean;
  approved: boolean;
  canDelete: boolean;
  busy: string | null;
  onApprove: (approved: boolean) => void;
  onDelete: () => void;
}) {
  const failed = m.textStatus === 'failed';
  return (
    <View style={[styles.material, divider && styles.divider]}>
      <View style={[styles.materialIcon, failed && { backgroundColor: colors.dangerSoft }]}>
        <Ionicons
          name={failed ? 'alert-circle-outline' : m.kind === 'text' ? 'reader-outline' : 'document-outline'}
          size={20}
          color={failed ? colors.danger : colors.primary}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" numberOfLines={1}>
          {m.title}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {failed
            ? 'Couldn’t read any text — remove it or paste the text instead'
            : `${m.uploadedBy.displayName} · ${m.approvedBy.length}/${total} approved`}
        </AppText>
      </View>
      {busy === `approve-${m.id}` || busy === `delete-${m.id}` ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.row}>
          {!failed ? (
            <Pressable
              accessibilityRole="checkbox"
              aria-checked={approved}
              accessibilityLabel={`Approve ${m.title}`}
              onPress={() => onApprove(!approved)}
              style={[styles.approve, approved && styles.approveOn]}
            >
              <Ionicons name={approved ? 'checkmark' : 'thumbs-up-outline'} size={16} color={approved ? colors.onPrimary : colors.primary} />
              <Text style={[styles.approveText, approved && { color: colors.onPrimary }]}>{approved ? 'Approved' : 'Approve'}</Text>
            </Pressable>
          ) : null}
          {canDelete ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${m.title}`} onPress={onDelete} hitSlop={8} style={styles.trash}>
              <Ionicons name="trash-outline" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function PasteSheet({ onClose, onSave }: { onClose: () => void; onSave: (title: string, text: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet visible onClose={onClose} title="Paste notes">
      {error ? <Banner message={error} /> : null}
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Lecture 5 notes" maxLength={200} autoFocus />
      <TextField
        label="Notes"
        value={text}
        onChangeText={setText}
        placeholder="Paste your notes here…"
        multiline
        maxLength={100_000}
        numberOfLines={8}
        textAlignVertical="top"
        hint={`${text.length.toLocaleString()} / 100,000 characters`}
      />
      <Button
        title="Add to material"
        icon="add"
        loading={saving}
        onPress={async () => {
          if (!title.trim() || !text.trim()) {
            setError('Add a title and some text.');
            return;
          }
          setSaving(true);
          try {
            await onSave(title.trim(), text.trim());
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
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  badges: { flexDirection: 'row', gap: 6 },

  stakes: { gap: 10 },
  stakesTop: { flexDirection: 'row', alignItems: 'center' },
  stakeValue: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.primary, marginTop: 2 },
  facts: { flexDirection: 'row', flexWrap: 'wrap' },

  joinCard: { gap: 12, marginTop: 14 },
  scheduled: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingVertical: 14 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  pick: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pickOn: { backgroundColor: colors.primary },

  voteCard: { gap: 10 },
  rule: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line },
  ruleActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  ruleTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  ruleStepper: { marginTop: 10 },
  tally: { gap: 8, marginTop: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  tallyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  emptyMaterials: { alignItems: 'center', gap: 8, padding: 20 },
  material: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  materialIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  approve: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  approveOn: { backgroundColor: colors.primary },
  approveText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.primary },
  trash: { padding: 6 },
  materialActions: { gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: colors.line },

  actions: { gap: 10, marginTop: 24 },
  secondaryActions: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
});
