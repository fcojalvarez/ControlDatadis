import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import type { MeasurementType } from '@/api/datadis';
import { BarChart, SplitBar, type BarDatum } from '@/components/bar-chart';
import { Heatmap } from '@/components/heatmap';
import {
  Card,
  DataTable,
  Delta,
  Disclosure,
  Empty,
  InlineLoading,
  KeyValue,
  Loading,
  SavedDataNotice,
  Screen,
  Segmented,
  Stepper,
  T,
  type Column,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  estimateCost,
  normalize,
  normalizeMaxPower,
  pctChange,
  readingsToCsv,
  summarize,
  type Bucket,
  type MaxPowerReading,
  type Reading,
} from '@/lib/consumption';
import {
  WEEKDAYS,
  WEEKDAYS_SHORT,
  cap,
  fmtDate,
  fmtDayShort,
  fmtEur,
  fmtKW,
  fmtKWh,
  fmtMonthLong,
  fmtMonthShort,
  fmtNum,
  pad2,
} from '@/lib/format';
import { PERIOD_LABELS, PERIODS, type Period } from '@/lib/periods';

import { daysInMonth, useConsumptionMonths } from './consumption-data';
import {
  MODE_OPTIONS,
  canStep,
  comparisons,
  initialPeriod,
  periodLabel,
  step,
  supplyBounds,
  windowMonths,
  type PeriodMode,
  type PeriodSel,
} from './period';
import { useContract, useMaxPower } from './queries';
import { useSupplyTariffs } from './tariffs';
import { rangeMonths, type SupplyRef } from './types';

type ChartView = 'dias' | 'meses' | 'horas' | 'semana' | 'mapa' | 'dia';
type Unit = 'kwh' | 'kw';

const PERIODS_INFO =
  'P1 Punta: L-V de 10 a 14 h y de 18 a 22 h.\nP2 Llano: L-V de 8 a 10 h, de 14 a 18 h y de 22 a 24 h.\nP3 Valle: de 0 a 8 h, fines de semana y festivos.\n\nCuanto más consumo en valle, más barata la factura.';

const POWER_INFO =
  'Barras: la potencia media más alta de cada día (o de cada hora) según tu curva de consumo. Es una media de 1 hora (o de 15 min si eliges «15 min»), así que los picos reales de unos segundos son más altos.\n\n' +
  'Punto: el pico real de 15 minutos que midió tu contador. Datadis solo da el mayor de cada mes, con su día y hora.\n\n' +
  'Línea: tu potencia contratada. El limitador tolera hasta un +10 % aproximadamente.';

/** Pico de potencia de la curva (media del intervalo) */
type CurvePeak = { kw: number; start: number; period: Period };

export function ConsumptionTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { current: tariff } = useSupplyTariffs(supply.cups);
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const [period, setPeriod] = useState<PeriodSel>(() => initialPeriod(bounds));
  const [mtPref, setMt] = useState<MeasurementType>(0);
  const mt: MeasurementType = period.mode === 'month' ? mtPref : 0;
  const [viewPref, setView] = useState<ChartView>('dias');
  const [unitPref, setUnit] = useState<Unit>('kwh');
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const win = useMemo(() => windowMonths(period, bounds), [period, bounds]);
  const comps = useMemo(() => comparisons(period, bounds), [period, bounds]);
  const allMonths = useMemo(() => [...new Set([...win, ...comps.flatMap((x) => x.months)])].sort(), [win, comps]);

  const q = useConsumptionMonths(supply, allMonths, mt);
  const contract = useContract(supply);
  const contractedKW = useMemo(() => contract.data?.contracts[0]?.contractedPowerkW ?? [], [contract.data]);
  const p1 = contractedKW[0] ?? 0;
  const p2 = contractedKW[1] ?? p1;
  const limitFor = (p: Period) => (p === 'P3' ? p2 : p1);

  // Picos de 15 min medidos por el contador (uno por mes y periodo) de los últimos 2 años
  const range24 = useMemo(() => rangeMonths('24m', supply), [supply]);
  const maxp = useMaxPower(supply, range24.start, range24.end);
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
  const readings = useMemo(() => normalize(win.flatMap((k) => q.months[k] ?? []), intervalMin), [q.months, win, intervalMin]);
  const s = useMemo(() => summarize(readings, intervalMin), [readings, intervalMin]);
  const cost = useMemo(() => estimateCost(s.byPeriod, s.surplus, s.days, contractedKW, tariff), [s, contractedKW, tariff]);

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

  // Comparativas a igualdad de días: el periodo anterior se corta en la misma fecha relativa
  const deltas = useMemo(() => {
    const last = readings[readings.length - 1];
    if (!last) return [];
    return comps
      .filter((cmp) => cmp.months.every((k) => q.months[k] !== undefined))
      .map((cmp) => {
        const cutoff = new Date(last.start);
        cutoff.setMonth(cutoff.getMonth() - cmp.shift);
        const prev = normalize(cmp.months.flatMap((k) => q.months[k] ?? []), intervalMin).filter((r) => r.start <= cutoff.getTime());
        const prevTotal = prev.reduce((acc, r) => acc + r.kwh, 0);
        const prevDays = new Set(prev.map((r) => r.day)).size;
        return { label: cmp.label, pct: prevDays >= s.days * 0.9 ? pctChange(s.total, prevTotal) : null, prevTotal };
      })
      .filter((d) => d.pct !== null);
  }, [comps, q.months, readings, s.total, s.days, intervalMin]);

  const isMonth = period.mode === 'month';
  const viewOptions: { value: ChartView; label: string }[] = isMonth
    ? [
        { value: 'dias', label: 'Días' },
        { value: 'dia', label: 'Un día' },
        { value: 'horas', label: 'Horas' },
        { value: 'semana', label: 'Semana' },
        { value: 'mapa', label: 'Calor' },
      ]
    : [
        { value: 'meses', label: 'Meses' },
        { value: 'dias', label: 'Días' },
        { value: 'horas', label: 'Horas' },
        { value: 'semana', label: 'Semana' },
        { value: 'mapa', label: 'Calor' },
      ];
  const view: ChartView = viewOptions.some((o) => o.value === viewPref) ? viewPref : viewOptions[0].value;
  const powerAvailable = view === 'dias' || view === 'meses' || view === 'dia' || view === 'horas';
  const unit: Unit = powerAvailable ? unitPref : 'kwh';

  const periodColors: Record<Period, string> = { P1: c.p1, P2: c.p2, P3: c.p3 };
  const periodLegend = PERIODS.map((p) => ({ color: periodColors[p], label: PERIOD_LABELS[p] }));
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
    { color: c.tint, label: 'Pico de tu curva' },
    { color: markerColor, label: 'Pico medido (15 min)' },
  ];

  const selDayIdx = s.daily.length ? (dayIdx === null ? s.daily.length - 1 : Math.min(dayIdx, s.daily.length - 1)) : -1;
  const selDay = selDayIdx >= 0 ? s.daily[selDayIdx] : null;
  const dayReadings = useMemo(() => (selDay ? readings.filter((r) => r.day === selDay.key) : []), [readings, selDay]);
  const dayMeasured = selDay ? measured.byDay.get(selDay.key) : undefined;

  const changeMode = (mode: PeriodMode) => {
    setPeriod((p) => {
      let month = p.month;
      if (month > bounds.max) month = bounds.max;
      if (month < bounds.min) month = bounds.min;
      return { mode, month, year: mode === 'year' ? Number(month.slice(0, 4)) : p.year };
    });
    setDayIdx(null);
  };

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

  if (view === 'dias') {
    chart =
      unit === 'kwh'
        ? {
            data: s.daily.map((d) => ({ label: isMonth ? String(Number(d.key.slice(8))) : fmtDayShort(d.key), detail: `${WEEKDAYS[weekdayOf(d.key)]} ${fmtDate(d.key)}`, segments: stacked(d) })),
            format: (v) => fmtKWh(v, 1),
            refs: [{ value: s.avgPerDay, color: c.textSecondary, label: `media ${fmtNum(s.avgPerDay, 1)}` }],
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
                segments: [{ value: pk?.kw ?? 0, color: pk ? powerColor(pk.kw, pk.period) : c.tint, name: `Curva ${pk ? hhmm(pk.start) : ''}` }],
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
            data: s.monthly.map((m) => ({ label: fmtMonthShort(m.key).split(' ')[0], detail: cap(fmtMonthLong(m.key)), segments: stacked(m) })),
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
  } else if (view === 'dia' && selDay) {
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
              detail: `${hhmm(r.start)} – ${hhmm(r.start + intervalMin * 60_000)} · ${PERIOD_LABELS[r.period]}`,
              segments: [{ value: r.kwh, color: periodColors[r.period] }],
              note: r.real ? undefined : 'Lectura estimada',
            })),
            format: (v) => fmtKWh(v, 3),
            legend: periodLegend,
            minBar: mt === 1 ? 3 : 6,
            every: mt === 1 ? 12 : 3,
          }
        : {
            data: dayReadings.map((r, i) => ({
              label: new Date(r.start).getMinutes() === 0 ? String(new Date(r.start).getHours()) : '',
              detail: `${hhmm(r.start)} – ${hhmm(r.start + intervalMin * 60_000)}`,
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

  const loadingFirst = q.loading && readings.length === 0;
  const forecast = isMonth ? s.avgPerDay * daysInMonth(period.month) : 0;
  const curveMax = Math.max(0, ...[...curvePeaks.byDay.values()].map((p) => p.kw));

  return (
    <Screen refreshing={q.loading && readings.length > 0} onRefresh={q.refresh}>
      {/* ---------- Periodo ---------- */}
      <View style={{ gap: Spacing.two }}>
        <Segmented<PeriodMode> value={period.mode} onChange={changeMode} options={MODE_OPTIONS} />
        <Stepper
          label={periodLabel(period, bounds)}
          canPrev={canStep(period, bounds, -1)}
          canNext={canStep(period, bounds, 1)}
          onPrev={() => {
            setPeriod((p) => step(p, -1));
            setDayIdx(null);
          }}
          onNext={() => {
            setPeriod((p) => step(p, 1));
            setDayIdx(null);
          }}
        />
        {q.loading && readings.length > 0 ? <InlineLoading text={q.pending ? `Descargando: faltan ${q.pending} meses` : 'Actualizando…'} /> : null}
      </View>

      {loadingFirst ? <Loading text="Descargando tu consumo…" /> : null}
      <SavedDataNotice hasData={readings.length > 0} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />

      {!q.loading && !q.error && readings.length === 0 ? (
        <Empty text={mt === 1 ? 'Sin datos cada 15 minutos para este mes. Prueba con «1 h».' : 'Aún no hay datos para este periodo.'} />
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
              <Mini label="Media diaria" value={fmtKWh(s.avgPerDay, 1)} />
              {isMonth ? (
                <Mini label="Previsión" value={fmtKWh(forecast, 0)} />
              ) : (
                <Mini label="Media mensual" value={fmtKWh(s.monthly.length ? s.total / s.monthly.length : 0, 0)} />
              )}
              <Mini label="Pico" value={fmtKW(curveMax, 1)} color={p1 && curveMax > p1 ? c.danger : undefined} />
            </View>
          </Card>

          {/* ---------- Gráfica ---------- */}
          <Card>
            <View style={styles.toolbar}>
              {powerAvailable ? (
                <Segmented<Unit>
                  style={{ flex: 1 }}
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: 'kwh', label: 'Energía' },
                    { value: 'kw', label: 'Potencia' },
                  ]}
                />
              ) : (
                <View style={{ flex: 1 }} />
              )}
              {isMonth ? (
                <Segmented<MeasurementType>
                  value={mt}
                  onChange={setMt}
                  options={[
                    { value: 0, label: '1 h' },
                    { value: 1, label: '15 min' },
                  ]}
                  style={{ width: 112 }}
                />
              ) : null}
              <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={8} accessibilityLabel="Más información">
                <Ionicons name={showInfo ? 'information-circle' : 'information-circle-outline'} size={22} color={showInfo ? c.tint : c.textSecondary} />
              </Pressable>
            </View>
            {showInfo ? (
              <View style={[styles.infoBox, { backgroundColor: c.backgroundElement }]}>
                <T variant="small" style={{ color: c.text }}>
                  {unit === 'kw' ? POWER_INFO : 'Los colores son los periodos de la tarifa: rojo punta (más caro), amarillo llano y verde valle (más barato). Toca una barra para ver el valor exacto.'}
                </T>
              </View>
            ) : null}
            <Segmented<ChartView> options={viewOptions} value={view} onChange={setView} />

            {view === 'dia' && selDay ? (
              <Stepper
                label={`${WEEKDAYS[weekdayOf(selDay.key)]} ${Number(selDay.key.slice(8))}`}
                sublabel={unit === 'kwh' ? fmtKWh(selDay.total, 1) : `pico ${fmtKW(Math.max(0, ...dayReadings.map((r) => r.kwh * toKW)), 2)}`}
                canPrev={selDayIdx > 0}
                canNext={selDayIdx < s.daily.length - 1}
                onPrev={() => setDayIdx(selDayIdx - 1)}
                onNext={() => setDayIdx(selDayIdx + 1)}
              />
            ) : null}

            {view === 'mapa' ? (
              <Heatmap rows={WEEKDAYS_SHORT} rowNames={WEEKDAYS} matrix={s.heat} formatValue={(v) => fmtKWh(v, 2)} />
            ) : chart ? (
              <BarChart
                key={`${view}-${unit}-${selDay?.key}-${mt}`}
                data={chart.data}
                markers={chart.markers}
                formatValue={chart.format}
                referenceLines={chart.refs}
                legend={chart.legend}
                minBarWidth={chart.minBar}
                labelEvery={chart.every}
              />
            ) : null}

            {unit === 'kw' && maxp.loading && !maxp.data ? <InlineLoading text="Cargando picos medidos…" /> : null}

            <Disclosure title="Ver datos">
              {view === 'dia' ? (
                <ReadingsTable readings={dayReadings} intervalMin={intervalMin} />
              ) : view === 'meses' ? (
                <BucketTable buckets={s.monthly} keyTitle="Mes" keyFmt={(k) => fmtMonthShort(k)} showSurplus={s.hasSelfConsumption} withTotal />
              ) : unit === 'kw' ? (
                <PowerTable days={s.daily.map((d) => d.key).reverse()} curve={curvePeaks.byDay} measured={measured.byDay} />
              ) : (
                <BucketTable
                  buckets={[...s.daily].reverse()}
                  keyTitle="Día"
                  keyFmt={(k) => `${WEEKDAYS_SHORT[weekdayOf(k)]} ${fmtDayShort(k)}`}
                  showSurplus={s.hasSelfConsumption}
                />
              )}
            </Disclosure>
          </Card>

          {/* ---------- Periodos ---------- */}
          <Card title="Periodos" info={PERIODS_INFO}>
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
          {s.hasSelfConsumption && (
            <Card
              title="Autoconsumo"
              info="Generada: lo que han producido tus placas. Excedentes: lo que vertiste a la red (te lo compensan). Autosuficiencia: parte de tu consumo cubierta por tus placas.">
              <View style={styles.miniRow}>
                <Mini label="Generada" value={fmtKWh(s.generation, 0)} color={c.generation} />
                <Mini label="Excedentes" value={fmtKWh(s.surplus, 0)} color={c.surplus} />
                <Mini
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
            {s.peak && <KeyValue k="Hora de más consumo" v={`${fmtDate(s.peak.day)}, ${hhmm(s.peak.start)}`} hint={fmtKWh(s.peak.kwh, 2)} />}
            {s.maxDay && <KeyValue k="Día de más consumo" v={fmtDate(s.maxDay.key)} hint={fmtKWh(s.maxDay.total, 1)} />}
            {s.minDay && <KeyValue k="Día de menos consumo" v={fmtDate(s.minDay.key)} hint={fmtKWh(s.minDay.total, 1)} />}
            <KeyValue k="Siempre encendido" v={fmtKW(s.baseLoadKW, 2)} hint={`≈ ${fmtEur(s.baseLoadKW * 24 * 365 * tariff.energy.P3)}/año`} />
            <KeyValue k="Laborables / fin de semana" v={`${fmtKWh(avg(s.weekdayAvg.slice(0, 5)), 1)} / ${fmtKWh(avg(s.weekdayAvg.slice(5)), 1)}`} />
            <KeyValue k="Lecturas estimadas" v={`${fmtNum((s.estimatedCount / readings.length) * 100, 1)} %`} />
          </Card>

          {/* ---------- Coste ---------- */}
          <Card title="Coste estimado" right={<T style={{ fontWeight: '800' }}>{fmtEur(cost.total)}</T>} info="Con los precios de tu tarifa (pestaña Facturas). No incluye bono social.">
            <Disclosure title="Ver desglose">
              {PERIODS.map((p) => (
                <KeyValue
                  key={p}
                  k={`Energía ${PERIOD_LABELS[p].toLowerCase()}`}
                  hint={`${fmtKWh(s.byPeriod[p], 1)} × ${fmtNum(tariff.energy[p], 4)} €`}
                  v={fmtEur(s.byPeriod[p] * tariff.energy[p])}
                />
              ))}
              <KeyValue k="Potencia" hint={contractedKW.length ? `${contractedKW.map((k) => fmtNum(k, 2)).join(' / ')} kW × ${s.days} días` : undefined} v={fmtEur(cost.power)} />
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

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.mini, { backgroundColor: c.backgroundElement }]}>
      <T variant="small" numberOfLines={1}>
        {label}
      </T>
      <T style={{ fontWeight: '800', fontSize: 16, color: color ?? c.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
    </View>
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
        { key: '__total', total: 0, P1: 0, P2: 0, P3: 0, surplus: 0, generation: 0, selfConsumption: 0, count: 0 },
      )
    : undefined;
  return <DataTable columns={cols} rows={buckets} footer={total} />;
}

function ReadingsTable({ readings, intervalMin }: { readings: Reading[]; intervalMin: number }) {
  const c = useTheme();
  const cols: Column<Reading>[] = [
    { title: 'Hora', render: (r) => `${hhmm(r.start)}-${hhmm(r.start + intervalMin * 60_000)}`, width: 92 },
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
    { title: 'Hora', render: (d) => (curve.get(d) ? hhmm(curve.get(d)!.start) : '—') },
    { title: 'Contador', render: (d) => (measured.get(d) ? `${fmtNum(measured.get(d)!.kw, 2)} ${measured.get(d)!.time}` : ''), width: 96 },
  ];
  return <DataTable columns={cols} rows={days} />;
}

// ---------- utilidades ----------

function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  miniRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  mini: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  periodRow: { flexDirection: 'row' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  infoBox: { borderRadius: 10, padding: 10 },
  export: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
});
