import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, fonts, radius } from '@/theme';

const PRESETS = [
  { minutes: 15, label: '15m' },
  { minutes: 25, label: '25m', hint: 'Pomodoro' },
  { minutes: 45, label: '45m' },
  { minutes: 60, label: '1h' },
  { minutes: 90, label: '1.5h' },
  { minutes: 120, label: '2h' },
];

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function tick() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
}

/** Study-length picker: big readout, −/+ (hold to repeat), draggable track, presets, finish-time hint. */
export function DurationPicker({
  value,
  onChange,
  min = 5,
  max = 240,
  step = 5,
}: {
  value: number;
  onChange: (minutes: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const set = (v: number) => {
    const next = clamp(v);
    if (next !== valueRef.current) {
      valueRef.current = next;
      tick();
      onChange(next);
    }
  };

  // Hold −/+ to keep stepping
  const repeat = useRef<{ delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval>; fired?: boolean }>({});
  const stopRepeat = () => {
    clearTimeout(repeat.current.delay);
    clearInterval(repeat.current.interval);
  };
  useEffect(() => stopRepeat, []);
  const startRepeat = (dir: 1 | -1) => {
    stopRepeat();
    repeat.current.fired = false;
    repeat.current.delay = setTimeout(() => {
      repeat.current.fired = true;
      repeat.current.interval = setInterval(() => set(valueRef.current + dir * step), 90);
    }, 400);
  };

  // Draggable track
  const trackRef = useRef<View>(null);
  const trackBox = useRef({ x: 0, width: 1 });
  const fromPageX = (pageX: number) => {
    const { x, width } = trackBox.current;
    const ratio = Math.min(1, Math.max(0, (pageX - x) / width));
    set(min + ratio * (max - min));
  };
  const onGrant = (e: GestureResponderEvent) => {
    const pageX = e.nativeEvent.pageX;
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackBox.current = { x, width: width || 1 };
      fromPageX(pageX);
    });
  };

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const endsAt = new Date(now + value * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const pct = ((value - min) / (max - min)) * 100;

  const stepButton = (dir: 1 | -1) => {
    const disabled = dir < 0 ? value <= min : value >= max;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dir > 0 ? `Add ${step} minutes` : `Remove ${step} minutes`}
        aria-disabled={disabled}
        disabled={disabled}
        // After a held repeat, releasing shouldn't add one more step
        onPress={() => !repeat.current.fired && set(value + dir * step)}
        onPressIn={() => startRepeat(dir)}
        onPressOut={stopRepeat}
        hitSlop={8}
        style={({ pressed }) => [styles.round, pressed && styles.roundPressed, disabled && { opacity: 0.35 }]}
      >
        <Ionicons name={dir > 0 ? 'add' : 'remove'} size={26} color={colors.primary} />
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.readoutRow}>
        {stepButton(-1)}
        <View
          style={styles.readout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Study time"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={formatDuration(value)}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === 'increment' ? step : -step))}
        >
          <Text style={styles.value}>{formatDuration(value)}</Text>
          <AppText variant="caption">Ends around {endsAt} if you start now</AppText>
        </View>
        {stepButton(1)}
      </View>

      <View
        ref={trackRef}
        style={styles.trackHit}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderMove={(e) => fromPageX(e.nativeEvent.pageX)}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <View style={[styles.thumb, { left: `${pct}%` }]} />
      </View>
      <View style={styles.scale}>
        <AppText variant="caption">{formatDuration(min)}</AppText>
        <AppText variant="caption">{formatDuration(max)}</AppText>
      </View>

      <View style={styles.presets}>
        {PRESETS.map((p) => {
          const selected = p.minutes === value;
          return (
            <Pressable
              key={p.minutes}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityLabel={p.hint ? `${formatDuration(p.minutes)}, ${p.hint}` : formatDuration(p.minutes)}
              onPress={() => set(p.minutes)}
              style={({ pressed }) => [styles.preset, selected && styles.presetSelected, pressed && !selected && { backgroundColor: colors.line }]}
            >
              <Text style={[styles.presetText, selected && styles.presetTextSelected]}>{p.label}</Text>
              {p.hint ? <Text style={[styles.presetHint, selected && styles.presetTextSelected]}>{p.hint}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const THUMB = 24;

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
    userSelect: 'none', // dragging the track shouldn't select text on the web
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  readoutRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  readout: { flex: 1, alignItems: 'center', gap: 2 },
  value: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 40, color: colors.ink, letterSpacing: -0.5 },
  round: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  roundPressed: { backgroundColor: colors.line },
  trackHit: { height: 32, justifyContent: 'center', marginHorizontal: THUMB / 2, cursor: 'pointer' } as never,
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.primary,
    boxShadow: '0px 1px 4px rgba(23, 35, 28, 0.25)',
  },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    flexGrow: 1,
    flexBasis: '30%', // two even rows of three
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  presetSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkSoft },
  presetHint: { fontFamily: fonts.medium, fontSize: 10, color: colors.muted, marginTop: 1 },
  presetTextSelected: { color: colors.onPrimary },
});
