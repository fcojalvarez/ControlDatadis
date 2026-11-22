import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  rows: string[]; // etiquetas de fila (p. ej. L M X J V S D)
  rowNames?: string[]; // nombres completos para el detalle
  matrix: number[][]; // [fila][columna 0..23]
  formatValue: (v: number) => string;
};

const LEFT = 26;
const TOP = 4;
const BOTTOM = 18;

/** Mapa de calor fila × hora. Cuanto más intenso el color, más consumo. */
export function Heatmap({ rows, rowNames, matrix, formatValue }: Props) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<{ r: number; h: number } | null>(null);
  const cols = 24;
  const cellW = width > 0 ? (width - LEFT) / cols : 0;
  const cellH = 26;
  const height = TOP + rows.length * cellH + BOTTOM;
  const max = Math.max(0.0001, ...matrix.flat());

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View onLayout={onLayout}>
      {sel ? (
      <View style={{ minHeight: 40, justifyContent: 'center', backgroundColor: c.backgroundElement, borderRadius: 10, padding: 10, marginBottom: 6 }}>
        {sel ? (
          <T>
            <T style={{ fontWeight: '700' }}>
              {rowNames?.[sel.r] ?? rows[sel.r]} de {String(sel.h).padStart(2, '0')}:00 a {String(sel.h + 1).padStart(2, '0')}:00
            </T>
            {'  '}
            {formatValue(matrix[sel.r][sel.h])} de media
          </T>
        ) : null}
      </View>
      ) : null}
      {width > 0 && (
        <Svg width={width} height={height}>
          {matrix.map((row, r) =>
            row.map((v, h) => {
              const t = v / max;
              const isSel = sel?.r === r && sel?.h === h;
              return (
                <Rect
                  key={`${r}-${h}`}
                  x={LEFT + h * cellW + 0.5}
                  y={TOP + r * cellH + 0.5}
                  width={cellW - 1}
                  height={cellH - 1}
                  rx={2}
                  fill={c.tint}
                  fillOpacity={0.08 + 0.92 * t}
                  stroke={isSel ? c.text : 'none'}
                  strokeWidth={isSel ? 2 : 0}
                  onPress={() => setSel(isSel ? null : { r, h })}
                />
              );
            }),
          )}
          {rows.map((l, r) => (
            <SvgText key={l + r} x={LEFT - 8} y={TOP + r * cellH + cellH / 2 + 4} fontSize={12} fill={c.textSecondary} textAnchor="end">
              {l}
            </SvgText>
          ))}
          {[0, 4, 8, 12, 16, 20].map((h) => (
            <SvgText key={h} x={LEFT + h * cellW + cellW / 2} y={height - 4} fontSize={11} fill={c.textSecondary} textAnchor="middle">
              {h}h
            </SvgText>
          ))}
        </Svg>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <T variant="small">Menos</T>
        {[0.1, 0.3, 0.5, 0.7, 0.9].map((o) => (
          <View key={o} style={{ width: 18, height: 10, borderRadius: 2, backgroundColor: c.tint, opacity: o }} />
        ))}
        <T variant="small">Más consumo</T>
      </View>
    </View>
  );
}
