import { File, Paths } from 'expo-file-system';
import { Link } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';

import type { MeasurementType } from '@/api/datadis';
import { BarChart, SplitBar, type BarDatum } from '@/components/bar-chart';
import {
  Button,
  Card,
  Chips,
  Empty,
  ErrorBox,
  KeyValue,
  LegendItem,
  Loading,
  Notice,
  Row,
  Screen,
  Segmented,
  Stat,
  T,
  UpdatedAt,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { estimateCost, normalize, readingsToCsv, summarize, type Reading } from '@/lib/consumption';
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
import { PERIOD_LABELS, PERIODS } from '@/lib/periods';

import { useConsumption, useContract } from './queries';
import { RANGE_OPTIONS, rangeMonths, type RangeKey, type SupplyRef } from './types';

type ChartView = 'dias' | 'meses' | 'horas' | 'semana' | 'dia';

export function ConsumptionTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { settings } = useSession();
  const [range, setRange] = useState<RangeKey>('3m');
  const [mt, setMt] = useState<MeasurementType>(0);
  const [view, setView] = useState<ChartView>('dias');
  const [dayIndex, setDayIndex] = useState<number | null>(null);

  const { start, end } = useMemo(() => rangeMonths(range, supply), [range, supply.validDateFrom, supply.validDateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useConsumption(supply, start, end, mt);
  const contract = useContract(supply);

  const intervalMin = mt === 1 ? 15 : 60;
  const readings = useMemo(() => (q.data ? normalize(q.data.rows, intervalMin) : []), [q.data, intervalMin]);
  const s = useMemo(() => summarize(readings, intervalMin), [readings, intervalMin]);

  const contractedKW = useMemo(() => contract.data?.contracts[0]?.contractedPowerkW ?? [], [contract.data]);
  const cost = useMemo(
    () => estimateCost(s.byPeriod, s.surplus, s.days, contractedKW, settings.prices),
    [s, contractedKW, settings.prices],
  );

  const periodColors = { P1: c.p1, P2: c.p2, P3: c.p3 };
  const stacked = (b: { P1: number; P2: number; P3: number }) => PERIODS.map((p) => ({ value: b[p], color: periodColors[p] }));

  // Día seleccionado para la vista "Día"
  const selDayIdx = dayIndex === null ? s.daily.length - 1 : Math.min(dayIndex, s.daily.length - 1);
  const selDay = s.daily[selDayIdx]?.key;
  const dayReadings = useMemo(() => readings.filter((r) => r.day === selDay), [readings, selDay]);

  let chartData: BarDatum[] = [];
  let unit = (v: number) => fmtKWh(v, v < 10 ? 2 : 0);
  let refLines: { value: number; color: string; label: string }[] = [];
  switch (view) {
    case 'dias':
      chartData = s.daily.map((d) => ({ label: fmtDayShort(d.key), detail: fmtDate(d.key), segments: stacked(d) }));
      if (s.avgPerDay) refLines = [{ value: s.avgPerDay, color: c.textSecondary, label: `media ${fmtNum(s.avgPerDay, 1)}` }];
      break;
    case 'meses':
      chartData = s.monthly.map((m) => ({ label: fmtMonthShort(m.key), detail: fmtMonthLong(m.key), segments: stacked(m) }));
      unit = (v) => fmtKWh(v, 0);
      break;
    case 'horas':
      chartData = s.hourProfile.map((v, h) => ({
        label: String(h),
        detail: `De ${pad2(h)}:00 a ${pad2(h + 1)}:00 (media diaria)`,
        segments: [{ value: v, color: c.tint }],
      }));
      break;
    case 'semana':
      chartData = s.weekdayAvg.map((v, i) => ({
        label: WEEKDAYS_SHORT[i],
        detail: `${WEEKDAYS[i]} (media)`,
        segments: [{ value: v, color: c.tint }],
      }));
      break;
    case 'dia':
      chartData = dayReadings.map((r) => {
        const d = new Date(r.start);
        const hh = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        return {
          label: d.getMinutes() === 0 ? String(d.getHours()) : '',
          detail: `${hh} · ${r.period}${r.real ? '' : ' · estimada'}`,
          segments: [{ value: r.kwh, color: periodColors[r.period] }],
        };
      });
      unit = (v) => fmtKWh(v, 3);
      break;
  }

  const exportCsv = async () => {
    try {
      const csv = readingsToCsv(supply.cups, readings);
      const name = `consumo_${supply.cups}_${s.firstDay}_${s.lastDay}.csv`;
      if (Platform.OS === 'web') {
        Alert.alert('Exportar', 'La exportación está disponible en la app móvil.');
        return;
      }
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Exportar consumo', UTI: 'public.comma-separated-values-text' });
    } catch (e) {
      Alert.alert('No se pudo exportar', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      <Chips options={RANGE_OPTIONS} value={range} onChange={setRange} />
      <Segmented<MeasurementType>
        value={mt}
        onChange={setMt}
        options={[
          { value: 0, label: 'Horario' },
          { value: 1, label: 'Cuartohorario' },
        ]}
      />

      {q.loading && !q.data ? <Loading text="Descargando curva de consumo… (Datadis puede tardar hasta un minuto)" /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}

      {q.data && readings.length === 0 ? (
        <Empty
          text={
            mt === 1
              ? 'No hay datos cuartohorarios para este periodo. No todas las distribuidoras ni contadores los ofrecen.'
              : 'No hay datos de consumo para este periodo.'
          }
        />
      ) : null}

      {readings.length > 0 && (
        <>
          <T variant="small">
            Del {fmtDate(s.firstDay)} al {fmtDate(s.lastDay)} · {s.days} días
          </T>
          <Row>
            <Stat label="Consumo total" value={fmtKWh(s.total, 1)} />
            <Stat label="Media diaria" value={fmtKWh(s.avgPerDay, 2)} />
            <Stat
              label="Coste estimado"
              value={fmtEur(cost.total)}
              sub={contractedKW.length ? 'con impuestos' : 'sin potencia contratada'}
            />
            <Stat label="Consumo base" value={fmtKW(s.baseLoadKW, 2)} sub="siempre encendido" />
          </Row>

          <Card title="Evolución">
            <Segmented<ChartView>
              value={view}
              onChange={setView}
              options={[
                { value: 'dias', label: 'Días' },
                { value: 'meses', label: 'Meses' },
                { value: 'horas', label: 'Horas' },
                { value: 'semana', label: 'Semana' },
                { value: 'dia', label: 'Día' },
              ]}
            />
            {view === 'dia' && selDay ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Pressable disabled={selDayIdx <= 0} onPress={() => setDayIndex(selDayIdx - 1)} hitSlop={10}>
                  <T style={{ color: selDayIdx <= 0 ? c.textSecondary : c.tint, fontSize: 22 }}>‹</T>
                </Pressable>
                <T style={{ fontWeight: '600' }}>
                  {WEEKDAYS[dayReadings[0]?.weekday ?? 0]} {fmtDate(selDay)} ·{' '}
                  {fmtKWh(s.daily[selDayIdx].total)}
                </T>
                <Pressable
                  disabled={selDayIdx >= s.daily.length - 1}
                  onPress={() => setDayIndex(selDayIdx + 1)}
                  hitSlop={10}>
                  <T style={{ color: selDayIdx >= s.daily.length - 1 ? c.textSecondary : c.tint, fontSize: 22 }}>›</T>
                </Pressable>
              </View>
            ) : null}
            <BarChart
              key={view + selDay}
              data={chartData}
              formatValue={unit}
              referenceLines={refLines}
              minBarWidth={view === 'dia' && mt === 1 ? 4 : view === 'dias' ? 8 : 10}
              labelEvery={view === 'horas' ? 3 : view === 'dia' ? (mt === 1 ? 12 : 3) : undefined}
            />
            {(view === 'dias' || view === 'meses' || view === 'dia') && (
              <Row style={{ gap: Spacing.three }}>
                {PERIODS.map((p) => (
                  <LegendItem key={p} color={periodColors[p]} label={`${p} ${PERIOD_LABELS[p]}`} />
                ))}
              </Row>
            )}
          </Card>

          <Card title="Por periodos (2.0TD)">
            <SplitBar parts={PERIODS.map((p) => ({ value: s.byPeriod[p], color: periodColors[p] }))} />
            {PERIODS.map((p) => (
              <KeyValue
                key={p}
                k={`${p} · ${PERIOD_LABELS[p]}`}
                v={`${fmtKWh(s.byPeriod[p], 1)} · ${fmtNum(s.total ? (s.byPeriod[p] / s.total) * 100 : 0, 1)} %`}
              />
            ))}
            <T variant="small">
              Punta: L-V 10-14 y 18-22 h · Llano: L-V 8-10, 14-18 y 22-24 h · Valle: 0-8 h, fines de semana y festivos
              nacionales.
            </T>
          </Card>

          {s.hasSelfConsumption && (
            <Card title="Autoconsumo">
              <Row>
                <Stat label="Excedentes" value={fmtKWh(s.surplus, 1)} color={c.surplus} sub="vertidos a la red" />
                <Stat label="Generación" value={fmtKWh(s.generation, 1)} color={c.generation} />
                <Stat label="Autoconsumida" value={fmtKWh(s.selfConsumption, 1)} />
                <Stat
                  label="Autosuficiencia"
                  value={`${fmtNum(
                    s.selfConsumption + s.total > 0 ? (s.selfConsumption / (s.selfConsumption + s.total)) * 100 : 0,
                    0,
                  )} %`}
                  sub="del consumo cubierto"
                />
              </Row>
              <BarChart
                data={s.monthly.map((m) => ({
                  label: fmtMonthShort(m.key),
                  detail: `${fmtMonthLong(m.key)} · excedentes`,
                  segments: [{ value: m.surplus, color: c.surplus }],
                }))}
                formatValue={(v) => fmtKWh(v, 0)}
                height={150}
              />
            </Card>
          )}

          <Card title="Datos destacados">
            {s.peak && <KeyValue k="Hora de mayor consumo" v={describePeak(s.peak, intervalMin)} />}
            {s.maxDay && <KeyValue k="Día de mayor consumo" v={`${fmtDate(s.maxDay.key)} · ${fmtKWh(s.maxDay.total)}`} />}
            {s.minDay && <KeyValue k="Día de menor consumo" v={`${fmtDate(s.minDay.key)} · ${fmtKWh(s.minDay.total)}`} />}
            <KeyValue
              k="Día de la semana con más consumo"
              v={WEEKDAYS[s.weekdayAvg.indexOf(Math.max(...s.weekdayAvg))]}
            />
            <KeyValue k="Proyección a 30 días" v={fmtKWh(s.avgPerDay * 30, 0)} />
            <KeyValue
              k="Lecturas reales / estimadas"
              v={`${s.realCount} / ${s.estimatedCount}${
                s.estimatedCount ? ` (${fmtNum((s.estimatedCount / readings.length) * 100, 1)} % est.)` : ''
              }`}
            />
          </Card>

          <Card
            title="Coste estimado"
            right={
              <Link href="/settings">
                <T variant="small" style={{ color: c.tint, fontWeight: '600' }}>
                  Editar precios
                </T>
              </Link>
            }>
            <KeyValue k="Energía" v={fmtEur(cost.energy)} />
            <KeyValue
              k={`Potencia (${contractedKW.map((k) => fmtNum(k, 2)).join(' / ') || '—'} kW · ${s.days} días)`}
              v={fmtEur(cost.power)}
            />
            {cost.surplusCompensation > 0 && <KeyValue k="Compensación excedentes" v={`-${fmtEur(cost.surplusCompensation)}`} />}
            <KeyValue k="Impuesto eléctrico" v={fmtEur(cost.electricityTax)} />
            <KeyValue k="Alquiler contador" v={fmtEur(cost.meterRental)} />
            <KeyValue k="IVA" v={fmtEur(cost.vat)} />
            <KeyValue k="Total" v={<T style={{ fontWeight: '700' }}>{fmtEur(cost.total)}</T>} />
            <T variant="small">
              Estimación con tus precios de Ajustes; no incluye bono social, servicios adicionales ni redondeos de tu
              comercializadora.
            </T>
          </Card>

          {q.data?.errors.length ? (
            <Notice tone="warning">
              {q.data.errors.map((e, i) => (
                <T key={i} variant="small">
                  {e.distributorName ?? e.distributorCode}: {e.errorDescription ?? e.errorCode}
                </T>
              ))}
            </Notice>
          ) : null}

          <Button title="Exportar CSV" variant="secondary" onPress={exportCsv} />
        </>
      )}
      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
    </Screen>
  );
}

function describePeak(r: Reading, intervalMin: number) {
  const d = new Date(r.start);
  const e = new Date(r.start + intervalMin * 60_000);
  return `${fmtDate(r.day)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}-${pad2(e.getHours())}:${pad2(e.getMinutes())} · ${fmtKWh(r.kwh, 3)}`;
}
