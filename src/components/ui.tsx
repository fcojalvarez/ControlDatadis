import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextVariant = 'title' | 'subtitle' | 'body' | 'small' | 'label' | 'value' | 'mono';

export function T({
  variant = 'body',
  color,
  style,
  ...props
}: TextProps & { variant?: TextVariant; color?: string }) {
  const c = useTheme();
  return (
    <Text
      {...props}
      style={[
        textStyles[variant],
        { color: color ?? (variant === 'small' || variant === 'label' ? c.textSecondary : c.text) },
        style,
      ]}
    />
  );
}

const textStyles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 15 },
  small: { fontSize: 12 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mono: { fontSize: 13, fontFamily: 'monospace' },
});

export function Screen({
  children,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const c = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.tint} /> : undefined
      }>
      <View style={styles.inner}>{children}</View>
    </ScrollView>
  );
}

export function Card({
  title,
  right,
  children,
  style,
}: {
  title?: string;
  right?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>
      {(title || right) && (
        <View style={styles.cardHeader}>
          {title ? <T variant="subtitle">{title}</T> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: c.backgroundElement }]}>
      <T variant="label">{label}</T>
      <T variant="value" color={color} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      {sub ? <T variant="small">{sub}</T> : null}
    </View>
  );
}

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  const c = useTheme();
  return (
    <View style={[styles.kv, { borderBottomColor: c.border }]}>
      <T variant="small" style={{ flex: 1 }}>
        {k}
      </T>
      {typeof v === 'string' || typeof v === 'number' ? (
        <T style={{ flex: 1.4, textAlign: 'right' }} selectable>
          {v}
        </T>
      ) : (
        <View style={{ flex: 1.4, alignItems: 'flex-end' }}>{v}</View>
      )}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const bg = variant === 'primary' ? c.tint : variant === 'danger' ? 'transparent' : c.backgroundElement;
  const fg = variant === 'primary' ? c.tintText : variant === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: c.danger },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : <T style={{ color: fg, fontWeight: '600' }}>{title}</T>}
    </Pressable>
  );
}

export function Segmented<V extends string | number>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.backgroundElement }, style]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
            <T
              variant="small"
              numberOfLines={1}
              style={{ color: active ? c.text : c.textSecondary, fontWeight: active ? '700' : '500' }}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chips<V extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const c = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              { borderColor: active ? c.tint : c.border, backgroundColor: active ? c.tint : c.card },
            ]}>
            <T variant="small" style={{ color: active ? c.tintText : c.text, fontWeight: '600' }}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Loading({ text = 'Consultando Datadis…' }: { text?: string }) {
  const c = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={c.tint} size="large" />
      <T variant="small" style={{ marginTop: Spacing.two, textAlign: 'center' }}>
        {text}
      </T>
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useTheme();
  return (
    <View style={[styles.notice, { borderColor: c.danger }]}>
      <T style={{ color: c.danger }}>{message}</T>
      {onRetry ? <Button title="Reintentar" variant="secondary" onPress={onRetry} style={{ marginTop: Spacing.two }} /> : null}
    </View>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  const c = useTheme();
  return (
    <View style={[styles.notice, { borderColor: tone === 'warning' ? c.warning : c.border }]}>
      {typeof children === 'string' ? <T variant="small">{children}</T> : children}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <T variant="small" style={{ textAlign: 'center' }}>
        {text}
      </T>
    </View>
  );
}

export function LegendItem({ color, label, style }: { color: string; label: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <T variant="small" style={style}>
        {label}
      </T>
    </View>
  );
}

export function UpdatedAt({ ts, loading }: { ts: number | null; loading?: boolean }) {
  if (loading && ts) return <T variant="small">Actualizando…</T>;
  if (!ts) return null;
  const d = new Date(ts);
  return (
    <T variant="small">
      Datos de {d.toLocaleDateString('es-ES')} {d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
    </T>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.three, paddingBottom: Spacing.five * 2, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  stat: { flexGrow: 1, flexBasis: '45%', borderRadius: 12, padding: Spacing.three, gap: 2 },
  kv: {
    flexDirection: 'row',
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    alignItems: 'center',
  },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: Spacing.three, alignItems: 'center' },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, borderColor: 'transparent' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  center: { padding: Spacing.five, alignItems: 'center', justifyContent: 'center' },
  notice: { borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
});
