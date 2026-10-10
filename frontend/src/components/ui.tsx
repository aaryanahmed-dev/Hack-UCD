import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AVATARS, FRAMES } from '@/lib/cosmetics';
import { colorFor, colors, fonts, initials, radius, shadow } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ───────── Text ─────────

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';

const textVariants: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.6, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: colors.ink },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 23, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.ink },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
};

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <Text {...props} style={[textVariants[variant], style]} />;
}

// ───────── Button ─────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'light';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const buttonColors: Record<ButtonVariant, { bg: string; pressed: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: colors.onPrimary },
  secondary: { bg: colors.surface, pressed: colors.surfaceAlt, fg: colors.ink, border: colors.lineStrong },
  ghost: { bg: 'transparent', pressed: colors.surfaceAlt, fg: colors.primary },
  light: { bg: colors.onPrimary, pressed: '#E6E0D3', fg: colors.primary },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'md',
  style,
  accessibilityLabel,
}: ButtonProps) {
  const c = buttonColors[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      aria-disabled={!!inactive}
      aria-busy={!!loading}
      disabled={inactive}
      onPress={() => {
        if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        { backgroundColor: pressed || hovered ? c.pressed : c.bg },
        c.border ? { borderWidth: 1, borderColor: c.border } : null,
        disabled && !loading ? { opacity: 0.45 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={c.fg} /> : null}
          <Text style={[styles.buttonText, size === 'sm' && styles.buttonTextSm, { color: c.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ───────── Inputs ─────────

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
  prefix?: string;
  secure?: boolean;
  ref?: Ref<TextInput>;
}

export function TextField({ label, error, hint, prefix, secure, ref, ...inputProps }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <AppText variant="label" style={styles.fieldLabel}>
        {label}
      </AppText>
      <View
        style={[
          styles.inputWrap,
          focused && styles.inputWrapFocused,
          !!error && styles.inputWrapError,
        ]}
      >
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.muted}
          {...inputProps}
          secureTextEntry={secure && !revealed}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          style={[styles.input, Platform.OS === 'web' && { outlineWidth: 0 }]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((v) => !v)}
            hitSlop={10}
            style={styles.reveal}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" style={styles.errorText}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" style={styles.hintText}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// ───────── Surfaces ─────────

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Banner({
  tone = 'error',
  message,
  action,
}: {
  tone?: 'error' | 'info';
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const isError = tone === 'error';
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: isError ? colors.dangerSoft : colors.primarySoft }]}
    >
      <Ionicons
        name={isError ? 'alert-circle' : 'information-circle'}
        size={18}
        color={isError ? colors.danger : colors.primary}
      />
      <AppText style={[styles.bannerText, { color: isError ? colors.danger : colors.primary }]}>{message}</AppText>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8}>
          <Text style={[styles.bannerAction, { color: isError ? colors.danger : colors.primary }]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: 'neutral' | 'accent' | 'primary' | 'onDark'; icon?: IconName }) {
  const palette = {
    neutral: { bg: colors.surfaceAlt, fg: colors.inkSoft },
    accent: { bg: colors.accentSoft, fg: colors.accentInk },
    primary: { bg: colors.primarySoft, fg: colors.primary },
    onDark: { bg: 'rgba(246, 242, 233, 0.14)', fg: colors.onPrimary },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} /> : null}
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

/** Initials on a colour — or the equipped store avatar, with an optional coloured frame ring. */
export function Avatar({
  name,
  seed,
  size = 40,
  equipped,
}: {
  name: string;
  seed: string;
  size?: number;
  equipped?: { avatar?: string | null; frame?: string | null } | null;
}) {
  const custom = equipped?.avatar ? AVATARS[equipped.avatar] : undefined;
  const frame = equipped?.frame ? FRAMES[equipped.frame] : undefined;
  const ring = frame ? Math.max(2, Math.round(size * 0.07)) : 0;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: custom?.color ?? colorFor(seed),
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring,
        borderColor: frame,
      }}
    >
      {custom ? (
        <Ionicons name={custom.icon as IconName} size={(size - ring * 2) * 0.5} color={colors.onPrimary} />
      ) : (
        <Text style={{ color: colors.onPrimary, fontFamily: fonts.semibold, fontSize: (size - ring * 2) * 0.38 }}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="leaf" size={size * 0.52} color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSm: { minHeight: 38, borderRadius: radius.sm, paddingHorizontal: 14 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16 },
  buttonTextSm: { fontSize: 14 },

  field: { gap: 6 },
  fieldLabel: { color: colors.inkSoft },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  inputWrapFocused: { borderColor: colors.primary },
  inputWrapError: { borderColor: colors.danger },
  prefix: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted, marginRight: 2 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink, paddingVertical: 14 },
  reveal: { paddingLeft: 10 },
  errorText: { color: colors.danger },
  hintText: {},

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.medium },
  bannerAction: { fontFamily: fonts.semibold, fontSize: 14, textDecorationLine: 'underline' },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pillText: { fontFamily: fonts.semibold, fontSize: 12 },
});
