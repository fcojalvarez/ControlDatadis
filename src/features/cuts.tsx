/**
 * «Mis cortes»: el usuario apunta cuándo saltó la luz y la app le enseña qué midió el contador en
 * ese momento. Datadis no informa de los cortes, así que esto es solo una comparación con lo medido:
 *
 *  - Pico: en los 30 min alrededor del corte hubo un intervalo por encima de la potencia contratada.
 *  - Sin consumo: después del corte el consumo cae a 0 un rato (corte largo, a menudo de la red).
 *  - Potencia alta: cerca del límite (más del 85 %), pero sin superarlo en la media del intervalo.
 *  - Normal: nada visible. Un pico de segundos se diluye en la media de 15 min (o de 1 h).
 *
 * Los cortes se guardan en el móvil, por usuario y suministro.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import { BottomSheet } from '@/components/select';
import { Button, Card, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { normalizeMonth, type MaxPowerReading, type Reading } from '@/lib/consumption';
import { fmtKW, fmtNum, fmtTime, fmtWeekdayDate, ymd } from '@/lib/format';
import { periodFor } from '@/lib/periods';
import { getJSON, setJSON } from '@/lib/storage';

import { useConsumptionMonths } from './consumption-data';
import { limitForPeriod, useMeasuredPeaks } from './peaks';
import { dayBounds, supplyBounds } from './period';
import type { SupplyRef } from './types';

type Cut = { id: string; day: string; time: string; note?: string }; // day YYYY-MM-DD, time HH:MM

type Verdict =
  | { kind: 'nodata' }
  | { kind: 'peak' | 'high' | 'normal'; kw: number; pct: number; limit: number; from: number; to: number }
  | { kind: 'outage'; minutes: number; from: number };

const WINDOW_MS = 30 * 60_000; // se mira 30 min antes y después de la hora apuntada

function cutTime(c: Cut): number {
  const [y, m, d] = c.day.split('-').map(Number);
  const [hh, mm] = c.time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

/** Lo que midió el contador alrededor del corte */
function analyze(c: Cut, readings: Reading[], intervalMin: number, contractedOn: (day: string) => number[]): Verdict {
  const t = cutTime(c);
  const step = intervalMin * 60_000;
  const near = readings.filter((r) => r.start + step > t - WINDOW_MS && r.start <= t + WINDOW_MS);
  if (!near.length) return { kind: 'nodata' };
  // Corte largo: tras la hora apuntada, el consumo es 0 (o casi) durante al menos 30 min seguidos
  const after = readings.filter((r) => r.start + step > t && r.start <= t + 2 * 3600_000);
  let zeros = 0;
  let firstZero = 0;
  for (const r of after) {
    if (r.kwh < 0.003 * (intervalMin / 15)) {
      if (!zeros) firstZero = r.start;
      zeros += 1;
    } else if (zeros) break;
  }
  if (zeros * intervalMin >= 30) return { kind: 'outage', minutes: zeros * intervalMin, from: firstZero };
  // Intervalo con más potencia respecto a lo contratado
  let best: Extract<Verdict, { kind: 'peak' | 'high' | 'normal' }> | null = null;
  for (const r of near) {
    const kw = (r.kwh * 60) / intervalMin;
    const limit = limitForPeriod(periodFor(new Date(r.start)), contractedOn(r.day));
    const pct = limit ? kw / limit : 0;
    if (!best || pct > best.pct) {
      best = { kind: pct > 1 ? 'peak' : pct > 0.85 ? 'high' : 'normal', kw, pct, limit, from: r.start, to: r.start + step };
    }
  }
  return best ?? { kind: 'nodata' };
}

function useCuts(cups: string) {
  const { username } = useSession();
  const key = `cuts:${username}:${cups}`;
  const [cuts, setCuts] = useState<Cut[]>([]);
  useEffect(() => {
    let alive = true;
    getJSON<Cut[]>(key, []).then((v) => alive && setCuts(v));
    return () => {
      alive = false;
    };
  }, [key]);
  const save = useCallback(
    (next: Cut[]) => {
      const sorted = [...next].sort((a, b) => (a.day + a.time < b.day + b.time ? 1 : -1));
      setCuts(sorted);
      setJSON(key, sorted);
    },
    [key],
  );
  return { cuts, save };
}

export function CutsCard({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { cuts, save } = useCuts(supply.cups);
  const mp = useMeasuredPeaks(supply);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Curva de los meses en los que hay cortes (cada 15 min si existe; si no, horaria)
  const months = useMemo(() => [...new Set(cuts.map((x) => x.day.slice(0, 7)))].sort(), [cuts]);
  const q15 = useConsumptionMonths(supply, months, 1);
  const q60 = useConsumptionMonths(supply, months, 0);
  const curveFor = useCallback(
    (month: string): { readings: Reading[]; interval: number } => {
      const r15 = q15.months[month];
      if (r15?.length) return { readings: normalizeMonth(month, r15, 15), interval: 15 };
      const r60 = q60.months[month];
      return { readings: r60?.length ? normalizeMonth(month, r60, 60) : [], interval: 60 };
    },
    [q15.months, q60.months],
  );

  const results = cuts.map((cut) => {
    const { readings, interval } = curveFor(cut.day.slice(0, 7));
    return { cut, readings, interval, verdict: analyze(cut, readings, interval, mp.contractedOn) };
  });
  const open = results.find((x) => x.cut.id === openId) ?? null;

  return (
    <Card
      title="Mis cortes"
      info="Apunta cuándo saltó la luz y la app te enseña qué midió el contador en ese momento. Datadis no informa de los cortes: es solo una comparación. Un pico de pocos segundos (horno + lavadora) puede hacer saltar el limitador sin que se note en la media de 15 minutos.">
      <T variant="small">Apunta cuándo saltó la luz y la app te dice qué midió el contador en ese momento.</T>
      {results.map(({ cut, verdict }) => (
        <Pressable key={cut.id} onPress={() => setOpenId(cut.id)} style={[styles.row, { borderTopColor: c.border }]} accessibilityRole="button">
          <View style={[styles.dot, { backgroundColor: verdictColor(c, verdict) }]} />
          <View style={{ flex: 1, gap: 4 }}>
            <T style={{ fontWeight: '700' }}>
              {fmtWeekdayDate(cut.day, false)} · {cut.time}
            </T>
            <VerdictChip verdict={verdict} />
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textSecondary} />
        </Pressable>
      ))}
      <Button title="＋ Apuntar un corte" onPress={() => setAdding(true)} style={{ marginTop: Spacing.two }} />

      {/* Se crea al abrir: así empieza siempre con la fecha y hora de ese momento */}
      {adding ? <AddCutSheet supply={supply} visible onClose={() => setAdding(false)} onSave={(cut) => save([...cuts, cut])} /> : null}

      <BottomSheet visible={!!open} onClose={() => setOpenId(null)} title={open ? `${fmtWeekdayDate(open.cut.day, false)} · ${open.cut.time}` : ''}>
        {open ? (
          <CutDetail
            cut={open.cut}
            verdict={open.verdict}
            readings={open.readings}
            interval={open.interval}
            monthPeak={mp.monthly.find((m) => m.month === open.cut.day.slice(0, 7))?.max ?? null}
            contracted={mp.contractedOn(open.cut.day)}
            onDelete={() =>
              Alert.alert('Borrar corte', '¿Seguro que quieres borrarlo?', [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Borrar',
                  style: 'destructive',
                  onPress: () => {
                    save(cuts.filter((x) => x.id !== open.cut.id));
                    setOpenId(null);
                  },
                },
              ])
            }
          />
        ) : null}
      </BottomSheet>
    </Card>
  );
}

function verdictColor(c: ReturnType<typeof useTheme>, v: Verdict): string {
  switch (v.kind) {
    case 'peak':
      return c.danger;
    case 'high':
      return c.warning;
    case 'outage':
      return c.surplus;
    case 'normal':
      return c.textSecondary;
    default:
      return c.warning;
  }
}

function verdictText(v: Verdict): string {
  switch (v.kind) {
    case 'peak':
      return `Pico de ${fmtKW(v.kw, 1)} · ${fmtNum(v.pct * 100, 0)} %`;
    case 'high':
      return `Potencia alta · ${fmtKW(v.kw, 1)} (${fmtNum(v.pct * 100, 0)} %)`;
    case 'outage':
      return `Sin consumo ${v.minutes >= 60 ? `${fmtNum(v.minutes / 60, 1)} h` : `${v.minutes} min`} · corte largo`;
    case 'normal':
      return `Potencia normal · ${fmtKW(v.kw, 1)}`;
    default:
      return 'Aún sin datos de Datadis';
  }
}

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const c = useTheme();
  const color = verdictColor(c, verdict);
  return (
    <View style={[styles.chip, { backgroundColor: `${color}22` }]}>
      <T style={{ fontSize: 12.5, fontWeight: '700', color: verdict.kind === 'normal' ? c.textSecondary : color }}>{verdictText(verdict)}</T>
    </View>
  );
}

function CutDetail({
  cut,
  verdict,
  readings,
  interval,
  monthPeak,
  contracted,
  onDelete,
}: {
  cut: Cut;
  verdict: Verdict;
  readings: Reading[];
  interval: number;
  monthPeak: MaxPowerReading | null;
  contracted: number[];
  onDelete: () => void;
}) {
  const c = useTheme();
  const t = cutTime(cut);
  const step = interval * 60_000;
  const around = readings.filter((r) => r.start >= t - 2 * 3600_000 && r.start < t + 2 * 3600_000);
  const p1 = contracted[0] ?? 0;
  const explain =
    verdict.kind === 'peak'
      ? `Coincide con un pico de ${fmtKW(verdict.kw, 2)} (${fmtNum(verdict.pct * 100, 0)} % de tus ${fmtNum(verdict.limit, 2)} kW) entre las ${fmtTime(verdict.from)} y las ${fmtTime(verdict.to)}. Es muy probable que saltara el limitador por exceso de potencia.`
      : verdict.kind === 'high'
        ? `Cerca del límite: ${fmtKW(verdict.kw, 2)} de media (${fmtNum(verdict.pct * 100, 0)} %) entre las ${fmtTime(verdict.from)} y las ${fmtTime(verdict.to)}. Un pico de unos segundos por encima pudo hacer saltar el limitador.`
        : verdict.kind === 'outage'
          ? `Desde las ${fmtTime(verdict.from)} no hubo consumo durante ${verdict.minutes} min. Es un corte largo; si no hubo un pico antes, lo más probable es que fuera de la red y no de tu casa.`
          : verdict.kind === 'normal'
            ? `La potencia fue normal (máximo ${fmtKW(verdict.kw, 2)}, ${fmtNum(verdict.pct * 100, 0)} %). Si saltó la luz, fue un pico de segundos que la media ${interval === 15 ? 'de 15 minutos' : 'horaria'} no recoge, o un corte de la red.`
            : 'Datadis aún no tiene datos de ese día (las distribuidoras publican con 1 a 3 días de retraso). Se revisará solo cuando lleguen.';
  const color = verdictColor(c, verdict);
  return (
    <View style={{ gap: Spacing.two }}>
      {cut.note ? <T variant="small">{cut.note}</T> : null}
      <View style={[styles.verdict, { backgroundColor: `${color}1f` }]}>
        <T style={{ color: c.text }}>{explain}</T>
      </View>
      {around.length ? (
        <>
          <T variant="small" style={{ fontWeight: '700' }}>
            Potencia {interval === 15 ? 'cada 15 min' : 'cada hora'} · de {fmtTime(around[0].start)} a {fmtTime(around[around.length - 1].start + step)}
          </T>
          <BarChart
            data={around.map((r) => {
              const kw = (r.kwh * 60) / interval;
              const isCut = t >= r.start && t < r.start + step;
              const lim = limitForPeriod(periodFor(new Date(r.start)), contracted);
              return {
                label: new Date(r.start).getMinutes() === 0 ? fmtTime(r.start).slice(0, 2) : '',
                detail: `${fmtTime(r.start)} – ${fmtTime(r.start + step)}${isCut ? ' · hora del corte' : ''}`,
                segments: [{ value: kw, color: isCut ? c.text : lim && kw > lim ? c.danger : lim && kw > lim * 0.85 ? c.warning : c.tint }],
              };
            })}
            formatValue={(v) => fmtKW(v, 2)}
            unit="kW"
            referenceLines={p1 ? [{ value: p1, color: c.danger, label: `contratada ${fmtNum(p1, 2)} kW` }] : []}
            idle="La barra oscura es la hora que apuntaste"
            minBarWidth={6}
            labelEvery={1}
            height={150}
          />
        </>
      ) : null}
      {monthPeak ? (
        <T variant="small">
          Pico medido por el contador ese mes: {fmtKW(monthPeak.kw, 2)} el {fmtWeekdayDate(monthPeak.date, false).toLowerCase()} a las {monthPeak.time}.
        </T>
      ) : null}
      <Button title="Borrar este corte" variant="secondary" onPress={onDelete} />
    </View>
  );
}

/** Abre el selector nativo de fecha u hora del móvil (Android) */
function openNativePicker(mode: 'date' | 'time', value: Date, onPick: (d: Date) => void, limits?: { min: Date; max: Date }) {
  DateTimePickerAndroid.open({
    mode,
    value,
    is24Hour: true,
    minimumDate: limits?.min,
    maximumDate: limits?.max,
    onValueChange: (_e, d) => d && onPick(d),
  });
}

function AddCutSheet({ supply, visible, onClose, onSave }: { supply: SupplyRef; visible: boolean; onClose: () => void; onSave: (c: Cut) => void }) {
  const c = useTheme();
  const bounds = useMemo(() => dayBounds(supplyBounds(supply)), [supply]);
  const [when, setWhen] = useState(() => new Date());
  const [note, setNote] = useState('');
  const native = Platform.OS === 'android';
  const day = ymd(when);
  const time = fmtTime(when.getTime());
  const [y0, m0, d0] = bounds.from.split('-').map(Number);
  const limits = { min: new Date(y0, m0 - 1, d0), max: new Date() };

  const pickDate = () =>
    openNativePicker('date', when, (d) => setWhen(new Date(d.getFullYear(), d.getMonth(), d.getDate(), when.getHours(), when.getMinutes())), limits);
  const pickTime = () => openNativePicker('time', when, (d) => setWhen(new Date(when.getFullYear(), when.getMonth(), when.getDate(), d.getHours(), d.getMinutes())));

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Apuntar un corte">
      <View style={{ gap: Spacing.two }}>
        <T variant="small" style={styles.label}>
          Fecha
        </T>
        {native ? (
          <Pressable onPress={pickDate} style={[styles.field, { backgroundColor: c.backgroundElement }]} accessibilityRole="button" accessibilityLabel="Elegir fecha">
            <Ionicons name="calendar-outline" size={22} color={c.tint} />
            <T style={styles.value}>{fmtWeekdayDate(day)}</T>
            <Ionicons name="chevron-down" size={20} color={c.textSecondary} />
          </Pressable>
        ) : (
          <WebField value={day} placeholder="AAAA-MM-DD" onChange={(v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && setWhen(new Date(`${v}T${time}`))} />
        )}
        <T variant="small" style={styles.label}>
          Hora
        </T>
        {native ? (
          <Pressable onPress={pickTime} style={[styles.field, { backgroundColor: c.backgroundElement }]} accessibilityRole="button" accessibilityLabel="Elegir hora">
            <Ionicons name="time-outline" size={22} color={c.tint} />
            <T style={styles.value}>{time}</T>
            <Ionicons name="chevron-down" size={20} color={c.textSecondary} />
          </Pressable>
        ) : (
          <WebField value={time} placeholder="HH:MM" onChange={(v) => /^\d{2}:\d{2}$/.test(v) && setWhen(new Date(`${day}T${v}`))} />
        )}
        <T variant="small" style={styles.label}>
          Nota (opcional)
        </T>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Horno + lavadora…"
          placeholderTextColor={c.textSecondary}
          style={[styles.field, styles.note, { backgroundColor: c.backgroundElement, color: c.text }]}
        />
        <T variant="small">Si no sabes la hora exacta, pon la aproximada: la app mira también los 30 minutos de antes y de después.</T>
        <Button
          title="Guardar corte"
          onPress={() => {
            onSave({ id: Math.random().toString(36).slice(2, 10), day, time, note: note.trim() || undefined });
            setNote('');
            setWhen(new Date());
            onClose();
          }}
        />
      </View>
    </BottomSheet>
  );
}

/** Solo en la versión web (para pruebas): el selector nativo no existe ahí */
function WebField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const c = useTheme();
  const [text, setText] = useState(value);
  return (
    <TextInput
      value={text}
      onChangeText={(v) => {
        setText(v);
        onChange(v);
      }}
      placeholder={placeholder}
      placeholderTextColor={c.textSecondary}
      style={[styles.field, styles.note, { backgroundColor: c.backgroundElement, color: c.text }]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  chip: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  verdict: { borderRadius: 12, padding: 12 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 14, minHeight: 56 },
  value: { flex: 1, fontSize: 18, fontWeight: '700' },
  label: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: -4 },
  note: { fontSize: 16 },
});
