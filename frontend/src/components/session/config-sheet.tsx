import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chips, Field, Stepper } from '@/components/controls';
import { DatePicker, TimePicker } from '@/components/date-time';
import { DurationPicker } from '@/components/duration-picker';
import { addDays, atMinutes, minutesOfDay, startOfDay } from '@/lib/dates';
import { Sheet } from '@/components/sheet';
import { AppText, Banner, Button, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { Charity, SessionConfig, StudySession } from '@/lib/types';
import { useMe } from '@/providers/auth';
import { colors, fonts, radius } from '@/theme';
import { formatAmount } from './format';

export const DEFAULT_CONFIG: SessionConfig = {
  title: '',
  mode: 'tokens',
  stakeAmount: 20,
  payoutTarget: 'winners',
  charityId: null,
  studyMinutes: 45,
  extensionMinutes: 10,
  maxExtensions: 2,
  quizQuestionCount: 5,
  minFocusPercent: 0,
  maxParticipants: 10,
  scheduledFor: null,
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Create in this group, or edit this session. */
  groupId?: string;
  session?: StudySession;
  onSaved: (session: StudySession) => void;
};

export function SessionConfigSheet(props: Props) {
  return props.visible ? <ConfigForm {...props} /> : null;
}

function defaultSchedule(): string {
  // Tomorrow at 6 PM local, a sensible starting point to adjust from
  return atMinutes(addDays(startOfDay(new Date()), 1), 18 * 60);
}

function ConfigForm({ onClose, groupId, session, onSaved }: Props) {
  const me = useMe();
  const [cfg, setCfg] = useState<SessionConfig>(session ? session.config : DEFAULT_CONFIG);
  const [charities, setCharities] = useState<Charity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.listCharities().then(
      (r) => active && setCharities(r.items),
      () => active && setCharities([]),
    );
    return () => {
      active = false;
    };
  }, []);

  const set = <K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) => setCfg((c) => ({ ...c, [key]: value }));
  const isMoney = cfg.mode === 'money';
  // A charity is only needed when failed stakes go to charity (if nobody passes in "winners" mode, stakes are refunded).
  const needsCharity = cfg.payoutTarget === 'charity';

  function setMode(mode: SessionConfig['mode']) {
    setCfg((c) => ({
      ...c,
      mode,
      stakeAmount: mode === 'money' ? Math.max(100, Math.round(c.stakeAmount / 100) * 100 || 500) : Math.min(c.stakeAmount, 200),
    }));
  }

  async function save() {
    setError(null);
    if (!cfg.title.trim()) {
      setError('Give the session a name.');
      return;
    }
    if (needsCharity && !cfg.charityId) {
      setError('Pick a charity.');
      return;
    }
    if (cfg.scheduledFor && new Date(cfg.scheduledFor).getTime() < Date.now()) {
      setError('Pick a time in the future.');
      return;
    }
    setSaving(true);
    try {
      const body = { ...cfg, title: cfg.title.trim(), charityId: needsCharity ? cfg.charityId : null };
      const result = session ? await api.updateSession(session.id, body) : await api.createSession(groupId!, body);
      onSaved(result);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title={session ? 'Session settings' : 'New study session'}>
      {error ? <Banner message={error} /> : null}

      <TextField
        label="Session name"
        value={cfg.title}
        onChangeText={(t) => set('title', t)}
        placeholder="Organic chem — chapter 4"
        maxLength={60}
        autoFocus={!session}
      />

      <Field label="When">
        <Chips
          options={[
            { value: 'now', label: 'Start from the lobby' },
            { value: 'later', label: 'Schedule for later' },
          ]}
          value={cfg.scheduledFor ? 'later' : 'now'}
          onChange={(v) => set('scheduledFor', v === 'later' ? defaultSchedule() : null)}
        />
        {cfg.scheduledFor ? (
          <>
            <DatePicker value={startOfDay(new Date(cfg.scheduledFor))} minDate={new Date()} onChange={(d) => set('scheduledFor', atMinutes(d, minutesOfDay(new Date(cfg.scheduledFor!))))} />
            <TimePicker minutes={minutesOfDay(new Date(cfg.scheduledFor))} onChange={(m) => set('scheduledFor', atMinutes(new Date(cfg.scheduledFor!), m))} />
            <AppText variant="caption">
              The group gets a reminder 15 minutes before, and it’s added to Google Calendar for anyone who’s connected it.
            </AppText>
          </>
        ) : null}
      </Field>

      <Field label="Study for" hint="Everyone can agree to finish early, and you can vote to extend when time’s up.">
        <DurationPicker value={cfg.studyMinutes} onChange={(v) => set('studyMinutes', v)} />
      </Field>

      <Field
        label="Stake"
        hint={
          !me.isAdult
            ? 'Real-money stakes unlock at 18 — you can stake tokens.'
            : me.verificationRequired && !me.idVerified
              ? 'Verify your ID in your wallet to stake real money.'
              : undefined
        }
      >
        <Chips
          options={[
            { value: 'tokens', label: 'Tokens' },
            { value: 'money', label: 'Real money', disabled: !me.isAdult || (me.verificationRequired && !me.idVerified) },
          ]}
          value={cfg.mode}
          onChange={setMode}
        />
        <Stepper
          label="Stake per person"
          value={cfg.stakeAmount}
          onChange={(v) => set('stakeAmount', v)}
          min={isMoney ? 100 : 0}
          max={isMoney ? 10_000 : 1_000}
          step={isMoney ? 100 : 5}
          format={(v) => formatAmount(v, cfg.mode)}
        />
      </Field>

      <Field
        label="If someone fails, their stake goes to"
        hint={
          cfg.payoutTarget === 'winners'
            ? 'Split among those who pass, in proportion to their scores. If nobody passes, everyone gets their stake back.'
            : isMoney
              ? 'Donated to the charity you pick.'
              : 'Forfeited tokens are burned.'
        }
      >
        <Chips
          options={[
            { value: 'winners', label: 'The winners' },
            { value: 'charity', label: 'Charity' },
          ]}
          value={cfg.payoutTarget}
          onChange={(v) => setCfg((c) => ({ ...c, payoutTarget: v, charityId: v === 'charity' ? c.charityId : null }))}
        />
      </Field>

      {needsCharity ? (
        <Field label="Charity">
          {charities === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.charities}>
              {charities.map((c) => {
                const selected = cfg.charityId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="radio"
                    aria-checked={selected}
                    onPress={() => set('charityId', c.id)}
                    style={[styles.charity, selected && styles.charitySelected]}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? colors.primary : colors.muted}
                    />
                    <View style={styles.flex}>
                      <Text style={styles.charityName}>{c.name}</Text>
                      <AppText variant="caption" numberOfLines={2}>
                        {c.description}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Field>
      ) : null}

      <Field label="Quiz questions">
        <Stepper label="Questions" value={cfg.quizQuestionCount} onChange={(v) => set('quizQuestionCount', v)} min={5} max={10} />
      </Field>


      <Field label="Extensions" hint="When time's up, the group can vote to keep studying.">
        <Chips
          options={[0, 1, 2, 3].map((n) => ({ value: n, label: n === 0 ? 'None' : `Up to ${n}` }))}
          value={cfg.maxExtensions}
          onChange={(v) => set('maxExtensions', v)}
        />
        {cfg.maxExtensions > 0 ? (
          <Chips
            options={[5, 10, 15, 30].map((m) => ({ value: m, label: `+${m} min` }))}
            value={cfg.extensionMinutes}
            onChange={(v) => set('extensionMinutes', v)}
          />
        ) : null}
      </Field>

      <Button title={session ? 'Save changes' : 'Create session'} icon={session ? 'checkmark' : 'add'} onPress={save} loading={saving} />
      {session ? (
        <AppText variant="caption" style={styles.center}>
          Saving un-readies everyone so they can check the new terms.
        </AppText>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  charities: { gap: 8 },
  charity: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  charitySelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  charityName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
});
