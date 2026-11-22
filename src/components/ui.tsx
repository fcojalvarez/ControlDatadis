import { useState, type ReactNode } from 'react';
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

import Ionicons from '@expo/vector-icons/Ionicons';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// ---------- Texto ----------

type TextVariant = 'hero' | 'title' | 'subtitle' | 'body' | 'small' | 'label' | 'value' | 'mono';

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
  hero: { fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13.5, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  value: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mono: { fontSize: 14, fontFamily: 'monospace' },
});

// ---------- Contenedores ----------

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
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.tint} /> : undefined
      }>
      <View style={styles.inner}>{children}</View>
    </ScrollView>
  );
}

/** Tarjeta con título opcional, subtítulo y una explicación desplegable (botón "?") */
export function Card({
  title,
  subtitle,
  info,
  right,
  children,
  style,
  onPress,
}: {
  title?: string;
  subtitle?: string;
  info?: string;
  right?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Si se indica, toda la tarjeta es tocable y muestra una flecha › */
  onPress?: () => void;
}) {
  const c = useTheme();
  const [showInfo, setShowInfo] = useState(false);
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        <Card
          title={title}
          subtitle={subtitle}
          info={info}
          style={style}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {right}
              <Ionicons name="chevron-forward" size={20} color={c.textSecondary} />
            </View>
          }>
          {children}
        </Card>
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>
      {(title || right || info) && (
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            {title ? <T variant="subtitle">{title}</T> : null}
            {subtitle ? <T variant="small">{subtitle}</T> : null}
          </View>
          {right}
          {info ? (
            <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={10} accessibilityLabel="Más información">
              <Ionicons name={showInfo ? 'information-circle' : 'information-circle-outline'} size={22} color={showInfo ? c.tint : c.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      )}
      {info && showInfo ? (
        <View style={[styles.infoBox, { backgroundColor: c.backgroundElement }]}>
          <T variant="small" style={{ color: c.text }}>
            {info}
          </T>
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <T variant="label" style={{ marginTop: Spacing.two, marginLeft: Spacing.one }}>
      {children}
    </T>
  );
}

// ---------- Datos ----------

export function Stat({
  label,
  value,
  sub,
  color,
  delta,
  invertDelta,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  delta?: { pct: number | null; label: string };
  invertDelta?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: c.backgroundElement }]}>
      <T variant="label">{label}</T>
      <T variant="value" color={color} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      {delta ? <Delta pct={delta.pct} label={delta.label} invert={invertDelta} /> : null}
      {sub ? <T variant="small">{sub}</T> : null}
    </View>
  );
}

/** Variación porcentual: en consumo, subir es malo (rojo) y bajar es bueno (verde). */
export function Delta({ pct, label, invert }: { pct: number | null; label: string; invert?: boolean }) {
  const c = useTheme();
  if (pct === null) return null;
  const up = pct > 0.5;
  const down = pct < -0.5;
  const bad = invert ? down : up;
  const good = invert ? up : down;
  const color = bad ? c.danger : good ? c.p3 : c.textSecondary;
  const n = Math.abs(pct).toLocaleString('es-ES', { maximumFractionDigits: 0 });
  const text = up ? `▲ ${n} % más ${label}` : down ? `▼ ${n} % menos ${label}` : `= Igual ${label.replace(/^que /, 'que ')}`;
  return (
    <T variant="small" style={{ color, fontWeight: '600' }}>
      {text}
    </T>
  );
}

export function KeyValue({ k, v, hint }: { k: string; v: ReactNode; hint?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.kv, { borderBottomColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <T variant="small" style={{ color: c.textSecondary }}>
          {k}
        </T>
        {hint ? (
          <T variant="small" style={{ fontSize: 12, opacity: 0.8 }}>
            {hint}
          </T>
        ) : null}
      </View>
      {typeof v === 'string' || typeof v === 'number' ? (
        <T style={{ flex: 1.3, textAlign: 'right', fontWeight: '500' }} selectable>
          {v}
        </T>
      ) : (
        <View style={{ flex: 1.3, alignItems: 'flex-end' }}>{v}</View>
      )}
    </View>
  );
}

export type Column<R> = {
  title: string;
  render: (r: R) => string;
  align?: 'left' | 'right';
  width?: number;
  color?: (r: R) => string | undefined;
};

/** Tabla con cabecera; desplazable en horizontal si no cabe. */
export function DataTable<R>({ columns, rows, footer }: { columns: Column<R>[]; rows: R[]; footer?: R }) {
  const c = useTheme();
  const cell = (col: Column<R>, i: number): TextStyle => ({
    width: col.width ?? (i === 0 ? 66 : 54),
    textAlign: col.align ?? (i === 0 ? 'left' : 'right'),
    fontVariant: ['tabular-nums'],
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={[styles.tr, { borderBottomColor: c.border }]}>
          {columns.map((col, i) => (
            <T key={i} variant="label" style={cell(col, i)}>
              {col.title}
            </T>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={[styles.tr, { borderBottomColor: c.border }, ri % 2 === 1 && { backgroundColor: c.backgroundElement }]}>
            {columns.map((col, i) => (
              <T key={i} variant="small" style={[cell(col, i), { color: col.color?.(r) ?? c.text }]}>
                {col.render(r)}
              </T>
            ))}
          </View>
        ))}
        {footer ? (
          <View style={[styles.tr, { borderTopWidth: 1, borderTopColor: c.text, borderBottomWidth: 0 }]}>
            {columns.map((col, i) => (
              <T key={i} variant="small" style={[cell(col, i), { color: c.text, fontWeight: '700' }]}>
                {col.render(footer)}
              </T>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** Sección desplegable ("Ver datos") */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[styles.disclosure, { borderColor: c.border }]}
        accessibilityRole="button">
        <T style={{ color: c.tint, fontWeight: '600', flex: 1 }}>{title}</T>
        <T style={{ color: c.tint, fontWeight: '700' }}>{open ? '▲' : '▼'}</T>
      </Pressable>
      {open ? <View style={{ marginTop: Spacing.two }}>{children}</View> : null}
    </View>
  );
}

// ---------- Controles ----------

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
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: c.danger },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : <T style={{ color: fg, fontWeight: '700' }}>{title}</T>}
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
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
            <T
              numberOfLines={1}
              style={{ fontSize: 14, color: active ? c.text : c.textSecondary, fontWeight: active ? '700' : '500' }}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pestañas con subrayado, desplazables si no caben */
export function TabBar<V extends string>({
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
    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, backgroundColor: c.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tab, { borderBottomColor: active ? c.tint : 'transparent' }]}>
              <T style={{ fontSize: 14, fontWeight: active ? '700' : '500', color: active ? c.tint : c.textSecondary }}>
                {o.label}
              </T>
            </Pressable>
          );
        })}
      </ScrollView>
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
    <View style={styles.chips}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, { borderColor: active ? c.tint : c.border, backgroundColor: active ? c.tint : c.card }]}>
            <T style={{ fontSize: 14, color: active ? c.tintText : c.text, fontWeight: '600' }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Navegador ‹ etiqueta › */
export function Stepper({
  label,
  sublabel,
  onPrev,
  onNext,
  canPrev,
  canNext,
}: {
  label: string;
  sublabel?: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const c = useTheme();
  const arrow = (enabled: boolean, txt: string, fn: () => void, a11y: string) => (
    <Pressable
      onPress={fn}
      disabled={!enabled}
      hitSlop={8}
      accessibilityLabel={a11y}
      style={[styles.stepBtn, { backgroundColor: c.backgroundElement, opacity: enabled ? 1 : 0.35 }]}>
      <T style={{ fontSize: 22, fontWeight: '700', color: c.tint, lineHeight: 26 }}>{txt}</T>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {arrow(canPrev, '‹', onPrev, 'Anterior')}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <T style={{ fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{label}</T>
        {sublabel ? <T variant="small" style={{ textAlign: 'center' }}>{sublabel}</T> : null}
      </View>
      {arrow(canNext, '›', onNext, 'Siguiente')}
    </View>
  );
}

// ---------- Estados ----------

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

export function InlineLoading({ text }: { text: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
      <ActivityIndicator color={c.tint} size="small" />
      <T variant="small">{text}</T>
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useTheme();
  return (
    <View style={[styles.notice, { borderColor: c.danger }]}>
      <T style={{ color: c.danger, fontWeight: '600' }}>No se pudieron cargar los datos</T>
      <T variant="small" style={{ color: c.text, marginTop: 2 }}>
        {message}
      </T>
      {onRetry ? <Button title="Reintentar" variant="secondary" onPress={onRetry} style={{ marginTop: Spacing.two }} /> : null}
    </View>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'good' }) {
  const c = useTheme();
  const color = tone === 'warning' ? c.warning : tone === 'good' ? c.p3 : c.border;
  return (
    <View style={[styles.notice, { borderColor: color, borderLeftWidth: 4 }]}>
      {typeof children === 'string' ? <T variant="small" style={{ color: c.text }}>{children}</T> : children}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <T style={{ textAlign: 'center' }} color={undefined}>
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

/**
 * Aviso cuando Datadis falla pero hay datos guardados en el móvil: se muestran esos datos.
 * Si no hay datos guardados, se muestra el error con el botón de reintentar.
 */
export function SavedDataNotice({
  hasData,
  error,
  stale,
  ts,
  onRetry,
}: {
  hasData: boolean;
  error: string | null;
  stale?: boolean;
  ts: number | null;
  onRetry?: () => void;
}) {
  const c = useTheme();
  if (!hasData) return error ? <ErrorBox message={error} onRetry={onRetry} /> : null;
  if (!error && !stale) return null;
  const when = ts
    ? `${new Date(ts).toLocaleDateString('es-ES')} a las ${new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    : null;
  const limited = !!error && /limitado/.test(error);
  return (
    <Notice tone="warning">
      <T style={{ fontWeight: '700' }}>
        {limited ? 'Datadis ha limitado las consultas' : error ? 'Datadis no responde ahora mismo' : 'Datadis devolvió datos vacíos'}
      </T>
      <T variant="small" style={{ color: c.text }}>
        {limited
          ? `${error!.replace(/^Datadis ha limitado las consultas\.\s*/, '')} Mientras tanto ves los datos guardados en el móvil; lo ya descargado no se pierde.`
          : `Te mostramos los datos guardados en el móvil${when ? ` (descargados el ${when})` : ''}. Se volverá a intentar más tarde, o desliza hacia abajo para reintentar.`}
      </T>
    </Notice>
  );
}

export function UpdatedAt({ ts, loading }: { ts: number | null; loading?: boolean }) {
  if (loading && ts) return <T variant="small">Actualizando…</T>;
  if (!ts) return null;
  const d = new Date(ts);
  return (
    <T variant="small" style={{ textAlign: 'center' }}>
      Datos descargados el {d.toLocaleDateString('es-ES')} a las{' '}
      {d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · desliza hacia abajo para actualizar
    </T>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.three, paddingBottom: Spacing.five * 2, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: 2 },
  infoBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  infoBox: { borderRadius: 10, padding: Spacing.two + 2 },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  stat: { flexGrow: 1, flexBasis: '45%', borderRadius: 14, padding: 14, gap: 3 },
  kv: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    alignItems: 'center',
  },
  tr: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  disclosure: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  button: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: Spacing.three, alignItems: 'center' },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segment: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9, borderColor: 'transparent' },
  tabBar: { paddingHorizontal: Spacing.one, flexGrow: 1 },
  tab: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 12, borderBottomWidth: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { padding: Spacing.five, alignItems: 'center', justifyContent: 'center' },
  notice: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
});

/** Icono ⓘ que despliega una explicación al tocarlo (para no ocupar espacio con texto) */
export function InfoToggle({ text, size = 20 }: { text: string; size?: number }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={10} accessibilityLabel="Más información" style={{ alignSelf: 'center' }}>
        <Ionicons name={open ? 'information-circle' : 'information-circle-outline'} size={size} color={open ? c.tint : c.textSecondary} />
      </Pressable>
      {open ? (
        <View style={[styles.infoBox, { backgroundColor: c.backgroundElement, marginTop: 6 }]}>
          <T variant="small" style={{ color: c.text }}>
            {text}
          </T>
        </View>
      ) : null}
    </View>
  );
}
