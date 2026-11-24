import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Defs, G, Line, Pattern, Rect, Text as SvgText } from 'react-native-svg';

import { LegendItem, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fmtNum } from '@/lib/format';

export type Segment = { value: number; color: string; name?: string };

export type BarDatum = {
  label: string; // etiqueta corta del eje X
  detail?: string; // título al seleccionar la barra
  segments: Segment[]; // apilados (de abajo a arriba) o agrupados (lado a lado)
  note?: string; // texto extra al seleccionar
  /** Dato estimado por la distribuidora (se dibuja rayado) */
  estimated?: boolean;
};

type Props = {
  data: BarDatum[];
  height?: number;
  formatValue: (v: number) => string;
  referenceLines?: { value: number; color: string; label: string }[];
  minBarWidth?: number;
  labelEvery?: number;
  mode?: 'stacked' | 'grouped';
  legend?: { color: string; label: string }[];
  totalLabel?: string;
  /** Marca (punto) opcional sobre cada barra, en la misma escala (p. ej. pico medido por el contador) */
  markers?: ({ value: number; color: string } | null)[];
  /** Unidad del eje Y (se muestra encima de los números) */
  unit?: string;
  /** Resumen que se ve en el panel superior mientras no hay ninguna barra tocada */
  idle?: string;
  /** Línea secundaria del resumen */
  idleSub?: string;
};

const AXIS_W = 40;
const BOTTOM = 24;
const TOP = 10;

/**
 * Escala del eje Y con números redondos: el paso es 1, 2 o 5 (× potencia de 10) y el máximo es
 * un múltiplo del paso, con 3 a 6 marcas (p. ej. 0 · 1 · 2 · 3 · 4 · 5).
 */
function niceScale(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 1, step: 0.25 };
  const rough = v / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  return { max: Math.ceil(v / step - 1e-9) * step, step };
}

export function BarChart({
  data,
  height = 210,
  formatValue,
  referenceLines = [],
  minBarWidth = 10,
  labelEvery,
  mode = 'stacked',
  legend,
  totalLabel = 'Total',
  markers = [],
  unit,
  idle,
  idleSub,
}: Props) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const totals = data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const peaks = data.map((d) => (mode === 'stacked' ? d.segments.reduce((s, x) => s + x.value, 0) : Math.max(0, ...d.segments.map((x) => x.value))));
  const scale = niceScale(Math.max(0, ...peaks, ...referenceLines.map((r) => r.value), ...markers.map((m) => m?.value ?? 0)) * 1.04);
  const maxVal = scale.max;
  const plotH = height - BOTTOM - TOP;

  const available = Math.max(0, width - AXIS_W);
  const nSeries = mode === 'grouped' ? Math.max(1, ...data.map((d) => d.segments.length)) : 1;
  const slot = data.length ? Math.max(minBarWidth * nSeries, available / data.length) : 0;
  const chartW = Math.max(available, slot * data.length);
  const groupW = Math.max(2, slot * 0.74);
  const every = labelEvery ?? Math.max(1, Math.ceil(40 / slot));
  const y = (v: number) => TOP + plotH - (v / maxVal) * plotH;
  const ticks = Array.from({ length: Math.round(maxVal / scale.step) + 1 }, (_, i) => i * scale.step);
  const tickDigits = scale.step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(scale.step) - 1e-9));

  // Deslizar el dedo por la gráfica va marcando cada barra (día, semana, mes…) sin levantarlo.
  // Si la gráfica se desplaza en horizontal, hay que mantener pulsado un instante antes de deslizar.
  const scrollable = chartW > available + 1;
  const n = data.length;
  const scrub = useMemo(() => {
    const pick = (x: number) => setSelected(Math.max(0, Math.min(n - 1, Math.floor(x / Math.max(1, slot)))));
    const g = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onStart((e) => pick(e.x))
      .onUpdate((e) => pick(e.x));
    return scrollable ? g.activateAfterLongPress(220) : g;
  }, [n, slot, scrollable]);

  const sel = selected !== null && selected < data.length ? selected : null;
  const selDatum = sel !== null ? data[sel] : null;

  return (
    <View onLayout={onLayout}>
      {/* Panel fijo: resumen o detalle de la barra tocada (no cambia de alto al tocar) */}
      <View style={{ minHeight: 52, justifyContent: 'center', backgroundColor: c.backgroundElement, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 }}>
        {selDatum ? (
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <T style={{ fontWeight: '700', flex: 1 }}>{selDatum.detail ?? selDatum.label}</T>
              {mode === 'stacked' && (
                <T style={{ fontWeight: '700' }}>
                  {selDatum.segments.length > 1 ? `${totalLabel}: ` : ''}
                  {formatValue(totals[sel!])}
                </T>
              )}
              <Pressable onPress={() => setSelected(null)} hitSlop={8} accessibilityLabel="Quitar selección" style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginVertical: -8, marginRight: -6 }}>
                <Ionicons name="close" size={22} color={c.textSecondary} />
              </Pressable>
            </View>
            {(selDatum.segments.length > 1 || mode === 'grouped') && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 }}>
                {selDatum.segments.map((s, i) => (
                  <LegendItem key={i} color={s.color} label={`${s.name ?? ''} ${formatValue(s.value)}`.trim()} />
                ))}
              </View>
            )}
            {selDatum.note ? <T variant="small">{selDatum.note}</T> : null}
          </View>
        ) : (
          <View style={{ gap: 2 }}>
            {idle ? <T style={{ fontWeight: '700' }}>{idle}</T> : null}
            {idleSub ? <T variant="small">{idleSub}</T> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="hand-left-outline" size={14} color={c.textSecondary} />
              <T variant="small">Toca una barra para ver su valor</T>
            </View>
          </View>
        )}
      </View>

      {unit && width > 0 ? (
        <T variant="small" style={{ fontWeight: '600', marginBottom: -2 }}>
          {unit}
        </T>
      ) : null}
      {width > 0 && (
        <View style={{ flexDirection: 'row' }}>
          <Svg width={AXIS_W} height={height}>
            {ticks.map((t, i) => (
              <SvgText key={i} x={AXIS_W - 6} y={y(t) + 4} fontSize={12} fill={c.textSecondary} textAnchor="end">
                {fmtNum(t, tickDigits)}
              </SvgText>
            ))}
          </Svg>
          <ScrollView horizontal showsHorizontalScrollIndicator={scrollable} style={{ flex: 1 }}>
            <GestureDetector gesture={scrub}>
            <View>
            <Svg width={chartW} height={height}>
              <Defs>
                <Pattern id="estimado" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                  <Rect x={0} y={0} width={2.5} height={6} fill={c.card} opacity={0.55} />
                </Pattern>
              </Defs>
              {ticks.map((t, i) => (
                <Line key={i} x1={0} x2={chartW} y1={y(t)} y2={y(t)} stroke={c.grid} strokeWidth={1} />
              ))}
              {data.map((d, i) => {
                const x0 = i * slot + (slot - groupW) / 2;
                const dim = sel !== null && sel !== i;
                let acc = 0;
                const bw = mode === 'grouped' ? groupW / Math.max(1, d.segments.length) : groupW;
                return (
                  <G key={i} opacity={dim ? 0.4 : 1}>
                    {d.segments.map((s, j) => {
                      if (s.value <= 0) return null;
                      if (mode === 'grouped') {
                        const yy = y(s.value);
                        return (
                          <Rect key={j} x={x0 + j * bw} y={yy} width={Math.max(1, bw - 1)} height={Math.max(0.5, y(0) - yy)} fill={s.color} rx={bw > 6 ? 2 : 0} />
                        );
                      }
                      const y0 = y(acc);
                      acc += s.value;
                      const y1 = y(acc);
                      return <Rect key={j} x={x0} y={y1} width={bw} height={Math.max(0.5, y0 - y1)} fill={s.color} rx={bw > 6 ? 2 : 0} />;
                    })}
                    {d.estimated && peaks[i] > 0 ? (
                      <Rect x={x0} y={y(peaks[i])} width={groupW} height={Math.max(0.5, y(0) - y(peaks[i]))} fill="url(#estimado)" />
                    ) : null}
                    {markers[i] ? (
                      <Circle
                        cx={i * slot + slot / 2}
                        cy={y(markers[i]!.value)}
                        r={Math.max(3.5, Math.min(6, slot * 0.35))}
                        fill={markers[i]!.color}
                        stroke={c.card}
                        strokeWidth={2}
                      />
                    ) : null}
                    {i % every === 0 && (
                      <SvgText x={i * slot + slot / 2} y={height - 7} fontSize={12} fill={c.textSecondary} textAnchor="middle">
                        {d.label}
                      </SvgText>
                    )}
                    <Rect x={i * slot} y={0} width={slot} height={height} fill="transparent" onPress={() => setSelected(sel === i ? null : i)} />
                  </G>
                );
              })}
              {referenceLines.map((r, i) => (
                <G key={`ref${i}`}>
                  <Line x1={0} x2={chartW} y1={y(r.value)} y2={y(r.value)} stroke={r.color} strokeWidth={1.5} strokeDasharray="5 4" />
                  <SvgText x={4} y={y(r.value) - 5} fontSize={11} fontWeight="bold" fill={r.color}>
                    {r.label}
                  </SvgText>
                </G>
              ))}
            </Svg>
            </View>
            </GestureDetector>
          </ScrollView>
        </View>
      )}
      {legend?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: 4, marginTop: 6 }}>
          {legend.map((l, i) => (
            <LegendItem key={i} color={l.color} label={l.label} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Barra horizontal de reparto (p. ej. P1/P2/P3) */
export function SplitBar({ parts, height = 16 }: { parts: { value: number; color: string }[]; height?: number }) {
  const c = useTheme();
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: c.backgroundElement }}>
      {total > 0 && parts.map((p, i) => <View key={i} style={{ flex: p.value / total, backgroundColor: p.color }} />)}
    </View>
  );
}

/** Barra de progreso simple (p. ej. potencia usada / contratada) */
export function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const c = useTheme();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={{ height: 12, borderRadius: 6, backgroundColor: c.backgroundElement, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 6 }} />
    </View>
  );
}
