import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/select';
import { Button, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cap, fmtMonthLong, ymd } from '@/lib/format';
import { addMonths } from '@/lib/months';
import { rangeLabel, type DateRange } from '@/features/period';

const WEEK = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * Calendario para elegir un día (un toque) o una franja de días (dos toques).
 * Incluye atajos (este mes, últimos 7 días…) y botones para elegir el mes o el año completo.
 */
export function DateRangePicker({
  visible,
  onClose,
  value,
  limits,
  presets,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  value: DateRange;
  limits: DateRange; // primer y último día seleccionables
  presets: { label: string; range: DateRange }[];
  onApply: (r: DateRange) => void;
}) {
  const c = useTheme();
  const [month, setMonth] = useState(value.to.slice(0, 7));
  const [sel, setSel] = useState<{ from: string; to: string | null }>({ from: value.from, to: value.to });

  // Al abrir, partir de la selección actual
  const [lastValue, setLastValue] = useState(value);
  if (visible && (lastValue.from !== value.from || lastValue.to !== value.to)) {
    setLastValue(value);
    setSel({ from: value.from, to: value.to });
    setMonth(value.to.slice(0, 7));
  }

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // lunes = 0
  const nDays = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: nDays }, (_, i) => ymd(new Date(y, m - 1, i + 1)))];
  while (cells.length % 7) cells.push(null);

  const tap = (d: string) => {
    if (sel.to !== null) {
      // primer toque: empieza una selección nueva
      setSel({ from: d, to: null });
    } else {
      // segundo toque: cierra la franja
      setSel(d < sel.from ? { from: d, to: sel.from } : { from: sel.from, to: d });
    }
  };
  // Primer toque: día suelto (a la espera del segundo); se trata como from==to
  const range: DateRange = { from: sel.from, to: sel.to ?? sel.from };
  const clampToLimits = (r: DateRange): DateRange => ({ from: r.from < limits.from ? limits.from : r.from, to: r.to > limits.to ? limits.to : r.to });

  const monthFull = clampToLimits({ from: `${month}-01`, to: ymd(new Date(y, m, 0)) });
  const yearFull = clampToLimits({ from: `${y}-01-01`, to: `${y}-12-31` });
  const canPrev = `${month}-01` > limits.from;
  const canNext = ymd(new Date(y, m, 0)) < limits.to;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Elegir fechas">
      <View style={styles.presets}>
        {presets.map((p) => (
          <Pressable
            key={p.label}
            onPress={() => {
              onApply(p.range);
              onClose();
            }}
            style={[styles.preset, { borderColor: c.border }]}>
            <T variant="small" style={{ color: c.text, fontWeight: '600' }}>
              {p.label}
            </T>
          </Pressable>
        ))}
      </View>

      <View style={styles.monthHeader}>
        <Pressable onPress={() => canPrev && setMonth(addMonths(month, -1))} hitSlop={10} disabled={!canPrev} accessibilityLabel="Mes anterior">
          <Ionicons name="chevron-back" size={24} color={canPrev ? c.tint : c.border} />
        </Pressable>
        <T style={{ flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 17 }}>{cap(fmtMonthLong(month))}</T>
        <Pressable onPress={() => canNext && setMonth(addMonths(month, 1))} hitSlop={10} disabled={!canNext} accessibilityLabel="Mes siguiente">
          <Ionicons name="chevron-forward" size={24} color={canNext ? c.tint : c.border} />
        </Pressable>
      </View>

      <View style={styles.grid}>
        {WEEK.map((w) => (
          <T key={w} variant="small" style={styles.weekday}>
            {w}
          </T>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={styles.cell} />;
          const disabled = d < limits.from || d > limits.to;
          const inRange = d >= range.from && d <= range.to;
          const edge = d === range.from || d === range.to;
          return (
            <Pressable key={d} disabled={disabled} onPress={() => tap(d)} style={styles.cell} accessibilityLabel={d}>
              <View
                style={[
                  styles.day,
                  inRange && { backgroundColor: edge ? c.tint : c.backgroundSelected },
                ]}>
                <T style={{ color: disabled ? c.border : edge ? c.tintText : c.text, fontWeight: edge ? '800' : '500' }}>{Number(d.slice(8))}</T>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.quick}>
        <Pressable onPress={() => setSel({ from: monthFull.from, to: monthFull.to })} style={[styles.preset, { borderColor: c.border }]}>
          <T variant="small" style={{ color: c.text, fontWeight: '600' }}>
            Todo {fmtMonthLong(month).split(' ')[0]}
          </T>
        </Pressable>
        <Pressable onPress={() => setSel({ from: yearFull.from, to: yearFull.to })} style={[styles.preset, { borderColor: c.border }]}>
          <T variant="small" style={{ color: c.text, fontWeight: '600' }}>
            Todo {y}
          </T>
        </Pressable>
      </View>

      <T variant="small" style={{ textAlign: 'center', marginVertical: 6 }}>
        {sel.to === null ? 'Toca otro día para elegir una franja, o aplica para ver solo este día' : rangeLabel(range)}
      </T>
      <Button
        title="Ver"
        onPress={() => {
          onApply(clampToLimits(range));
          onClose();
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.two },
  preset: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', paddingVertical: 4 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center' },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  quick: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: Spacing.two },
});
