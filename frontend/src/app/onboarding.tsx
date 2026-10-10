import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText, Banner, Button, Card, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import { useAuth } from '@/providers/auth';
import { colors, fonts, radius } from '@/theme';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

type Dob = { day: string; month: string; year: string };

/** Returns the ISO date and age, or an error message. */
function parseDob({ day, month, year }: Dob): { iso: string; age: number } | { error: string } | null {
  if (!day && !month && !year) return null;
  if (day.length < 1 || month.length < 1 || year.length !== 4) return { error: 'Enter your full date of birth.' };
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { error: 'That date doesn’t exist.' };
  }
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (date.getTime() >= today) return { error: 'Your date of birth must be in the past.' };
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  if (age > 120) return { error: 'Check the year.' };
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return { iso, age };
}

export default function OnboardingScreen() {
  const { session, setMe, signOut } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [dob, setDob] = useState<Dob>({ day: '', month: '', year: '' });
  const [errors, setErrors] = useState<{ username?: string; displayName?: string; dateOfBirth?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parsed = parseDob(dob);
  const age = parsed && 'age' in parsed ? parsed.age : null;

  function validate(): { iso: string } | null {
    const next: typeof errors = {};
    if (!USERNAME_RE.test(username)) next.username = '3–20 characters: lowercase letters, numbers or _.';
    if (!displayName.trim()) next.displayName = 'Tell your friends what to call you.';
    else if (displayName.trim().length > 40) next.displayName = 'Keep it under 40 characters.';
    if (!parsed) next.dateOfBirth = 'Enter your date of birth.';
    else if ('error' in parsed) next.dateOfBirth = parsed.error;
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed || 'error' in parsed) return null;
    return { iso: parsed.iso };
  }

  async function submit() {
    setFormError(null);
    const valid = validate();
    if (!valid) return;
    setSubmitting(true);
    try {
      const me = await api.createMe({ username, displayName: displayName.trim(), dateOfBirth: valid.iso });
      setMe(me);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'username_taken') setErrors({ username: 'That username is taken — try another.' });
      else if (err.code === 'validation_error') {
        setErrors({
          username: err.fieldError('username'),
          displayName: err.fieldError('displayName'),
          dateOfBirth: err.fieldError('dateOfBirth'),
        });
      } else setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="caption" style={styles.step}>
          ONE LAST STEP
        </AppText>
        <AppText variant="display">Set up your profile</AppText>
        <AppText>
          Signed in as <Text style={styles.strong}>{session?.user.email}</Text>
        </AppText>
      </View>

      <Card style={styles.card}>
        {formError ? <Banner message={formError} /> : null}

        <TextField
          label="Username"
          prefix="@"
          value={username}
          onChangeText={(t) => {
            setUsername(t.toLowerCase().replace(/\s/g, ''));
            if (errors.username) setErrors((e) => ({ ...e, username: undefined }));
          }}
          error={errors.username}
          hint="Friends find you with this. Letters, numbers and _."
          placeholder="alex_studies"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
        />

        <TextField
          label="Display name"
          value={displayName}
          onChangeText={(t) => {
            setDisplayName(t);
            if (errors.displayName) setErrors((e) => ({ ...e, displayName: undefined }));
          }}
          error={errors.displayName}
          placeholder="Alex"
          autoComplete="name"
          maxLength={40}
        />

        <DobField
          value={dob}
          onChange={(v) => {
            setDob(v);
            if (errors.dateOfBirth) setErrors((e) => ({ ...e, dateOfBirth: undefined }));
          }}
          error={errors.dateOfBirth}
        />

        {age !== null ? <AgeGate age={age} /> : null}

        <Button title="Continue" onPress={submit} loading={submitting} />
      </Card>

      <View style={styles.footer}>
        <AppText variant="caption">Not you?</AppText>
        <Button title="Sign out" variant="ghost" size="sm" onPress={signOut} />
      </View>
    </Screen>
  );
}

function AgeGate({ age }: { age: number }) {
  const adult = age >= 18;
  return (
    <View style={[styles.gate, adult ? styles.gateAdult : styles.gateMinor]}>
      <Ionicons name={adult ? 'shield-checkmark' : 'leaf'} size={20} color={adult ? colors.primary : colors.accentInk} />
      <View style={styles.gateText}>
        <AppText variant="label" style={{ color: adult ? colors.primary : colors.accentInk }}>
          {adult ? 'Tokens and real-money stakes' : 'Token mode'}
        </AppText>
        <AppText variant="caption" style={{ color: colors.inkSoft }}>
          {adult
            ? 'You’re 18+, so you can stake tokens or real money in sessions.'
            : `You’re ${age}, so you’ll stake tokens — no real money until you’re 18.`}{' '}
          Your date of birth can’t be changed later.
        </AppText>
      </View>
    </View>
  );
}

function DobField({ value, onChange, error }: { value: Dob; onChange: (v: Dob) => void; error?: string }) {
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  return (
    <View style={styles.dobField}>
      <AppText variant="label" style={{ color: colors.inkSoft }}>
        Date of birth
      </AppText>
      <View style={styles.dobRow}>
        <DobPart
          label="Day of birth"
          placeholder="DD"
          maxLength={2}
          width={64}
          value={value.day}
          invalid={!!error}
          onChangeText={(day) => onChange({ ...value, day })}
          onFilled={() => monthRef.current?.focus()}
        />
        <Text style={styles.dobSep}>/</Text>
        <DobPart
          inputRef={monthRef}
          label="Month of birth"
          placeholder="MM"
          maxLength={2}
          width={64}
          value={value.month}
          invalid={!!error}
          onChangeText={(month) => onChange({ ...value, month })}
          onFilled={() => yearRef.current?.focus()}
        />
        <Text style={styles.dobSep}>/</Text>
        <DobPart
          inputRef={yearRef}
          label="Year of birth"
          placeholder="YYYY"
          maxLength={4}
          width={92}
          value={value.year}
          invalid={!!error}
          onChangeText={(year) => onChange({ ...value, year })}
        />
      </View>
      <AppText variant="caption" style={error ? { color: colors.danger } : undefined}>
        {error ?? 'We use this to decide whether real-money stakes are available.'}
      </AppText>
    </View>
  );
}

function DobPart({
  inputRef,
  label,
  placeholder,
  maxLength,
  width,
  value,
  invalid,
  onChangeText,
  onFilled,
}: {
  inputRef?: Ref<TextInput>;
  label: string;
  placeholder: string;
  maxLength: number;
  width: number;
  value: string;
  invalid: boolean;
  onChangeText: (digits: string) => void;
  onFilled?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={(t) => {
        const digits = t.replace(/\D/g, '').slice(0, maxLength);
        onChangeText(digits);
        if (digits.length === maxLength) onFilled?.();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType="number-pad"
      maxLength={maxLength}
      accessibilityLabel={label}
      style={[
        styles.dobInput,
        { width },
        focused && styles.dobInputFocused,
        invalid && styles.dobInputError,
        Platform.OS === 'web' && { outlineWidth: 0 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 32 },
  header: { gap: 8, marginBottom: 24 },
  step: { fontFamily: fonts.semibold, letterSpacing: 1.2, color: colors.primary },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  card: { gap: 18, padding: 22 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, gap: 2 },
  gate: { flexDirection: 'row', gap: 12, borderRadius: radius.md, padding: 14, alignItems: 'flex-start' },
  gateAdult: { backgroundColor: colors.primarySoft },
  gateMinor: { backgroundColor: colors.accentSoft },
  gateText: { flex: 1, gap: 2 },
  dobField: { gap: 6 },
  dobRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dobSep: { fontFamily: fonts.medium, fontSize: 18, color: colors.lineStrong },
  dobInput: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontFamily: fonts.medium,
    fontSize: 17,
    color: colors.ink,
  },
  dobInputFocused: { borderColor: colors.primary },
  dobInputError: { borderColor: colors.danger },
});
