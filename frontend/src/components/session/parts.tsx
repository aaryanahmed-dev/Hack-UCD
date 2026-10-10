import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppText, Avatar, Card, Pill, type IconName } from '@/components/ui';
import { formatClock, useCountdown } from '@/hooks/use-countdown';
import type { FocusState, Participant } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

export const FOCUS_COLOR: Record<FocusState, string> = {
  focused: colors.live,
  idle: colors.accent,
  away: colors.danger,
  offline: colors.lineStrong,
};
export const FOCUS_LABEL: Record<FocusState, string> = {
  focused: 'Focused',
  idle: 'Idle',
  away: 'Away',
  offline: 'Offline',
};

/** Big server-synced countdown. */
export function BigCountdown({ target, clockOffset, label }: { target: string | null; clockOffset: number; label: string }) {
  const ms = useCountdown(target, clockOffset);
  return (
    <View style={styles.bigCountdown} accessibilityRole="timer" accessibilityLabel={`${label}: ${formatClock(ms)}`}>
      <Text style={styles.bigTime}>{formatClock(ms)}</Text>
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
  );
}

/** Small inline countdown like "2:41 left". */
export function InlineCountdown({ target, clockOffset, suffix = 'left' }: { target: string | null; clockOffset: number; suffix?: string }) {
  const ms = useCountdown(target, clockOffset, 500);
  return <Pill icon="time-outline" tone="accent" label={`${formatClock(ms)} ${suffix}`} />;
}

export function ParticipantRow({
  p,
  right,
  subtitle,
  divider,
}: {
  p: Participant;
  right?: ReactNode;
  subtitle?: string;
  divider?: boolean;
}) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <View>
        <Avatar name={p.user.displayName} seed={p.user.id} equipped={p.user.equipped} size={40} />
        <View style={[styles.dot, { backgroundColor: p.presence === 'online' ? colors.live : colors.lineStrong }]} />
      </View>
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <AppText variant="label" numberOfLines={1}>
            {p.user.displayName}
          </AppText>
          {p.isHost ? <Ionicons name="star" size={13} color={colors.accent} accessibilityLabel="Host" /> : null}
        </View>
        <AppText variant="caption" numberOfLines={1}>
          {subtitle ?? `@${p.user.username}`}
        </AppText>
      </View>
      {right}
    </View>
  );
}

export function WaitingCard({ icon, title, body }: { icon?: IconName; title: string; body: string }) {
  return (
    <Card style={styles.waiting}>
      {icon ? (
        <View style={styles.waitingIcon}>
          <Ionicons name={icon} size={28} color={colors.primary} />
        </View>
      ) : null}
      <ActivityIndicator color={colors.primary} />
      <AppText variant="title" style={styles.center}>
        {title}
      </AppText>
      <AppText style={styles.center}>{body}</AppText>
    </Card>
  );
}

export function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <View style={styles.flex}>
        <AppText variant="caption">{label}</AppText>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    </View>
  );
}

export function ProgressBar({ value, color = colors.accent, trackColor }: { value: number; color?: string; trackColor?: string }) {
  return (
    <View style={[styles.track, trackColor ? { backgroundColor: trackColor } : null]}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  bigCountdown: { alignItems: 'center', gap: 2 },
  bigTime: { fontFamily: fonts.displayBold, fontSize: 64, lineHeight: 72, color: colors.onPrimary, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  bigLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.onPrimaryMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.surface },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  waiting: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  waitingIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  fact: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', width: '50%', paddingVertical: 8, paddingRight: 8 },
  factValue: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, marginTop: 1 },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
});
