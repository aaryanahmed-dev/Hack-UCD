import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components/ui';
import { WEEKDAY_INITIALS, addMonths, formatMinutesOfDay, monthGrid, sameDay, startOfDay } from '@/lib/dates';
import { colors, fonts, radius } from '@/theme';

/** Compact month calendar for picking a day. */
export function DatePicker({
  value,
  onChange,
  minDate,
  dots,
}: {
  value: Date | null;
  onChange: (day: Date) => void;
  minDate?: Date;
  /** Optional per-day marker colours (key = local yyyy-m-d). */
  dots?: Record<string, string[]>;
}) {
  const [month, setMonth] = useState(() => new Date((value ?? new Date()).getFullYear(), (value ?? new Date()).getMonth(), 1));
  const today = new Date();
  const min = minDate ? startOfDay(minDate) : null;

  return (
    <View style={styles.cal}>
      <View style={styles.calHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(addMonths(month, -1))} hitSlop={8} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.ink} />
        </Pressable>
        <Text style={styles.monthLabel}>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonth(addMonths(month, 1))} hitSlop={8} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.ink} />
        </Pressable>
      </View>
      <View style={styles.weekRow}>
        {WEEKDAY_INITIALS.map((d, i) => (
          <Text key={i} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {monthGrid(month).map((d) => {
          const inMonth = d.getMonth() === month.getMonth();
          const selected = value != null && sameDay(d, value);
          const isToday = sameDay(d, today);
          const disabled = min != null && d < min;
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
              aria-selected={selected}
              aria-disabled={disabled}
              disabled={disabled}
              onPress={() => onChange(d)}
              style={styles.cell}
            >
              <View style={[styles.day, isToday && styles.today, selected && styles.selected]}>
                <Text
                  style={[
                    styles.dayText,
                    !inMonth && styles.outside,
                    disabled && styles.disabled,
                    selected && styles.selectedText,
                  ]}
                >
                  {d.getDate()}
                </Text>
              </View>
              <View style={styles.dots}>
                {(dots?.[key] ?? []).slice(0, 3).map((c, i) => (
                  <View key={i} style={[styles.dot, { backgroundColor: c }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Time of day in 15-minute steps: − 5:30 PM + and quick picks. */
export function TimePicker({ minutes, onChange, step = 15 }: { minutes: number; onChange: (m: number) => void; step?: number }) {
  const set = (m: number) => onChange(((m % 1440) + 1440) % 1440);
  return (
    <View style={styles.time}>
      <View style={styles.timeRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${step} minutes earlier`} onPress={() => set(minutes - step)} style={styles.timeBtn}>
          <Ionicons name="remove" size={20} color={colors.primary} />
        </Pressable>
        <Text style={styles.timeValue} accessibilityLabel={`Time ${formatMinutesOfDay(minutes)}`}>
          {formatMinutesOfDay(minutes)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${step} minutes later`} onPress={() => set(minutes + step)} style={styles.timeBtn}>
          <Ionicons name="add" size={20} color={colors.primary} />
        </Pressable>
      </View>
      <View style={styles.quick}>
        {[9 * 60, 12 * 60, 15 * 60, 18 * 60, 21 * 60].map((m) => (
          <Pressable
            key={m}
            accessibilityRole="radio"
            aria-checked={minutes === m}
            onPress={() => set(m)}
            style={[styles.quickChip, minutes === m && styles.quickChipOn]}
          >
            <Text style={[styles.quickText, minutes === m && styles.quickTextOn]}>{formatMinutesOfDay(m)}</Text>
          </Pressable>
        ))}
      </View>
      <AppText variant="caption">Times are in your local time zone.</AppText>
    </View>
  );
}

const CELL = `${100 / 7}%` as const;

const styles = StyleSheet.create({
  cal: { gap: 6, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  monthLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  weekRow: { flexDirection: 'row' },
  weekday: { width: CELL, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, alignItems: 'center', paddingVertical: 2 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.accent },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  outside: { color: colors.lineStrong },
  disabled: { color: colors.line },
  selectedText: { color: colors.onPrimary, fontFamily: fonts.bold },
  dots: { flexDirection: 'row', gap: 2, height: 5, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },

  time: { gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  timeValue: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.ink },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.bg },
  quickChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkSoft },
  quickTextOn: { color: colors.onPrimary },
});
