import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components/ui';
import { sameDay, weekdayShort } from '@/lib/dates';
import type { ActivityDay } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

const HEIGHT = 120;
const BAR_MAX = 24;

function fmt(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function localDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Single-series column chart of study minutes per day. One hue (brand green), columns ≤24px with
 * 4px rounded tops on one baseline, a 2px gap, labels only on the best day and today, a
 * tap/hover tooltip for the rest, and a text summary for screen readers.
 */
export function ActivityChart({ days }: { days: ActivityDay[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const max = Math.max(...days.map((d) => d.studyMinutes), 0);
  const scaleMax = max === 0 ? 60 : Math.ceil(max / 30) * 30; // clean ticks in half hours
  const today = new Date();
  const best = max > 0 ? days.findIndex((d) => d.studyMinutes === max) : -1;
  const total = days.reduce((s, d) => s + d.studyMinutes, 0);
  const slot = width / Math.max(days.length, 1);
  const barWidth = Math.max(4, Math.min(BAR_MAX, slot - 2));
  const shown = active ?? null;

  return (
    <View
      accessible
      accessibilityLabel={`Study time over the last ${days.length} days: ${fmt(total)} in total${best >= 0 ? `, best day ${weekdayShort(localDate(days[best].date))} with ${fmt(max)}` : ''}.`}
    >
      {/* Tooltip */}
      <View style={styles.tooltipSlot}>
        {shown !== null ? (
          <View style={styles.tooltip}>
            <Text style={styles.tooltipTitle}>
              {localDate(days[shown].date).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}
            </Text>
            <Text style={styles.tooltipBody}>
              {fmt(days[shown].studyMinutes)} studied · {days[shown].sessions} {days[shown].sessions === 1 ? 'session' : 'sessions'} ·{' '}
              {days[shown].todosCompleted} {days[shown].todosCompleted === 1 ? 'task' : 'tasks'} done
            </Text>
          </View>
        ) : (
          <AppText variant="caption">Tap a day for details</AppText>
        )}
      </View>

      <View style={styles.plot}>
        <Text style={styles.tick}>{fmt(scaleMax)}</Text>
        <View style={styles.columns} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 &&
            days.map((d, i) => {
              const h = d.studyMinutes > 0 ? Math.max(4, (d.studyMinutes / scaleMax) * HEIGHT) : 2;
              const isToday = sameDay(localDate(d.date), today);
              const label = i === best || (isToday && d.studyMinutes > 0);
              const dim = shown !== null && shown !== i;
              return (
                <Pressable
                  key={d.date}
                  accessibilityRole="button"
                  accessibilityLabel={`${localDate(d.date).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}: ${fmt(d.studyMinutes)}`}
                  onPress={() => setActive(active === i ? null : i)}
                  onHoverIn={() => setActive(i)}
                  onHoverOut={() => setActive(null)}
                  style={[styles.slot, { width: slot }]}
                >
                  {label ? <Text style={styles.valueLabel}>{fmt(d.studyMinutes)}</Text> : null}
                  <View
                    style={[
                      styles.bar,
                      {
                        width: barWidth,
                        height: h,
                        backgroundColor: d.studyMinutes > 0 ? colors.primary : colors.line,
                        opacity: dim ? 0.35 : 1,
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
        </View>
      </View>
      <View style={styles.baseline} />
      <View style={styles.axis}>
        {days.map((d, i) => {
          const date = localDate(d.date);
          const isToday = sameDay(date, today);
          // Label every other day plus today, to avoid crowding
          const show = isToday || (days.length - 1 - i) % 2 === 0;
          return (
            <Text key={d.date} style={[styles.axisLabel, { width: slot }, isToday && styles.axisToday]}>
              {show ? (isToday ? 'Today' : weekdayShort(date).slice(0, 2)) : ''}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tooltipSlot: { minHeight: 40, justifyContent: 'center' },
  tooltip: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: colors.ink },
  tooltipTitle: { fontFamily: fonts.semibold, fontSize: 12, color: colors.surface },
  tooltipBody: { fontFamily: fonts.body, fontSize: 12, color: colors.lineStrong },
  plot: { height: HEIGHT + 18, justifyContent: 'flex-end' },
  tick: { position: 'absolute', top: 0, right: 0, fontFamily: fonts.medium, fontSize: 10, color: colors.muted },
  columns: { flexDirection: 'row', alignItems: 'flex-end', height: HEIGHT + 18 },
  slot: { alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  valueLabel: { fontFamily: fonts.semibold, fontSize: 10, color: colors.inkSoft, marginBottom: 3 },
  baseline: { height: 1, backgroundColor: colors.line },
  axis: { flexDirection: 'row', marginTop: 6 },
  axisLabel: { textAlign: 'center', fontFamily: fonts.medium, fontSize: 10, color: colors.muted },
  axisToday: { color: colors.ink, fontFamily: fonts.bold },
});
