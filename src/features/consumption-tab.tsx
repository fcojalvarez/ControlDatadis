import { File, Paths } from 'expo-file-system';
import { Link } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import type { MeasurementType } from '@/api/datadis';
import { BarChart, SplitBar } from '@/components/bar-chart';
import { Heatmap } from '@/components/heatmap';
import {
  Button,
  Card,
  Chips,
  DataTable,
  Delta,
  Disclosure,
  Empty,
  SavedDataNotice,
  InlineLoading,
  KeyValue,
  Loading,
  Notice,
  Row,
  Screen,
  Segmented,
  Stat,
  Stepper,
  T,
  UpdatedAt,
  type Column,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import {
  estimateCost,
  normalize,
  pctChange,
  readingsToCsv,
  summarize,
  type Bucket,
  type Reading,
} from '@/lib/consumption';
import {
  WEEKDAYS,
  WEEKDAYS_SHORT,
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

import { useConsumptionMonths } from './consumption-data';
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
import { useContract } from './queries';
import type { SupplyRef } from './types';

type ChartView = 'dias' | 'meses' | 'horas' | 'semana' | 'mapa' | 'dia';

const PERIOD_HOURS: Record<Period, string> = {
  P1: 'L-V 10-14 h y 18-22 h',
  P2: 'L-V 8-10 h, 14-18 h y 22-24 h',
  P3: 'L-V 0-8 h, fines de semana y festivos',
};

export function ConsumptionTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { settings } = useSession();
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const [period, setPeriod] = useState<PeriodSel>(() => initialPeriod(bounds));
  const [mtPref, setMt] = useState<MeasurementType>(0);
  const mt: MeasurementType = period.mode === 'month' ? mtPref : 0;
  const [viewPref, setView] = useState<ChartView>('dias');
  const [dayIdx, setDayIdx] = useState<number | null>(null);

  const win = useMemo(() => windowMonths(period, bounds), [period, bounds]);
  const comps = useMemo(() => comparisons(period, bounds), [period, bounds]);
  const allMonths = useMemo(() => [...new Set([...win, ...comps.flatMap((x) => x.months)])].sort(), [win, comps]);

  const q = useConsumptionMonths(supply, allMonths, mt);
  const contract = useContract(supply);
  const contractedKW = useMemo(() => contract.data?.contracts[0]?.contractedPowerkW ?? [], [contract.data]);

  const intervalMin = mt === 1 ? 15 : 60;
  const readings = useMemo(() => normalize(win.flatMap((k) => q.months[k] ?? []), intervalMin), [q.months, win, intervalMin]);
  const s = useMemo(() => summarize(readings, intervalMin), [readings, intervalMin]);
  const cost = useMemo(
    () => estimateCost(s.byPeriod, s.surplus, s.days, contractedKW, settings.prices),
    [s, contractedKW, settings.prices],
  );

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
        // Solo se compara si el periodo anterior tiene una cobertura de días similar
        const prevDays = new Set(prev.map((r) => r.day)).size;
        return { label: cmp.label, pct: prevDays >= s.days * 0.9 ? pctChange(s.total, prevTotal) : null, prevTotal };
      })
      .filter((d) => d.pct !== null);
  }, [comps, q.months, readings, s.total, s.days, intervalMin]);

  const isMonth = period.mode === 'month';
  const viewOptions: { value: ChartView; label: string }[] = isMonth
    ? [
        { value: 'dias', label: 'Por día' },
        { value: 'horas', label: 'Por hora' },
        { value: 'semana', label: 'Por día semana' },
        { value: 'mapa', label: 'Mapa de calor' },
        { value: 'dia', label: 'Un día' },
      ]
    : [
        { value: 'meses', label: 'Por mes' },
        { value: 'dias', label: 'Por día' },
        { value: 'horas', label: 'Por hora' },
        { value: 'semana', label: 'Por día semana' },
        { value: 'mapa', label: 'Mapa de calor' },
      ];
  const view: ChartView = viewOptions.some((o) => o.value === viewPref) ? viewPref : viewOptions[0].value;

  const periodColors: Record<Period, string> = { P1: c.p1, P2: c.p2, P3: c.p3 };
  const periodLegend = PERIODS.map((p) => ({ color: periodColors[p], label: `${p} ${PERIOD_LABELS[p]}` }));
  const stacked = (b: Record<Period, number>) => PERIODS.map((p) => ({ value: b[p], color: periodColors[p], name: p }));

  const selDayIdx = s.daily.length ? (dayIdx === null ? s.daily.length - 1 : Math.min(dayIdx, s.daily.length - 1)) : -1;
  const selDay = selDayIdx >= 0 ? s.daily[selDayIdx] : null;
  const dayReadings = useMemo(() => (selDay ? readings.filter((r) => r.day === selDay.key) : []), [readings, selDay]);

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

  const loadingFirst = q.loading && readings.length === 0;

  return (
    <Screen refreshing={q.loading && readings.length > 0} onRefresh={q.refresh}>
      {/* ---------- Selector de periodo ---------- */}
      <Card>
        <Segmented<PeriodMode> value={period.mode} onChange={changeMode} options={MODE_OPTIONS} />
        <Stepper
          label={periodLabel(period, bounds)}
          sublabel={s.firstDay ? `Datos del ${fmtDate(s.firstDay)} al ${fmtDate(s.lastDay)}` : undefined}
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
        {isMonth && (
          <Segmented<MeasurementType>
            value={mt}
            onChange={setMt}
            options={[
              { value: 0, label: 'Cada hora' },
              { value: 1, label: 'Cada 15 minutos' },
            ]}
          />
        )}
        {q.loading && readings.length > 0 ? <InlineLoading text="Actualizando con Datadis…" /> : null}
      </Card>

      {loadingFirst ? <Loading text="Descargando tu consumo de Datadis… La primera vez puede tardar hasta un minuto." /> : null}
      <SavedDataNotice hasData={readings.length > 0} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />

      {!q.loading && !q.error && readings.length === 0 ? (
        <Empty
          text={
            mt === 1
              ? 'No hay datos cada 15 minutos para este mes. No todos los contadores ni distribuidoras los ofrecen: prueba con "Cada hora".'
              : 'Todavía no hay datos de consumo para este periodo. Las distribuidoras publican los datos con 1 o 2 días de retraso.'
          }
        />
      ) : null}

      {readings.length > 0 && (
        <>
          {/* ---------- Resumen del periodo ---------- */}
          <Card>
            <T variant="label">Consumo total</T>
            <T variant="hero">{fmtKWh(s.total, s.total < 100 ? 1 : 0)}</T>
            {deltas.map((d) => (
              <Delta key={d.label} pct={d.pct} label={`${d.label} (${fmtKWh(d.prevTotal, 0)})`} />
            ))}
            {deltas.length > 0 && <T variant="small">Comparado con el mismo número de días del periodo anterior.</T>}
            <Row style={{ marginTop: Spacing.two }}>
              <Stat label="Media diaria" value={fmtKWh(s.avgPerDay, 1)} sub={`${s.days} días con datos`} />
              <Stat label="Coste estimado" value={fmtEur(cost.total)} sub="con impuestos" />
              <Stat
                label="Consumo fijo"
                value={fmtKW(s.baseLoadKW, 2)}
                sub={`≈ ${fmtKWh(s.baseLoadKW * 24 * 365, 0)}/año siempre encendido`}
              />
              <Stat
                label={isMonth ? 'Previsión del mes' : 'Media mensual'}
                value={
                  isMonth
                    ? fmtKWh(s.avgPerDay * new Date(Number(period.month.slice(0, 4)), Number(period.month.slice(5)), 0).getDate(), 0)
                    : fmtKWh(s.monthly.length ? s.total / s.monthly.length : 0, 0)
                }
                sub={isMonth ? 'a este ritmo' : `${s.monthly.length} meses`}
              />
            </Row>
          </Card>

          {/* ---------- Gráficas ---------- */}
          <Card
            title="¿Cuándo consumes?"
            info="Elige cómo ver tu consumo. Los colores indican el periodo de la tarifa: rojo es punta (más caro), amarillo llano y verde valle (más barato). Toca cualquier barra para ver el valor exacto.">
            <Chips options={viewOptions} value={view} onChange={setView} />
            {view === 'dias' && (
              <>
                <BarChart
                  data={s.daily.map((d) => ({
                    label: isMonth ? String(Number(d.key.slice(8))) : fmtDayShort(d.key),
                    detail: `${WEEKDAYS[weekdayOf(d.key)]} ${fmtDate(d.key)}`,
                    segments: stacked(d),
                  }))}
                  formatValue={(v) => fmtKWh(v, 1)}
                  referenceLines={[{ value: s.avgPerDay, color: c.textSecondary, label: `media ${fmtNum(s.avgPerDay, 1)}` }]}
                  minBarWidth={isMonth ? 6 : 5}
                  legend={periodLegend}
                />
                <Disclosure title={`Ver datos por día (${s.daily.length})`}>
                  <BucketTable buckets={[...s.daily].reverse()} keyTitle="Día" keyFmt={(k) => `${WEEKDAYS_SHORT[weekdayOf(k)]} ${fmtDayShort(k)}`} showSurplus={s.hasSelfConsumption} />
                </Disclosure>
              </>
            )}
            {view === 'meses' && (
              <>
                <BarChart
                  data={s.monthly.map((m) => ({ label: fmtMonthShort(m.key), detail: fmtMonthLong(m.key), segments: stacked(m) }))}
                  formatValue={(v) => fmtKWh(v, 0)}
                  legend={periodLegend}
                />
                <Disclosure title={`Ver datos por mes (${s.monthly.length})`}>
                  <BucketTable buckets={s.monthly} keyTitle="Mes" keyFmt={fmtMonthShort} showSurplus={s.hasSelfConsumption} withTotal />
                </Disclosure>
              </>
            )}
            {view === 'horas' && (
              <>
                <T variant="small">Consumo medio de cada hora del día en el periodo.</T>
                <BarChart
                  data={s.hourProfile.map((_, h) => ({
                    label: String(h),
                    detail: `De ${pad2(h)}:00 a ${pad2(h + 1)}:00`,
                    segments: stacked({ P1: s.hourProfileByPeriod.P1[h], P2: s.hourProfileByPeriod.P2[h], P3: s.hourProfileByPeriod.P3[h] }),
                  }))}
                  formatValue={(v) => fmtKWh(v, 2)}
                  totalLabel="Media"
                  labelEvery={3}
                  legend={periodLegend}
                />
                <Disclosure title="Ver datos por hora">
                  <DataTable
                    columns={[
                      { title: 'Hora', render: (h: number) => `${pad2(h)}-${pad2(h + 1)} h` },
                      { title: 'Media', render: (h) => fmtNum(s.hourProfile[h], 3) },
                      { title: '% del día', render: (h) => `${fmtNum(s.avgPerDay ? (s.hourProfile[h] / s.avgPerDay) * 100 : 0, 1)} %` },
                    ]}
                    rows={Array.from({ length: 24 }, (_, h) => h)}
                  />
                </Disclosure>
              </>
            )}
            {view === 'semana' && (
              <>
                <T variant="small">Consumo medio de cada día de la semana.</T>
                <BarChart
                  data={s.weekdayAvg.map((v, i) => ({ label: WEEKDAYS_SHORT[i], detail: WEEKDAYS[i], segments: [{ value: v, color: i >= 5 ? c.p3 : c.tint }] }))}
                  formatValue={(v) => fmtKWh(v, 1)}
                />
                <Disclosure title="Ver datos por día de la semana">
                  <DataTable
                    columns={[
                      { title: 'Día', render: (i: number) => WEEKDAYS[i] },
                      { title: 'Media', render: (i) => fmtKWh(s.weekdayAvg[i], 2), width: 100 },
                    ]}
                    rows={[0, 1, 2, 3, 4, 5, 6]}
                  />
                </Disclosure>
              </>
            )}
            {view === 'mapa' && (
              <>
                <T variant="small">Consumo medio por día de la semana y hora: así ves tus rutinas de un vistazo.</T>
                <Heatmap rows={WEEKDAYS_SHORT} rowNames={WEEKDAYS} matrix={s.heat} formatValue={(v) => fmtKWh(v, 2)} />
              </>
            )}
            {view === 'dia' && selDay && (
              <>
                <Stepper
                  label={`${WEEKDAYS[weekdayOf(selDay.key)]}, ${fmtDate(selDay.key)}`}
                  sublabel={`${fmtKWh(selDay.total, 2)} en total`}
                  canPrev={selDayIdx > 0}
                  canNext={selDayIdx < s.daily.length - 1}
                  onPrev={() => setDayIdx(selDayIdx - 1)}
                  onNext={() => setDayIdx(selDayIdx + 1)}
                />
                <BarChart
                  key={selDay.key + mt}
                  data={dayReadings.map((r) => ({
                    label: new Date(r.start).getMinutes() === 0 ? String(new Date(r.start).getHours()) : '',
                    detail: `${hhmm(r.start)} – ${hhmm(r.start + intervalMin * 60_000)} · ${r.period} ${PERIOD_LABELS[r.period]}`,
                    segments: [{ value: r.kwh, color: periodColors[r.period] }],
                    note: [r.real ? 'Lectura real' : 'Lectura estimada', r.surplus ? `excedentes ${fmtKWh(r.surplus, 3)}` : '', `potencia media ${fmtKW(r.kwh * (60 / intervalMin), 2)}`]
                      .filter(Boolean)
                      .join(' · '),
                  }))}
                  formatValue={(v) => fmtKWh(v, 3)}
                  minBarWidth={mt === 1 ? 3 : 6}
                  labelEvery={mt === 1 ? 12 : 3}
                  legend={periodLegend}
                />
                <Disclosure title={`Ver las ${dayReadings.length} lecturas del día`}>
                  <ReadingsTable readings={dayReadings} intervalMin={intervalMin} />
                </Disclosure>
              </>
            )}
          </Card>

          {/* ---------- Periodos ---------- */}
          <Card
            title="Reparto por periodos"
            subtitle="Tarifa 2.0TD"
            info="Con la tarifa 2.0TD el precio de la luz depende de la hora. Cuanto más consumo tengas en valle (verde), más barata te sale la factura. Pasar consumos de punta a valle (lavadora, lavavajillas, cargar el coche) es la forma más fácil de ahorrar.">
            <SplitBar parts={PERIODS.map((p) => ({ value: s.byPeriod[p], color: periodColors[p] }))} />
            {PERIODS.map((p) => (
              <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 6 }}>
                <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: periodColors[p] }} />
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: '600' }}>
                    {p} · {PERIOD_LABELS[p]}
                  </T>
                  <T variant="small">{PERIOD_HOURS[p]}</T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T style={{ fontWeight: '700' }}>{fmtKWh(s.byPeriod[p], 1)}</T>
                  <T variant="small">
                    {fmtNum(s.total ? (s.byPeriod[p] / s.total) * 100 : 0, 1)} % · {fmtEur(s.byPeriod[p] * settings.prices.energy[p])}
                  </T>
                </View>
              </View>
            ))}
          </Card>

          {/* ---------- Autoconsumo ---------- */}
          {s.hasSelfConsumption && (
            <Card
              title="Autoconsumo"
              info="Generación: energía que han producido tus placas. Autoconsumida: la que has usado tú directamente. Excedentes: la que has vertido a la red (te la compensan en la factura). Consumo de red: la que has comprado.">
              <Row>
                <Stat label="Generación" value={fmtKWh(s.generation, 0)} color={c.generation} />
                <Stat label="Autoconsumida" value={fmtKWh(s.selfConsumption, 0)} sub={`${fmtNum(s.generation ? (s.selfConsumption / s.generation) * 100 : 0, 0)} % de lo generado`} />
                <Stat label="Excedentes" value={fmtKWh(s.surplus, 0)} color={c.surplus} sub="vertidos a la red" />
                <Stat
                  label="Autosuficiencia"
                  value={`${fmtNum(s.selfConsumption + s.total > 0 ? (s.selfConsumption / (s.selfConsumption + s.total)) * 100 : 0, 0)} %`}
                  sub="de tu consumo cubierto por tus placas"
                />
              </Row>
              <BarChart
                mode="grouped"
                data={(isMonth ? s.daily : s.monthly).map((b) => ({
                  label: isMonth ? String(Number(b.key.slice(8))) : fmtMonthShort(b.key),
                  detail: isMonth ? fmtDate(b.key) : fmtMonthLong(b.key),
                  segments: [
                    { value: b.total, color: c.tint, name: 'Red' },
                    { value: b.selfConsumption, color: c.generation, name: 'Autoconsumo' },
                    { value: b.surplus, color: c.surplus, name: 'Excedentes' },
                  ],
                }))}
                formatValue={(v) => fmtKWh(v, isMonth ? 1 : 0)}
                minBarWidth={4}
                legend={[
                  { color: c.tint, label: 'Consumo de la red' },
                  { color: c.generation, label: 'Autoconsumida' },
                  { color: c.surplus, label: 'Excedentes' },
                ]}
              />
            </Card>
          )}

          {/* ---------- Destacados ---------- */}
          <Card title="Datos destacados">
            {s.peak && <KeyValue k="Hora de mayor consumo" v={`${fmtKWh(s.peak.kwh, 2)}`} hint={`${fmtDate(s.peak.day)}, ${hhmm(s.peak.start)}-${hhmm(s.peak.start + intervalMin * 60_000)}`} />}
            {s.maxDay && <KeyValue k="Día de mayor consumo" v={fmtKWh(s.maxDay.total, 1)} hint={`${WEEKDAYS[weekdayOf(s.maxDay.key)]} ${fmtDate(s.maxDay.key)}`} />}
            {s.minDay && <KeyValue k="Día de menor consumo" v={fmtKWh(s.minDay.total, 1)} hint={`${WEEKDAYS[weekdayOf(s.minDay.key)]} ${fmtDate(s.minDay.key)}`} />}
            <KeyValue k="Hora del día con más consumo" v={`${pad2(argmax(s.hourProfile))}-${pad2(argmax(s.hourProfile) + 1)} h`} hint={`${fmtKWh(Math.max(...s.hourProfile), 2)} de media`} />
            <KeyValue k="Día de la semana con más consumo" v={WEEKDAYS[argmax(s.weekdayAvg)]} hint={`${fmtKWh(Math.max(...s.weekdayAvg), 1)} de media`} />
            <KeyValue k="Laborables vs. fin de semana" v={`${fmtKWh(avg(s.weekdayAvg.slice(0, 5)), 1)} / ${fmtKWh(avg(s.weekdayAvg.slice(5)), 1)}`} hint="media diaria" />
            <KeyValue
              k="Consumo fijo (siempre encendido)"
              v={fmtKW(s.baseLoadKW, 2)}
              hint={`Nevera, router, standby… ≈ ${fmtEur(s.baseLoadKW * 24 * 365 * avg(PERIODS.map((p) => settings.prices.energy[p])))} al año`}
            />
          </Card>

          {/* ---------- Coste ---------- */}
          <Card
            title="Coste estimado"
            info="Cálculo aproximado de lo que pagarías por este periodo con los precios que tienes en Ajustes. No incluye bono social, servicios adicionales ni descuentos de tu comercializadora."
            right={
              <Link href="/settings">
                <T variant="small" style={{ color: c.tint, fontWeight: '700' }}>
                  Editar precios
                </T>
              </Link>
            }>
            {PERIODS.map((p) => (
              <KeyValue
                key={p}
                k={`Energía ${p} ${PERIOD_LABELS[p].toLowerCase()}`}
                hint={`${fmtKWh(s.byPeriod[p], 1)} × ${fmtNum(settings.prices.energy[p], 4)} €`}
                v={fmtEur(s.byPeriod[p] * settings.prices.energy[p])}
              />
            ))}
            <KeyValue
              k="Potencia contratada"
              hint={contractedKW.length ? `${contractedKW.map((k) => fmtNum(k, 2)).join(' / ')} kW × ${s.days} días` : 'Sin datos de contrato'}
              v={fmtEur(cost.power)}
            />
            {cost.surplusCompensation > 0 && <KeyValue k="Compensación de excedentes" hint={`${fmtKWh(s.surplus, 0)}`} v={`−${fmtEur(cost.surplusCompensation)}`} />}
            <KeyValue k="Impuesto eléctrico" hint={`${fmtNum(settings.prices.electricityTax, 2)} %`} v={fmtEur(cost.electricityTax)} />
            <KeyValue k="Alquiler del contador" v={fmtEur(cost.meterRental)} />
            <KeyValue k="IVA" hint={`${fmtNum(settings.prices.vat, 0)} %`} v={fmtEur(cost.vat)} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.two }}>
              <T variant="subtitle">Total</T>
              <T variant="subtitle">{fmtEur(cost.total)}</T>
            </View>
            <T variant="small">Precio medio resultante: {fmtNum(s.total ? cost.total / s.total : 0, 3)} €/kWh</T>
          </Card>

          {/* ---------- Calidad de los datos ---------- */}
          <Card
            title="Calidad de los datos"
            info="Las lecturas reales las envía tu contador. Cuando la distribuidora no recibe la lectura, la estima y la corrige más adelante.">
            <KeyValue k="Lecturas totales" v={String(readings.length)} hint={mt === 1 ? 'cada 15 minutos' : 'una por hora'} />
            <KeyValue k="Reales" v={`${s.realCount} (${fmtNum((s.realCount / readings.length) * 100, 1)} %)`} />
            <KeyValue k="Estimadas" v={`${s.estimatedCount} (${fmtNum((s.estimatedCount / readings.length) * 100, 1)} %)`} />
            <KeyValue k="Días con datos" v={String(s.days)} />
          </Card>

          {q.errors.length ? (
            <Notice tone="warning">
              {q.errors.map((e, i) => (
                <T key={i} variant="small">
                  {e.distributorName ?? e.distributorCode}: {e.errorDescription ?? e.errorCode}
                </T>
              ))}
            </Notice>
          ) : null}

          <Button title="Exportar estos datos a CSV (Excel)" variant="secondary" onPress={exportCsv} />
        </>
      )}
      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
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
    { title: 'Total', render: (b) => fmtNum(b.total, 2) },
    { title: 'P1', render: (b) => fmtNum(b.P1, 2) },
    { title: 'P2', render: (b) => fmtNum(b.P2, 2) },
    { title: 'P3', render: (b) => fmtNum(b.P3, 2) },
  ];
  if (showSurplus) cols.push({ title: 'Exced.', render: (b) => fmtNum(b.surplus, 2) });
  const total = withTotal
    ? buckets.reduce<Bucket>(
        (a, b) => ({ ...a, total: a.total + b.total, P1: a.P1 + b.P1, P2: a.P2 + b.P2, P3: a.P3 + b.P3, surplus: a.surplus + b.surplus }),
        { key: '__total', total: 0, P1: 0, P2: 0, P3: 0, surplus: 0, generation: 0, selfConsumption: 0, count: 0 },
      )
    : undefined;
  return (
    <>
      <T variant="small">Valores en kWh</T>
      <DataTable columns={cols} rows={buckets} footer={total} />
    </>
  );
}

function ReadingsTable({ readings, intervalMin }: { readings: Reading[]; intervalMin: number }) {
  const c = useTheme();
  const cols: Column<Reading>[] = [
    { title: 'Hora', render: (r) => `${hhmm(r.start)}-${hhmm(r.start + intervalMin * 60_000)}`, width: 92 },
    { title: 'kWh', render: (r) => fmtNum(r.kwh, 3) },
    { title: 'Periodo', render: (r) => r.period, color: (r) => ({ P1: c.p1, P2: c.p2, P3: c.p3 })[r.period] },
    { title: 'Tipo', render: (r) => (r.real ? 'Real' : 'Estim.'), color: (r) => (r.real ? undefined : c.warning) },
  ];
  if (readings.some((r) => r.surplus > 0)) cols.push({ title: 'Exced.', render: (r) => fmtNum(r.surplus, 3) });
  return <DataTable columns={cols} rows={readings} />;
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

function argmax(a: number[]): number {
  let idx = 0;
  a.forEach((v, i) => {
    if (v > a[idx]) idx = i;
  });
  return idx;
}

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
