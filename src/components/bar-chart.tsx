import { useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtNum } from '@/lib/format';

export type BarDatum = {
  label: string; // etiqueta corta del eje X
  detail?: string; // texto al seleccionar
  segments: { value: number; color: string }[]; // apilados de abajo a arriba
};

type Props = {
  data: BarDatum[];
  height?: number;
  formatValue: (v: number) => string;
  referenceLines?: { value: number; color: string; label: string }[];
  minBarWidth?: number;
  labelEvery?: number; // muestra una etiqueta cada N barras (auto si se omite)
};

const AXIS_W = 44;
const BOTTOM = 22;
const TOP = 8;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function BarChart({ data, height = 200, formatValue, referenceLines = [], minBarWidth = 10, labelEvery }: Props) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const totals = data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const maxVal = niceMax(Math.max(0, ...totals, ...referenceLines.map((r) => r.value)) * 1.05);
  const plotH = height - BOTTOM - TOP;

  const available = Math.max(0, width - AXIS_W);
  const slot = data.length ? Math.max(minBarWidth + 2, available / data.length) : 0;
  const chartW = Math.max(available, slot * data.length);
  const barW = Math.max(2, slot * 0.72);
  const every = labelEvery ?? Math.max(1, Math.ceil(36 / slot));
  const y = (v: number) => TOP + plotH - (v / maxVal) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxVal);

  const sel = selected !== null && selected < data.length ? selected : null;

  return (
    <View onLayout={onLayout}>
      <View style={{ minHeight: 34, justifyContent: 'center' }}>
        {sel !== null ? (
          <T variant="small" style={{ color: c.text }}>
            <T variant="small" style={{ fontWeight: '700', color: c.text }}>
              {data[sel].detail ?? data[sel].label}
            </T>
            {'  '}
            {formatValue(totals[sel])}
          </T>
        ) : (
          <T variant="small">Toca una barra para ver el detalle</T>
        )}
      </View>
      {width > 0 && (
        <View style={{ flexDirection: 'row' }}>
          <Svg width={AXIS_W} height={height}>
            {ticks.map((t, i) => (
              <SvgText
                key={i}
                x={AXIS_W - 6}
                y={y(t) + 4}
                fontSize={10}
                fill={c.textSecondary}
                textAnchor="end">
                {fmtNum(t, maxVal >= 5 ? 0 : maxVal >= 0.5 ? 1 : 2)}
              </SvgText>
            ))}
          </Svg>
          <ScrollView horizontal showsHorizontalScrollIndicator={chartW > available} style={{ flex: 1 }}>
            <Svg width={chartW} height={height}>
              {ticks.map((t, i) => (
                <Line key={i} x1={0} x2={chartW} y1={y(t)} y2={y(t)} stroke={c.grid} strokeWidth={1} />
              ))}
              {data.map((d, i) => {
                const x = i * slot + (slot - barW) / 2;
                let acc = 0;
                const dim = sel !== null && sel !== i;
                return (
                  <G key={i} opacity={dim ? 0.45 : 1}>
                    {d.segments.map((s, j) => {
                      if (s.value <= 0) return null;
                      const y0 = y(acc);
                      acc += s.value;
                      const y1 = y(acc);
                      return <Rect key={j} x={x} y={y1} width={barW} height={Math.max(0.5, y0 - y1)} fill={s.color} rx={barW > 6 ? 2 : 0} />;
                    })}
                    {i % every === 0 && (
                      <SvgText x={i * slot + slot / 2} y={height - 6} fontSize={10} fill={c.textSecondary} textAnchor="middle">
                        {d.label}
                      </SvgText>
                    )}
                    <Rect
                      x={i * slot}
                      y={0}
                      width={slot}
                      height={height}
                      fill="transparent"
                      onPress={() => setSelected(sel === i ? null : i)}
                    />
                  </G>
                );
              })}
              {referenceLines.map((r, i) => (
                <G key={`ref${i}`}>
                  <Line
                    x1={0}
                    x2={chartW}
                    y1={y(r.value)}
                    y2={y(r.value)}
                    stroke={r.color}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                  />
                  <SvgText x={4} y={y(r.value) - 4} fontSize={10} fill={r.color}>
                    {r.label}
                  </SvgText>
                </G>
              ))}
            </Svg>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/** Barra horizontal de reparto (p. ej. P1/P2/P3) */
export function SplitBar({ parts }: { parts: { value: number; color: string }[] }) {
  const c = useTheme();
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: c.backgroundElement }}>
      {total > 0 &&
        parts.map((p, i) => <View key={i} style={{ flex: p.value / total, backgroundColor: p.color }} />)}
    </View>
  );
}
