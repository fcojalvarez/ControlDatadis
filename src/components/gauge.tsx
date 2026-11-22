import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtPct } from '@/lib/format';

function polar(cx: number, cy: number, r: number, angle: number) {
  // angle: 0 = izquierda, 180 = derecha (semicírculo superior)
  const a = Math.PI - (angle * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const s = polar(cx, cy, r, from);
  const e = polar(cx, cy, r, to);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
}

/** Medidor semicircular de 0 a 100 % con zonas de color */
export function Gauge({ value, label, sublabel, size = 240 }: { value: number; label: string; sublabel?: string; size?: number }) {
  const c = useTheme();
  const v = Math.max(0, Math.min(1, value));
  const stroke = size * 0.09;
  const r = size / 2 - stroke / 2 - 2;
  const cx = size / 2;
  const cy = size / 2 + 2;
  const h = size / 2 + stroke / 2 + 6;
  // zonas: 0-5 muy bajo, 5-20 bajo, 20-50 moderado, 50-80 alto, 80-100 muy alto
  const zones: [number, number, string][] = [
    [0, 0.05, c.p3],
    [0.05, 0.2, '#8BC34A'],
    [0.2, 0.5, c.p2],
    [0.5, 0.8, '#EF7D2F'],
    [0.8, 1, c.danger],
  ];
  const color = zones.find(([a, b]) => v >= a && v <= b)?.[2] ?? c.danger;
  const needle = polar(cx, cy, r - stroke * 0.9, v * 180);
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={h}>
        <Path d={arc(cx, cy, r, 0, 180)} stroke={c.backgroundElement} strokeWidth={stroke} fill="none" />
        {zones.map(([a, b, col], i) => (
          <Path key={i} d={arc(cx, cy, r, a * 180 + (i ? 1 : 0), b * 180)} stroke={col} strokeOpacity={0.9} strokeWidth={stroke} fill="none" />
        ))}
        <Line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={c.text} strokeWidth={4} strokeLinecap="round" />
        <Circle cx={cx} cy={cy} r={8} fill={c.text} />
      </Svg>
      <T style={{ fontSize: 44, lineHeight: 52, fontWeight: '800', color, marginTop: 8, fontVariant: ['tabular-nums'] }}>{fmtPct(v)}</T>
      <T style={{ fontSize: 18, lineHeight: 24, fontWeight: '700', color }}>{label}</T>
      {sublabel ? (
        <T variant="small" style={{ textAlign: 'center', marginTop: 2 }}>
          {sublabel}
        </T>
      ) : null}
    </View>
  );
}
