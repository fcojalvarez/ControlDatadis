import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import type { MeasurementType } from '@/api/datadis';
import { BarChart, SplitBar, type BarDatum } from '@/components/bar-chart';
import { DateRangePicker } from '@/components/date-range-picker';
import { BottomSheet } from '@/components/select';
import { Heatmap } from '@/components/heatmap';
import { Card, DataTable, Delta, Disclosure, Empty, InlineLoading, KeyValue, Loading, Notice, SavedDataNotice, Screen, Stat, Stepper, T, type Column } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import {
  flatPrice,
  readingsOf,
  normalizeMaxPower,
  pctChange,
  readingsToCsv,
  summarize,
  type Bucket,
  type MaxPowerReading,
  type Reading,
} from '@/lib/consumption';
import { WEEKDAYS, WEEKDAYS_SHORT, cap, fmtDate, fmtDayMonth, fmtDayShort, fmtEur, fmtKW, fmtKWh, fmtMonthLong, fmtMonthShort, fmtNum, fmtTime, pad2 } from '@/lib/format';
import { costOfRange } from '@/lib/billing';
import { contractedOnFn, currentContract } from '@/lib/contracts';
import { maxPowerPeriod, PERIOD_LABELS, PERIODS, type Period } from '@/lib/periods';

import { useConsumptionMonths } from './consumption-data';
import {
  canStepRange,
  dayBounds,
  daysBetween,
  initialRange,
  rangeComparisons,
  rangeLabel,
  rangeMonths as monthsOfRange,
  rangePresets,
  stepRange,
  supplyBounds,
  type DateRange,
} from './period';
import { useContract, useMaxPower } from './queries';
import { useSupplyTariffs } from './tariffs';
import type { SupplyRef } from './types';

type ChartView = 'dias' | 'meses' | 'horas' | 'semana';
type Unit = 'kwh' | 'kw';

const PERIODS_INFO =
  'P1 Punta: L-V de 10 a 14 h y de 18 a 22 h.\nP2 Llano: L-V de 8 a 10 h, de 14 a 18 h y de 22 a 24 h.\nP3 Valle: de 0 a 8 h, fines de semana y festivos.\n\nCuanto más consumo en valle, más barata la factura.';

const POWER_INFO =
  'Barras: la potencia media más alta de cada día (o de cada hora) según tu curva de consumo. Es la media de 1 hora, o de 15 minutos si eliges «Cada 15 minutos» en las opciones de la gráfica.\n\n' +
  'Punto: el pico de 15 minutos que midió tu contador. Datadis solo da el mayor de cada mes y periodo, con su día y hora.\n\n' +
  'Línea: tu potencia contratada.';

/** Pico de potencia de la curva (media del intervalo) */
type CurvePeak = { kw: number; start: number; period: Period };

export function ConsumptionTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { current: tariff, cfg: tariffCfg } = useSupplyTariffs(supply.cups);
  const { settings } = useSession();
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const [range, setRange] = useState<DateRange>(() => initialRange(bounds));
  const [pickerOpen, setPickerOpen] = useState(false);
  const nDays = daysBetween(range);
  const isDay = nDays === 1;
  const [mtPref, setMt] = useState<MeasurementType>(0);
  const mt: MeasurementType = nDays <= 31 ? mtPref : 0;
  const [viewPref, setView] = useState<ChartView | null>(null);
  const [what, setWhat] = useState<'kwh' | 'kw' | 'heat'>('kwh');
  const [optsOpen, setOptsOpen] = useState(false);
  const unitPref: Unit = what === 'kw' ? 'kw' : 'kwh';
  const heat = what === 'heat';
  const [showInfo, setShowInfo] = useState(false);

  const win = useMemo(() => monthsOfRange(range), [range]);
  const comps = useMemo(() => rangeComparisons(range, bounds), [range, bounds]);
  const allMonths = useMemo(
    () => [...new Set([...win, ...comps.flatMap((x) => monthsOfRange(x.range))])].filter((k) => k >= bounds.min && k <= bounds.max).sort(),
    [win, comps, bounds],
  );

  const q = useConsumptionMonths(supply, allMonths, mt);
  const contract = useContract(supply);
  const contractedKW = useMemo(() => currentContract(contract.data?.contracts)?.contractedPowerkW ?? [], [contract.data]);
  const p1 = contractedKW[0] ?? 0;
  const p2 = contractedKW[1] ?? p1;
  const limitFor = (p: Period) => (p === 'P3' ? p2 : p1);

  // Picos de 15 min medidos por el contador (uno por mes y periodo) de los últimos 2 años
  const maxp = useMaxPower(supply);
  const measured = useMemo(() => {
    const byDay = new Map<string, MaxPowerReading>();
    const byMonth = new Map<string, MaxPowerReading>();
    for (const r of maxp.data ? normalizeMaxPower(maxp.data.rows) : []) {
      const day = r.date.replace(/\//g, '-');
      if (!byDay.has(day) || byDay.get(day)!.kw < r.kw) byDay.set(day, r);
      if (!byMonth.has(r.key) || byMonth.get(r.key)!.kw < r.kw) byMonth.set(r.key, r);
    }
    return { byDay, byMonth };
  }, [maxp.data]);

  const intervalMin = mt === 1 ? 15 : 60;
  const toKW = 60 / intervalMin;
  const readings = useMemo(
    () => readingsOf(q.months, win, intervalMin, range.from, range.to),
    [q.months, win, intervalMin, range],
  );
  const s = useMemo(() => summarize(readings, intervalMin), [readings, intervalMin]);
  const showSolar = settings.hasSolar && s.hasSelfConsumption;
  // Mismo cálculo que Facturas: tarifa y potencia de cada día
  const contractedOn = useMemo(() => contractedOnFn(contract.data?.contracts), [contract.data]);
  const costR = useMemo(
    () => costOfRange(readings, tariffCfg.history, contractedOn, range.from, range.to),
    [readings, range, tariffCfg.history, contractedOn],
  );
  const cost = costR.cost;
  const singleTariff = costR.tariffNames.length <= 1;

  // Pico de potencia de la curva por día, por mes y por hora del día
  const curvePeaks = useMemo(() => {
    const byDay = new Map<string, CurvePeak>();
    const byMonth = new Map<string, CurvePeak>();
    const byHour: number[] = new Array(24).fill(0);
    for (const r of readings) {
      const kw = r.kwh * toKW;
      const pk = { kw, start: r.start, period: r.period };
      if (!byDay.has(r.day) || byDay.get(r.day)!.kw < kw) byDay.set(r.day, pk);
      if (!byMonth.has(r.month) || byMonth.get(r.month)!.kw < kw) byMonth.set(r.month, pk);
      if (kw > byHour[r.hour]) byHour[r.hour] = kw;
    }
    return { byDay, byMonth, byHour };
  }, [readings, toKW]);

  // Comparativas con el periodo anterior equivalente (solo si tiene una cobertura de días similar)
  const deltas = useMemo(() => {
    if (!readings.length) return [];
    return comps
      .filter((cmp) => monthsOfRange(cmp.range).every((k) => k < bounds.min || q.months[k] !== undefined))
      .map((cmp) => {
        const prev = readingsOf(q.months, monthsOfRange(cmp.range), intervalMin, cmp.range.from, cmp.range.to);
        const prevTotal = prev.reduce((acc, x) => acc + x.kwh, 0);
        const prevDays = new Set(prev.map((x) => x.day)).size;
        return { label: cmp.label, pct: prev.length && prevDays >= s.days * 0.9 ? pctChange(s.total, prevTotal) : null, prevTotal };
      })
      .filter((d) => d.pct !== null);
  }, [comps, q.months, readings, s.total, s.days, intervalMin, bounds.min]);

  // Etiquetas de días: solo el número si todo el rango está en el mismo mes
  const isMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
  const viewOptions: { value: ChartView; label: string; hint?: string }[] = [
    ...(nDays > 31 ? [{ value: 'meses' as const, label: 'Meses', hint: 'Un valor por mes' }] : []),
    { value: 'dias', label: 'Días', hint: 'Un valor por día' },
    { value: 'horas', label: 'Horas', hint: 'Media de cada hora del día' },
    { value: 'semana', label: 'Semana', hint: 'Media de cada día de la semana' },
  ];
  const defaultView: ChartView = nDays > 62 ? 'meses' : 'dias';
  const view: ChartView = viewPref && viewOptions.some((o) => o.value === viewPref) ? viewPref : defaultView;
  const showHeat = heat && !isDay;
  const powerAvailable = !showHeat && (isDay || view !== 'semana');
  const unit: Unit = powerAvailable ? unitPref : 'kwh';

  const periodColors: Record<Period, string> = { P1: c.p1, P2: c.p2, P3: c.p3 };
  // Datos estimados por la distribuidora: no son lo que midió el contador (el reparto por horas
  // y periodos sigue un perfil estándar, no tu consumo real)
  const estShare = readings.length ? s.estimatedCount / readings.length : 0;
  const isEstimated = (b: Bucket) => b.count > 0 && b.estimated / b.count > 0.5;
  const periodLegend = [
    ...PERIODS.map((p) => ({ color: periodColors[p], label: PERIOD_LABELS[p] })),
    ...(estShare > 0 ? [{ color: c.textSecondary, label: 'Rayado: estimado' }] : []),
  ];
  const stacked = (b: Record<Period, number>) => PERIODS.map((p) => ({ value: b[p], color: periodColors[p], name: PERIOD_LABELS[p] }));
  const powerColor = (kw: number, p: Period) => {
    const lim = limitFor(p);
    if (!lim) return c.tint;
    return kw > lim * 1.1 ? c.danger : kw > lim * 0.85 ? c.warning : c.tint;
  };
  const markerColor = c.text;
  const contractedLines = p1
    ? [{ value: p1, color: c.danger, label: `contratada ${fmtNum(p1, 2)} kW` }, ...(p2 !== p1 ? [{ value: p2, color: c.warning, label: `valle ${fmtNum(p2, 2)} kW` }] : [])]
    : [];
  const powerLegend = [
    { color: c.tint, label: 'Media de 1 h más alta' },
    { color: markerColor, label: 'Pico medido por el contador (15 min)' },
  ];

  const selDay = isDay ? (s.daily[0] ?? null) : null;
  const dayReadings = readings;
  const dayMeasured = isDay ? measured.byDay.get(range.from) : undefined;

  const exportCsv = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Exportar', 'La exportación está disponible en la app móvil.');
        return;
      }
      const csv = readingsToCsv(supply.cups, readings);
      const file = new File(Paths.cache, `consumo_${supply.cups}_${s.firstDay}_${s.lastDay}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Exportar consumo', UTI: 'public.comma-separated-values-text' });
    } catch (e) {
      Alert.alert('No se pudo exportar', e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- Datos de la gráfica ----------
  type ChartSpec = {
    data: BarDatum[];
    markers?: ({ value: number; color: string } | null)[];
    format: (v: number) => string;
    refs?: { value: number; color: string; label: string }[];
    legend?: { color: string; label: string }[];
    minBar?: number;
    every?: number;
  };
  let chart: ChartSpec | null = null;
  const measuredNote = (m?: MaxPowerReading) => (m ? `Pico medido por el contador: ${fmtKW(m.kw, 2)} a las ${m.time}` : undefined);

  if (isDay) {
    chart = null; // se rellena más abajo (vista de un día)
  } else if (view === 'dias') {
    chart =
      unit === 'kwh'
        ? {
            data: s.daily.map((d) => ({
              label: isMonth ? String(Number(d.key.slice(8))) : fmtDayShort(d.key),
              detail: `${WEEKDAYS[weekdayOf(d.key)]} ${fmtDate(d.key)}`,
              segments: stacked(d),
              estimated: isEstimated(d),
              note: isEstimated(d) ? 'Estimado por la distribuidora (no medido por tu contador)' : undefined,
            })),
            format: (v) => fmtKWh(v, 1),
            refs: [{ value: s.avgPerDay, color: c.reference, label: `media ${fmtNum(s.avgPerDay, 1)} kWh` }],
            legend: periodLegend,
            minBar: isMonth ? 6 : 5,
          }
        : {
            data: s.daily.map((d) => {
              const pk = curvePeaks.byDay.get(d.key);
              const m = measured.byDay.get(d.key);
              return {
                label: isMonth ? String(Number(d.key.slice(8))) : fmtDayShort(d.key),
                detail: `${WEEKDAYS[weekdayOf(d.key)]} ${fmtDate(d.key)}`,
                segments: [{ value: pk?.kw ?? 0, color: pk ? powerColor(pk.kw, pk.period) : c.tint, name: `Curva ${pk ? fmtTime(pk.start) : ''}` }],
                note: measuredNote(m),
              };
            }),
            markers: s.daily.map((d) => {
              const m = measured.byDay.get(d.key);
              return m ? { value: m.kw, color: markerColor } : null;
            }),
            format: (v) => fmtKW(v, 2),
            refs: contractedLines,
            legend: powerLegend,
            minBar: isMonth ? 6 : 5,
          };
  } else if (view === 'meses') {
    chart =
      unit === 'kwh'
        ? {
            data: s.monthly.map((m) => ({
              label: fmtMonthShort(m.key).split(' ')[0],
              detail: cap(fmtMonthLong(m.key)),
              segments: stacked(m),
              estimated: isEstimated(m),
              note: m.estimated ? `${fmtNum((m.estimated / m.count) * 100, 0)} % estimado por la distribuidora` : undefined,
            })),
            format: (v) => fmtKWh(v, 0),
            legend: periodLegend,
          }
        : {
            data: s.monthly.map((mo) => {
              const pk = curvePeaks.byMonth.get(mo.key);
              const m = measured.byMonth.get(mo.key);
              return {
                label: fmtMonthShort(mo.key).split(' ')[0],
                detail: cap(fmtMonthLong(mo.key)),
                segments: [{ value: pk?.kw ?? 0, color: pk ? powerColor(pk.kw, pk.period) : c.tint, name: 'Curva' }],
                note: m ? `Pico medido: ${fmtKW(m.kw, 2)} el ${fmtDate(m.date)} a las ${m.time}` : undefined,
              };
            }),
            markers: s.monthly.map((mo) => {
              const m = measured.byMonth.get(mo.key);
              return m ? { value: m.kw, color: markerColor } : null;
            }),
            format: (v) => fmtKW(v, 2),
            refs: contractedLines,
            legend: powerLegend,
          };
  } else if (view === 'horas') {
    chart =
      unit === 'kwh'
        ? {
            data: s.hourProfile.map((_, h) => ({
              label: String(h),
              detail: `De ${pad2(h)}:00 a ${pad2(h + 1)}:00 (media)`,
              segments: stacked({ P1: s.hourProfileByPeriod.P1[h], P2: s.hourProfileByPeriod.P2[h], P3: s.hourProfileByPeriod.P3[h] }),
            })),
            format: (v) => fmtKWh(v, 2),
            legend: periodLegend,
            every: 3,
          }
        : {
            data: curvePeaks.byHour.map((kw, h) => ({
              label: String(h),
              detail: `De ${pad2(h)}:00 a ${pad2(h + 1)}:00 (máximo del periodo)`,
              segments: [{ value: kw, color: powerColor(kw, h >= 8 ? 'P1' : 'P3'), name: 'Pico' }],
            })),
            format: (v) => fmtKW(v, 2),
            refs: contractedLines,
            every: 3,
          };
  } else if (view === 'semana') {
    chart = {
      data: s.weekdayAvg.map((v, i) => ({ label: WEEKDAYS_SHORT[i], detail: `${WEEKDAYS[i]} (media)`, segments: [{ value: v, color: i >= 5 ? c.p3 : c.tint }] })),
      format: (v) => fmtKWh(v, 1),
    };
  }
  if (isDay && selDay) {
    // Intervalo en el que cae el pico medido por el contador (la hora es la de fin del cuarto de hora)
    let measuredIdx = -1;
    if (dayMeasured) {
      const [hh, mm] = dayMeasured.time.split(':').map(Number);
      const [y, mo, d] = selDay.key.split('-').map(Number);
      const t = new Date(y, mo - 1, d, hh, mm).getTime() - 60_000;
      measuredIdx = dayReadings.findIndex((r) => t >= r.start && t < r.start + intervalMin * 60_000);
    }
    chart =
      unit === 'kwh'
        ? {
            data: dayReadings.map((r) => ({
              label: new Date(r.start).getMinutes() === 0 ? String(new Date(r.start).getHours()) : '',
              detail: `${fmtTime(r.start)} – ${fmtTime(r.start + intervalMin * 60_000)} · ${PERIOD_LABELS[r.period]}`,
              segments: [{ value: r.kwh, color: periodColors[r.period] }],
              estimated: !r.real,
              note: r.real ? undefined : 'Estimado por la distribuidora (no medido por tu contador)',
            })),
            format: (v) => fmtKWh(v, 3),
            legend: periodLegend,
            minBar: mt === 1 ? 3 : 6,
            every: mt === 1 ? 12 : 3,
          }
        : {
            data: dayReadings.map((r, i) => ({
              label: new Date(r.start).getMinutes() === 0 ? String(new Date(r.start).getHours()) : '',
              detail: `${fmtTime(r.start)} – ${fmtTime(r.start + intervalMin * 60_000)}`,
              segments: [{ value: r.kwh * toKW, color: powerColor(r.kwh * toKW, r.period), name: 'Media' }],
              note: i === measuredIdx ? measuredNote(dayMeasured) : undefined,
            })),
            markers: dayReadings.map((_, i) => (i === measuredIdx && dayMeasured ? { value: dayMeasured.kw, color: markerColor } : null)),
            format: (v) => fmtKW(v, 2),
            refs: contractedLines,
            legend: powerLegend,
            minBar: mt === 1 ? 3 : 6,
            every: mt === 1 ? 12 : 3,
          };
  }

  // Título y resumen de la gráfica: dicen en palabras qué se está viendo
  const every15 = mt === 1 ? 'cada 15 min' : 'cada hora';
  const chartTitle = showHeat
    ? 'Mapa de calor'
    : unit === 'kw'
      ? isDay
        ? 'Potencia a lo largo del día'
        : { dias: 'Potencia máxima por día', meses: 'Potencia máxima por mes', horas: 'Potencia máxima por hora', semana: '' }[view]
      : isDay
        ? 'Consumo a lo largo del día'
        : { dias: 'Consumo por día', meses: 'Consumo por mes', horas: 'Consumo medio por hora', semana: 'Consumo medio por día de la semana' }[view];
  const chartSubtitle = showHeat
    ? 'Consumo medio por día de la semana y hora'
    : unit === 'kw'
      ? `En kW · ${isDay ? every15 : 'línea roja: tu contratada'}`
      : `En kWh${isDay || nDays <= 31 ? ` · datos ${every15}` : ''}`;
  // Pico medido por el contador dentro de las fechas elegidas (Datadis da uno por mes y periodo)
  let measuredMax: MaxPowerReading | null = null;
  for (const [day, m] of measured.byDay) {
    if (day >= range.from && day <= range.to && (!measuredMax || m.kw > measuredMax.kw)) measuredMax = m;
  }
  const measuredLimit = measuredMax ? (maxPowerPeriod(measuredMax.period) === 'P3' ? p2 : p1) : 0;
  const measuredWhen = measuredMax ? `${fmtDayMonth(measuredMax.date)} a las ${measuredMax.time}` : '';
  const curveTop = Math.max(0, ...curvePeaks.byHour);
  const avgLabel = mt === 1 ? 'Media de 15 min más alta' : 'Media de 1 h más alta';
  const chartIdleSub = unit === 'kw' && measuredMax ? `${avgLabel}: ${fmtKW(curveTop, 2)}` : undefined;
  const chartIdle =
    unit === 'kw'
      ? measuredMax
        ? `Pico medido: ${fmtKW(measuredMax.kw, 2)} · ${measuredWhen}${measuredLimit ? ` (${fmtNum((measuredMax.kw / measuredLimit) * 100, 0)} % de tu potencia)` : ''}`
        : `${avgLabel}: ${fmtKW(curveTop, 2)}${p1 ? ` · contratada ${fmtKW(p1, 2)}` : ''}`
      : isDay
        ? `Total ${fmtKWh(s.total, 1)}`
        : view === 'dias'
          ? `Media: ${fmtKWh(s.avgPerDay, 1)} al día`
          : `Total ${fmtKWh(s.total, 0)}`;

  const loadingFirst = q.loading && readings.length === 0;
  const infoButton = (
    <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={8} accessibilityLabel="Más información">
      <Ionicons name={showInfo ? 'information-circle' : 'information-circle-outline'} size={22} color={showInfo ? c.tint : c.textSecondary} />
    </Pressable>
  );
  // Fechas cortas («2 nov») si todo el rango es del mismo año
  const shortDate = (k: string) => (range.from.slice(0, 4) === range.to.slice(0, 4) ? fmtDayMonth(k) : fmtDate(k));
  const curveMax = Math.max(0, ...[...curvePeaks.byDay.values()].map((p) => p.kw));

  return (
    <Screen
      refreshing={q.loading && readings.length > 0}
      onRefresh={q.refresh}
      header={
        /* ---------- Periodo (fijo arriba al hacer scroll) ---------- */
        <View style={{ gap: Spacing.two }}>
        <Stepper
          label={rangeLabel(range)}
          canPrev={canStepRange(range, -1, bounds)}
          canNext={canStepRange(range, 1, bounds)}
          onPrev={() => setRange((x) => stepRange(x, -1, bounds))}
          onNext={() => setRange((x) => stepRange(x, 1, bounds))}
          onPressLabel={() => setPickerOpen(true)}
        />
        <DateRangePicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          value={range}
          limits={dayBounds(bounds)}
          presets={rangePresets(bounds)}
          onApply={setRange}
        />
          {q.loading && readings.length > 0 ? <InlineLoading text={q.pending ? `Descargando: faltan ${q.pending} meses` : 'Actualizando…'} /> : null}
        </View>
      }>

      {loadingFirst ? <Loading text="Descargando tu consumo…" /> : null}
      <SavedDataNotice hasData={readings.length > 0} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
      {estShare > 0.05 ? (
        <Notice tone="warning">
          <T style={{ fontWeight: '700' }}>
            {estShare > 0.995 ? 'Todos estos datos son estimados' : `El ${fmtNum(estShare * 100, 0)} % de estos datos son estimados`} por la distribuidora
          </T>
          <T variant="small" style={{ color: c.text }}>
            No es lo que midió tu contador: la distribuidora reparte una estimación con un perfil estándar, que carga más la punta. Por eso el reparto por horas y periodos no es el tuyo real. Cuando publique las lecturas reales, la app las descargará sola.
          </T>
        </Notice>
      ) : null}

      {!q.loading && !q.error && readings.length === 0 ? (
        <Empty text={mt === 1 ? 'Sin datos cada 15 minutos para estas fechas. Prueba con «Cada hora».' : 'Aún no hay datos para estas fechas.'} />
      ) : null}

      {readings.length > 0 && (
        <>
          {/* ---------- Totales ---------- */}
          <Card>
            <View style={styles.split}>
              <View style={{ flex: 1 }}>
                <T variant="hero">{fmtKWh(s.total, s.total < 100 ? 1 : 0)}</T>
                {deltas.map((d) => (
                  <Delta key={d.label} pct={d.pct} label={d.label} />
                ))}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T variant="value">{fmtEur(cost.total)}</T>
                <T variant="small">estimado</T>
              </View>
            </View>
            <View style={styles.miniRow}>
              {!isDay ? <Stat label="Media diaria" value={fmtKWh(s.avgPerDay, 1)} /> : null}
              {nDays > 62 ? (
                <Stat label="Media mensual" value={fmtKWh(s.monthly.length ? s.total / s.monthly.length : 0, 0)} />
              ) : null}
              {measuredMax ? (
                <Stat
                  label="Pico medido"
                  value={fmtKW(measuredMax.kw, 2)}
                  sub={measuredWhen.replace(' a las', '')}
                  color={measuredLimit && measuredMax.kw > measuredLimit ? c.danger : undefined}
                />
              ) : (
                <Stat label={mt === 1 ? 'Máx. 15 min' : 'Máx. 1 h'} value={fmtKW(curveMax, 1)} color={p1 && curveMax > p1 ? c.danger : undefined} />
              )}
            </View>
          </Card>

          {/* ---------- Gráfica ---------- */}
          <Card>
            <View style={styles.chartHeader}>
              <Pressable
                onPress={() => setOptsOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Cambiar gráfica: ${chartTitle}`}
                style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.7 : 1 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <T variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {chartTitle}
                  </T>
                  <Ionicons name="chevron-down" size={18} color={c.tint} />
                </View>
                <T variant="small">{chartSubtitle}</T>
              </Pressable>
              <Pressable
                onPress={() => setOptsOpen(true)}
                hitSlop={8}
                accessibilityLabel="Opciones de la gráfica"
                style={[styles.optsBtn, { backgroundColor: c.backgroundElement }]}>
                <Ionicons name="options-outline" size={20} color={c.text} />
              </Pressable>
              {infoButton}
            </View>
            {showInfo ? (
              <View style={[styles.infoBox, { backgroundColor: c.backgroundElement }]}>
                <T variant="small" style={{ color: c.text }}>
                  {showHeat
                    ? 'Consumo medio por día de la semana y hora: cuanto más intenso el color, más consumo. Toca una casilla para ver su valor.'
                    : unit === 'kw'
                      ? POWER_INFO
                      : 'Los colores son los periodos de la tarifa: rojo punta (más caro), amarillo llano y verde valle (más barato). Toca una barra para ver el valor exacto.'}
                </T>
              </View>
            ) : null}

            <BottomSheet visible={optsOpen} onClose={() => setOptsOpen(false)} title="Qué ver en la gráfica">
              <OptionGroup<'kwh' | 'kw' | 'heat'>
                title="Dato"
                value={showHeat ? 'heat' : unit}
                onChange={setWhat}
                options={[
                  { value: 'kwh', label: 'Consumo (kWh)', hint: 'Energía gastada, por colores de periodo' },
                  ...(isDay || view !== 'semana'
                    ? [{ value: 'kw' as const, label: 'Potencia (kW)', hint: 'Picos de potencia frente a tu potencia contratada' }]
                    : []),
                  ...(!isDay ? [{ value: 'heat' as const, label: 'Mapa de calor', hint: 'A qué horas y qué días consumes más' }] : []),
                ]}
              />
              {!isDay && !showHeat ? <OptionGroup<ChartView> title="Agrupar por" value={view} onChange={setView} options={viewOptions} /> : null}
              {nDays <= 31 && !showHeat ? (
                <OptionGroup<MeasurementType>
                  title="Detalle de los datos"
                  value={mt}
                  onChange={setMt}
                  options={[
                    { value: 0, label: 'Cada hora', hint: 'Un dato por hora' },
                    { value: 1, label: 'Cada 15 minutos', hint: 'Más detalle; no todos los contadores lo ofrecen' },
                  ]}
                />
              ) : null}
            </BottomSheet>

            {showHeat ? (
              <Heatmap rows={WEEKDAYS_SHORT} rowNames={WEEKDAYS} matrix={s.heat} formatValue={(v) => fmtKWh(v, 2)} />
            ) : chart ? (
              <BarChart
                key={`${view}-${unit}-${range.from}-${range.to}-${mt}`}
                data={chart.data}
                markers={chart.markers}
                formatValue={chart.format}
                referenceLines={chart.refs}
                legend={chart.legend}
                minBarWidth={chart.minBar}
                labelEvery={chart.every}
                unit={unit === 'kw' ? 'kW' : 'kWh'}
                idle={chartIdle}
                idleSub={chartIdleSub}
              />
            ) : null}

            {unit === 'kw' && maxp.loading && !maxp.data ? <InlineLoading text="Cargando picos medidos…" /> : null}

            <Disclosure title="Ver datos">
              {isDay ? (
                <ReadingsTable readings={dayReadings} intervalMin={intervalMin} />
              ) : view === 'meses' ? (
                <BucketTable buckets={s.monthly} keyTitle="Mes" keyFmt={(k) => fmtMonthShort(k)} showSurplus={showSolar} withTotal />
              ) : unit === 'kw' ? (
                <PowerTable days={s.daily.map((d) => d.key).reverse()} curve={curvePeaks.byDay} measured={measured.byDay} />
              ) : (
                <BucketTable
                  buckets={[...s.daily].reverse()}
                  keyTitle="Día"
                  keyFmt={(k) => `${WEEKDAYS_SHORT[weekdayOf(k)]} ${fmtDayShort(k)}`}
                  showSurplus={showSolar}
                />
              )}
            </Disclosure>
          </Card>

          {/* ---------- Periodos ---------- */}
          <Card title="Periodos" info={PERIODS_INFO} subtitle={estShare > 0.5 ? 'Con datos estimados: tu reparto real puede ser muy distinto' : undefined}>
            <SplitBar parts={PERIODS.map((p) => ({ value: s.byPeriod[p], color: periodColors[p] }))} height={12} />
            <View style={styles.periodRow}>
              {PERIODS.map((p) => (
                <View key={p} style={{ flex: 1, alignItems: p === 'P1' ? 'flex-start' : p === 'P3' ? 'flex-end' : 'center' }}>
                  <T variant="small" style={{ color: periodColors[p], fontWeight: '700' }}>
                    {PERIOD_LABELS[p]}
                  </T>
                  <T style={{ fontWeight: '700' }}>{fmtNum(s.total ? (s.byPeriod[p] / s.total) * 100 : 0, 0)} %</T>
                  <T variant="small">{fmtKWh(s.byPeriod[p], 0)}</T>
                </View>
              ))}
            </View>
          </Card>

          {/* ---------- Autoconsumo ---------- */}
          {showSolar && (
            <Card
              title="Autoconsumo"
              info="Generada: lo que han producido tus placas. Excedentes: lo que vertiste a la red (te lo compensan). Autosuficiencia: parte de tu consumo cubierta por tus placas.">
              <View style={styles.miniRow}>
                <Stat label="Generada" value={fmtKWh(s.generation, 0)} color={c.generation} />
                <Stat label="Excedentes" value={fmtKWh(s.surplus, 0)} color={c.surplus} />
                <Stat
                  label="Autosuficiencia"
                  value={`${fmtNum(s.selfConsumption + s.total > 0 ? (s.selfConsumption / (s.selfConsumption + s.total)) * 100 : 0, 0)} %`}
                />
              </View>
              <BarChart
                mode="grouped"
                data={(isMonth ? s.daily : s.monthly).map((b) => ({
                  label: isMonth ? String(Number(b.key.slice(8))) : fmtMonthShort(b.key).split(' ')[0],
                  detail: isMonth ? fmtDate(b.key) : cap(fmtMonthLong(b.key)),
                  segments: [
                    { value: b.total, color: c.tint, name: 'Red' },
                    { value: b.selfConsumption, color: c.generation, name: 'Autoconsumo' },
                    { value: b.surplus, color: c.surplus, name: 'Excedentes' },
                  ],
                }))}
                formatValue={(v) => fmtKWh(v, isMonth ? 1 : 0)}
                minBarWidth={4}
                height={150}
                legend={[
                  { color: c.tint, label: 'Red' },
                  { color: c.generation, label: 'Autoconsumo' },
                  { color: c.surplus, label: 'Excedentes' },
                ]}
              />
            </Card>
          )}

          {/* ---------- Detalles ---------- */}
          <Card title="Detalles">
            {s.peak && <KeyValue k="Hora de más consumo" v={`${shortDate(s.peak.day)}, ${fmtTime(s.peak.start)}`} hint={fmtKWh(s.peak.kwh, 2)} />}
            {s.maxDay && <KeyValue k="Día de más consumo" v={shortDate(s.maxDay.key)} hint={fmtKWh(s.maxDay.total, 1)} />}
            {s.minDay && <KeyValue k="Día de menos consumo" v={shortDate(s.minDay.key)} hint={fmtKWh(s.minDay.total, 1)} />}
            <KeyValue k="Siempre encendido" v={fmtKW(s.baseLoadKW, 2)} hint={`≈ ${fmtEur(s.baseLoadKW * 24 * 365 * flatPrice(tariff.energy))}/año`} />
            <KeyValue k="Laborable / fin de semana" v={`${fmtNum(avg(s.weekdayAvg.slice(0, 5)), 1)} / ${fmtKWh(avg(s.weekdayAvg.slice(5)), 1)}`} hint="media por día" />
            <KeyValue k="Lecturas estimadas" v={`${fmtNum((s.estimatedCount / readings.length) * 100, 1)} %`} />
          </Card>

          {/* ---------- Coste ---------- */}
          <Card title="Coste estimado" right={<T style={{ fontWeight: '800' }}>{fmtEur(cost.total)}</T>} info="Con los precios de tu tarifa (pestaña Facturas). No incluye bono social.">
            <Disclosure title="Ver desglose">
              {PERIODS.map((p) => (
                <KeyValue
                  key={p}
                  k={`Energía ${PERIOD_LABELS[p].toLowerCase()}`}
                  hint={singleTariff ? `${fmtKWh(s.byPeriod[p], 1)} × ${fmtNum(tariff.energy[p], 4)} €` : fmtKWh(s.byPeriod[p], 1)}
                  v={fmtEur(cost.energyByPeriod[p])}
                />
              ))}
              <KeyValue k="Potencia" hint={contractedKW.length ? `${contractedKW.map((k) => fmtNum(k, 2)).join(' / ')} kW × ${costR.days} días` : undefined} v={fmtEur(cost.power)} />
              {cost.surplusCompensation > 0 && <KeyValue k="Compensación excedentes" v={`−${fmtEur(cost.surplusCompensation)}`} />}
              {cost.discount > 0 && <KeyValue k="Descuento" v={`−${fmtEur(cost.discount)}`} />}
              <KeyValue k="Impuesto eléctrico" v={fmtEur(cost.electricityTax)} />
              <KeyValue k="Contador" v={fmtEur(cost.meterRental)} />
              {cost.extras > 0 && <KeyValue k="Servicios" v={fmtEur(cost.extras)} />}
              <KeyValue k="IVA" v={fmtEur(cost.vat)} />
              <T
                variant="small"
                style={{ color: c.tint, fontWeight: '700', marginTop: 8 }}
                onPress={() => router.push({ pathname: '/tariff/[cups]', params: { cups: supply.cups } })}>
                Editar tarifa ›
              </T>
            </Disclosure>
          </Card>

          <Pressable onPress={exportCsv} style={styles.export} accessibilityRole="button">
            <Ionicons name="download-outline" size={18} color={c.tint} />
            <T style={{ color: c.tint, fontWeight: '700' }}>Exportar CSV</T>
          </Pressable>
        </>
      )}
    </Screen>
  );
}


// ---------- Tablas ----------

function BucketTable({
  buckets,
  keyTitle,
  keyFmt,
  showSurplus,
  withTotal,
}: {
  buckets: Bucket[];
  keyTitle: string;
  keyFmt: (k: string) => string;
  showSurplus: boolean;
  withTotal?: boolean;
}) {
  const cols: Column<Bucket>[] = [
    { title: keyTitle, render: (b) => (b.key === '__total' ? 'Total' : keyFmt(b.key)) },
    { title: 'kWh', render: (b) => fmtNum(b.total, 2) },
    { title: 'Punta', render: (b) => fmtNum(b.P1, 2) },
    { title: 'Llano', render: (b) => fmtNum(b.P2, 2) },
    { title: 'Valle', render: (b) => fmtNum(b.P3, 2) },
  ];
  if (showSurplus) cols.push({ title: 'Exced.', render: (b) => fmtNum(b.surplus, 2) });
  const total = withTotal
    ? buckets.reduce<Bucket>(
        (a, b) => ({ ...a, total: a.total + b.total, P1: a.P1 + b.P1, P2: a.P2 + b.P2, P3: a.P3 + b.P3, surplus: a.surplus + b.surplus }),
        { key: '__total', total: 0, P1: 0, P2: 0, P3: 0, surplus: 0, generation: 0, selfConsumption: 0, count: 0, estimated: 0 },
      )
    : undefined;
  return <DataTable columns={cols} rows={buckets} footer={total} />;
}

function ReadingsTable({ readings, intervalMin }: { readings: Reading[]; intervalMin: number }) {
  const c = useTheme();
  const cols: Column<Reading>[] = [
    { title: 'Hora', render: (r) => `${fmtTime(r.start)}-${fmtTime(r.start + intervalMin * 60_000)}`, width: 92 },
    { title: 'kWh', render: (r) => fmtNum(r.kwh, 3) },
    { title: 'kW', render: (r) => fmtNum(r.kwh * (60 / intervalMin), 2) },
    { title: 'Periodo', render: (r) => PERIOD_LABELS[r.period], color: (r) => ({ P1: c.p1, P2: c.p2, P3: c.p3 })[r.period] },
  ];
  if (readings.some((r) => !r.real)) cols.push({ title: 'Tipo', render: (r) => (r.real ? 'Real' : 'Estim.'), color: (r) => (r.real ? undefined : c.warning) });
  return <DataTable columns={cols} rows={readings} />;
}

function PowerTable({ days, curve, measured }: { days: string[]; curve: Map<string, CurvePeak>; measured: Map<string, MaxPowerReading> }) {
  const cols: Column<string>[] = [
    { title: 'Día', render: (d) => `${WEEKDAYS_SHORT[weekdayOf(d)]} ${fmtDayShort(d)}` },
    { title: 'Curva kW', render: (d) => fmtNum(curve.get(d)?.kw ?? 0, 2), width: 70 },
    { title: 'Hora', render: (d) => (curve.get(d) ? fmtTime(curve.get(d)!.start) : '—') },
    { title: 'Contador', render: (d) => (measured.get(d) ? `${fmtNum(measured.get(d)!.kw, 2)} ${measured.get(d)!.time}` : ''), width: 96 },
  ];
  return <DataTable columns={cols} rows={days} />;
}

// ---------- utilidades ----------

function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}


function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  miniRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  periodRow: { flexDirection: 'row' },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  optsBtn: { borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  optGroup: { marginBottom: Spacing.two },
  optRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  infoBox: { borderRadius: 10, padding: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  export: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
});

/** Grupo de opciones con radio, dentro de la hoja de opciones de la gráfica */
function OptionGroup<V extends string | number>({
  title,
  value,
  onChange,
  options,
}: {
  title: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string; hint?: string }[];
}) {
  const c = useTheme();
  return (
    <View style={styles.optGroup}>
      <T variant="small" style={{ fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {title}
      </T>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.optRow, { borderTopColor: c.border }]} accessibilityRole="radio" accessibilityState={{ checked: sel }}>
            <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={22} color={sel ? c.tint : c.textSecondary} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: sel ? '700' : '500' }}>{o.label}</T>
              {o.hint ? <T variant="small">{o.hint}</T> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
