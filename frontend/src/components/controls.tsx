import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, fonts, radius } from '@/theme';

/** A row of selectable options (segmented control that wraps). */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        const off = disabled || o.disabled;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            aria-checked={selected}
            aria-disabled={off}
            disabled={off}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && !selected && { backgroundColor: colors.line },
              off && { opacity: 0.4 },
            ]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** − value + */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  label: string;
}) {
  const btn = (dir: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + dir * step));
    const off = next === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${dir > 0 ? 'Increase' : 'Decrease'} ${label}`}
        disabled={off}
        onPress={() => onChange(next)}
        hitSlop={6}
        style={({ pressed }) => [styles.stepBtn, pressed && { backgroundColor: colors.line }, off && { opacity: 0.35 }]}
      >
        <Ionicons name={dir > 0 ? 'add' : 'remove'} size={20} color={colors.primary} />
      </Pressable>
    );
  };
  return (
    <View style={styles.stepper}>
      {btn(-1)}
      <Text style={styles.stepValue} accessibilityLabel={`${label}: ${format(value)}`}>
        {format(value)}
      </Text>
      {btn(1)}
    </View>
  );
}

/** Label + optional hint above a control. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <AppText variant="label" style={{ color: colors.inkSoft }}>
        {label}
      </AppText>
      {children}
      {hint ? <AppText variant="caption">{hint}</AppText> : null}
    </View>
  );
}

/** Back button + title row for pushed screens. */
export function PageHeader({
  title,
  subtitle,
  right,
  onBack,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.header, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
        hitSlop={10}
        style={({ pressed }) => [styles.back, pressed && { backgroundColor: colors.line }]}
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </Pressable>
      <View style={styles.headerText}>
        {subtitle ? (
          <AppText variant="caption" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
        <AppText variant="title" numberOfLines={1}>
          {title}
        </AppText>
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="heading">{title}</AppText>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkSoft },
  chipTextSelected: { color: colors.onPrimary },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  stepValue: { minWidth: 72, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },

  field: { gap: 8 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  headerText: { flex: 1 },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 10,
    gap: 10,
  },
});
